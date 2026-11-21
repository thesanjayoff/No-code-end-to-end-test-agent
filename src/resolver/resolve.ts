import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import type { LocatorStrategy, ParsedStep, ProjectConfig, ResolvedStep } from "../types.js";
import { buildLocatorCandidates, CONTEXT_CONTAINER_SELECTOR } from "./locatorStrategies.js";
import { pickBest } from "../locator/rank.js";
import { assertAllowListed, checkAllowListed } from "../safety/allowlist.js";
import { evaluateDestructiveGuard } from "../safety/destructive.js";
import { wrapUntrusted, scanForInjection } from "../safety/injection.js";
import { substituteTemplates } from "./testData.js";
import { SecretVault, parseSecretPlaceholder } from "../safety/secrets.js";
import { getLlmProvider } from "../llm/index.js";
import type { LlmProvider } from "../llm/provider.js";

export interface ResolveOptions {
  project: ProjectConfig;
  environment: string;
  startUrl: string;
  steps: ParsedStep[];
  destructiveApproved: boolean;
  headed?: boolean;
  screenshotDir: string;
  useAi?: boolean;
}

export interface ResolveReport {
  resolvedSteps: ResolvedStep[];
  aborted: boolean;
  abortReason?: string;
  llmCallsUsed: number;
  llmCostUsd: number;
  injectionAlerts: Array<{ stepIndex: number; matches: string[] }>;
}

async function matchCount(page: Page, locate: (p: Page) => ReturnType<Page["locator"]>): Promise<number> {
  try {
    return await locate(page).count();
  } catch {
    return 0;
  }
}

/**
 * The resolution run: performs each parsed step once in a real browser,
 * choosing stable locators (role > label > testid > text > css), verifying
 * every assertion live, and falling back to the LLM -- shown the
 * accessibility snapshot as delimited, untrusted data -- only when
 * deterministic heuristics can't find a confident, unique match.
 */
export async function runResolution(opts: ResolveOptions): Promise<ResolveReport> {
  assertAllowListed(opts.startUrl, opts.project);

  const destructive = evaluateDestructiveGuard(opts.steps, opts.destructiveApproved);
  const vault = new SecretVault();
  const envVars = { baseUrl: opts.project.environments[opts.environment]?.baseUrl ?? "" };

  const browser: Browser = await chromium.launch({ headless: !opts.headed });
  const page = await browser.newPage();
  fs.mkdirSync(opts.screenshotDir, { recursive: true });

  const resolvedSteps: ResolvedStep[] = [];
  const injectionAlerts: ResolveReport["injectionAlerts"] = [];
  let llmCallsUsed = 0;
  let llmCostUsd = 0;
  let aborted = false;
  let abortReason: string | undefined;

  try {
    // The start URL is the initial navigation; an explicit "go to" step
    // (if the author wrote one) can still navigate elsewhere afterwards.
    const firstStepIsGoto = opts.steps[0]?.action === "goto";
    if (!firstStepIsGoto) {
      await page.goto(opts.startUrl, { waitUntil: "domcontentloaded" });
    }

    for (const step of opts.steps) {
      if (aborted) {
        resolvedSteps.push({ ...step, resolutionOk: false, resolutionNote: "Skipped: resolution aborted earlier.", usedAi: false });
        continue;
      }

      if (destructive.findings.some((f) => f.stepIndex === step.index) && !opts.destructiveApproved) {
        resolvedSteps.push({
          ...step,
          resolutionOk: false,
          resolutionNote: `Looks irreversible ("${step.sentence}"). Destructive actions need explicit per-test approval before they run for real. Approve with "testwise test approve-destructive" and re-run.`,
          usedAi: false,
        });
        aborted = true;
        abortReason = "destructive_action_requires_approval";
        continue;
      }

      const resolved = await resolveOneStep(page, step, {
        project: opts.project,
        envVars,
        vault,
        screenshotDir: opts.screenshotDir,
        useAi: opts.useAi ?? true,
        onLlmUsage: (cost) => {
          llmCallsUsed += 1;
          llmCostUsd += cost;
        },
        onInjectionAlert: (matches) => injectionAlerts.push({ stepIndex: step.index, matches }),
      });
      resolvedSteps.push(resolved);

      if (!resolved.resolutionOk && resolved.kind === "action") {
        // An action we truly cannot perform blocks everything after it; assertions
        // that fail are still reported individually (that's a suspected bug, not an abort).
        aborted = true;
        abortReason = `step_${step.index}_action_failed`;
      }
    }
  } finally {
    await browser.close();
  }

  return { resolvedSteps, aborted, abortReason, llmCallsUsed, llmCostUsd, injectionAlerts };
}

export interface StepResolveContext {
  project: ProjectConfig;
  envVars: Record<string, string>;
  vault: SecretVault;
  screenshotDir: string;
  useAi: boolean;
  onLlmUsage: (costUsd: number) => void;
  onInjectionAlert: (matches: string[]) => void;
}

export async function resolveOneStep(page: Page, rawStep: ParsedStep, ctx: StepResolveContext): Promise<ResolvedStep> {
  const resolved = await resolveOneStepInner(page, rawStep, ctx);
  // {{secret:name}} is substituted with the real value above, for the live
  // action only. Every return path below builds its result by spreading
  // that already-substituted step, so without this, the real secret would
  // end up written into resolved.json and the generated spec. Put the
  // placeholder back before anything persists it -- codegen's valueExpr()
  // recognizes it and renders a runtime vault lookup instead of a literal.
  // Other templates ({{random_name}}, {{unique_email}}, {{env:KEY}}) are
  // deliberately left baked in: they aren't secrets, and baking them in
  // keeps replays using the same fixed test data every run.
  if (parseSecretPlaceholder(rawStep.data ?? "")) resolved.data = rawStep.data;
  if (parseSecretPlaceholder(rawStep.expected ?? "")) resolved.expected = rawStep.expected;
  return resolved;
}

async function resolveOneStepInner(page: Page, rawStep: ParsedStep, ctx: StepResolveContext): Promise<ResolvedStep> {
  const screenshotPath = path.join(ctx.screenshotDir, `step-${String(rawStep.index).padStart(2, "0")}.png`);
  const subCtx = { env: ctx.envVars, vault: ctx.vault };
  const step: ParsedStep = {
    ...rawStep,
    data: substituteTemplates(rawStep.data, subCtx),
    expected: substituteTemplates(rawStep.expected, subCtx),
  };

  try {
    switch (step.action) {
      case "goto": {
        const url = resolveUrl(step.data, ctx);
        const check = checkAllowListed(url, ctx.project);
        if (!check.ok) return { ...step, resolutionOk: false, resolutionNote: check.reason, usedAi: false };
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.screenshot({ path: screenshotPath });
        // Save the fully-resolved absolute URL, not the author's relative
        // one -- codegen emits `page.goto(step.data)` verbatim at replay
        // time, with no base URL of its own to resolve a relative path against.
        return { ...step, data: url, resolutionOk: true, screenshotPath, usedAi: false };
      }
      case "wait": {
        await page.waitForTimeout(Number(step.data ?? 500));
        return { ...step, resolutionOk: true, usedAi: false };
      }
      case "press": {
        await page.keyboard.press(step.data ?? "Enter");
        await page.screenshot({ path: screenshotPath });
        return { ...step, resolutionOk: true, screenshotPath, usedAi: false };
      }
      case "click":
      case "fill":
      case "select":
      case "check":
      case "uncheck":
      case "hover":
      case "upload": {
        const { locator, resolvedLocator, candidates, usedAi, note } = await findTarget(page, step, ctx);
        if (!locator || !resolvedLocator) {
          return { ...step, resolutionOk: false, resolutionNote: note ?? "No matching element found.", usedAi, candidates };
        }
        await performAction(page, step, locator);
        await page.screenshot({ path: screenshotPath });
        return { ...step, locator: resolvedLocator, candidates, resolutionOk: true, screenshotPath, usedAi };
      }
      case "expect_visible":
      case "expect_text":
      case "expect_value":
      case "expect_enabled":
      case "expect_disabled":
      case "expect_count": {
        const result = await verifyAssertion(page, step, ctx);
        await page.screenshot({ path: screenshotPath }).catch(() => {});
        return { ...step, ...result, screenshotPath };
      }
      case "expect_url": {
        const current = page.url();
        const expected = step.expected ?? "";
        const ok = step.data === "contain" ? current.includes(expected) : current === expected;
        return {
          ...step,
          resolutionOk: ok,
          resolutionNote: ok ? undefined : `URL was "${current}", expected ${step.data} "${expected}".`,
          usedAi: false,
        };
      }
      case "use_component":
      case "unknown":
      default:
        return { ...step, resolutionOk: false, resolutionNote: "Step could not be parsed into an executable action.", usedAi: false };
    }
  } catch (err: any) {
    return { ...step, resolutionOk: false, resolutionNote: err?.message ?? String(err), usedAi: false };
  }
}

function resolveUrl(data: string | undefined, ctx: StepResolveContext): string {
  if (!data) return ctx.envVars.baseUrl;
  if (/^https?:\/\//i.test(data)) return data;
  const base = ctx.envVars.baseUrl.replace(/\/$/, "");
  return `${base}/${data.replace(/^\//, "")}`;
}

async function performAction(page: Page, step: ParsedStep, locator: ReturnType<Page["locator"]>) {
  switch (step.action) {
    case "click":
      await locator.first().click();
      return;
    case "fill":
      // step.data has already gone through substituteTemplates() above,
      // so a {{secret:name}} placeholder is already the real value here.
      await locator.first().fill(step.data ?? "");
      return;
    case "select":
      await locator.first().selectOption(step.data ?? "");
      return;
    case "check":
      await locator.first().check();
      return;
    case "uncheck":
      await locator.first().uncheck();
      return;
    case "hover":
      await locator.first().hover();
      return;
    case "upload":
      await locator.first().setInputFiles(step.data ?? "");
      return;
  }
}

export async function findTarget(page: Page, step: ParsedStep, ctx: StepResolveContext) {
  const description = step.targetDescription ?? "";
  let candidates = buildLocatorCandidates(description);
  // For "expect X to show Y" steps, X often has no locatable name of its own
  // (a bare status/message region) while Y, its expected content, does --
  // so also try locating by the expected text itself, deterministically.
  if (step.action === "expect_text" && step.expected) {
    candidates = [...candidates, ...buildLocatorCandidates(step.expected)];
  }
  if (step.contextDescription) {
    const context = step.contextDescription;
    candidates = candidates.map((c) => ({
      ...c,
      code: `locator(${JSON.stringify(CONTEXT_CONTAINER_SELECTOR)}).filter({ hasText: ${JSON.stringify(context)} }).${c.code}`,
      description: `${c.description} within an item containing "${context}"`,
      locate: (p: Page | Locator) => c.locate(p.locator(CONTEXT_CONTAINER_SELECTOR).filter({ hasText: context })),
    }));
  }
  // A checkbox/radio is rarely matched by its own visible text -- that text
  // usually belongs to an adjacent <label> (as in TodoMVC's "Walk the dog").
  // Matching by text there finds a real, unique element that simply isn't
  // checkable, which is worse than finding nothing. Restrict to strategies
  // that actually target form controls for these two actions.
  if (step.action === "check" || step.action === "uncheck") {
    candidates = candidates.filter((c) => c.strategy === "role" || c.strategy === "testid" || c.strategy === "label");
  }
  const counted = await Promise.all(candidates.map(async (c) => ({ ...c, matchCount: await matchCount(page, c.locate) })));
  let { best, ranked, ambiguous } = pickBest(counted);
  let usedAi = false;

  if ((ambiguous || !best) && ctx.useAi) {
    const aiHint = await askLlmForTarget(page, description, ctx);
    if (aiHint) {
      usedAi = true;
      const retryCandidates = buildLocatorCandidates(aiHint);
      const retryCounted = await Promise.all(retryCandidates.map(async (c) => ({ ...c, matchCount: await matchCount(page, c.locate) })));
      const retryPick = pickBest(retryCounted);
      if (retryPick.best) {
        best = retryPick.best;
        ranked = retryPick.ranked;
        ambiguous = retryPick.ambiguous;
        candidates = retryCandidates;
      }
    }
  }

  if (!best || ambiguous) {
    return {
      locator: undefined,
      resolvedLocator: undefined,
      candidates: ranked,
      usedAi,
      note: `Could not find a unique, stable element for "${description}". ${
        ranked.length ? "Best guess: " + ranked[0].description + ` (confidence ${ranked[0].confidence.toFixed(2)}).` : ""
      }`,
    };
  }

  const matchingCandidate = candidates.find((c) => c.strategy === best!.strategy && c.description === best!.description);
  return {
    locator: matchingCandidate?.locate(page),
    resolvedLocator: best,
    candidates: ranked,
    usedAi,
    note: undefined as string | undefined,
  };
}

async function askLlmForTarget(page: Page, description: string, ctx: StepResolveContext): Promise<string | undefined> {
  let provider: LlmProvider;
  try {
    provider = getLlmProvider();
  } catch {
    return undefined;
  }
  if (provider.name === "none") return undefined;

  let snapshot = "";
  try {
    snapshot = await page.locator("body").ariaSnapshot({ ref: true } as any);
  } catch {
    snapshot = await page.content();
  }
  const scan = scanForInjection(snapshot);
  if (scan.suspicious) ctx.onInjectionAlert(scan.matches);

  const prompt = [
    `A plain-English test step refers to an element described as: "${description}".`,
    `Below is the page's accessibility snapshot. Suggest the single best, most specific accessible name or label`,
    `to locate that one element (prefer exact visible text). Reply with ONLY the short name/label, no explanation.`,
    "",
    wrapUntrusted("accessibility snapshot", snapshot.slice(0, 8000)),
  ].join("\n");

  try {
    const result = await provider.complete([{ role: "user", content: prompt }], { purpose: "author", maxTokens: 100 });
    ctx.onLlmUsage(result.costUsd);
    const cleaned = result.text.trim().replace(/^["“]|["”]$/g, "");
    return cleaned || undefined;
  } catch {
    return undefined;
  }
}

type AssertionResult = {
  resolutionOk: boolean;
  resolutionNote?: string;
  usedAi: boolean;
  candidates?: ResolvedStep["candidates"];
  locator?: ResolvedStep["locator"];
};

async function verifyAssertion(page: Page, step: ParsedStep, ctx: StepResolveContext): Promise<AssertionResult> {
  if (step.action === "expect_count") {
    // Count assertions intentionally want >1 match, so the uniqueness-penalizing
    // ranking in pickBest() doesn't apply here -- just take the first candidate
    // (in stability order) that matches anything on the page.
    const description = step.targetDescription ?? "";
    const expected = Number(step.expected ?? "0");
    const candidates = buildLocatorCandidates(description);
    let chosen: { strategy: LocatorStrategy; code: string; description: string; count: number } | undefined;
    for (const c of candidates) {
      const n = await matchCount(page, c.locate);
      if (n > 0) {
        chosen = { strategy: c.strategy, code: c.code, description: c.description, count: n };
        break;
      }
    }
    if (!chosen) {
      // Every candidate matched nothing at all -- if 0 is exactly what was
      // expected, that's a genuine pass (e.g. "expect 0 shopping cart
      // badge" on an empty cart, where the badge element doesn't render),
      // not an unresolvable step. Report via the first (highest-priority)
      // candidate so the saved locator is still the stable one to recheck.
      const first = candidates[0];
      if (expected === 0 && first) {
        return {
          resolutionOk: true,
          usedAi: false,
          locator: { strategy: first.strategy, code: first.code, description: first.description, confidence: 0.7 },
        };
      }
      return { resolutionOk: false, resolutionNote: `No elements matching "${description}" found at all.`, usedAi: false };
    }
    const ok = chosen.count === expected;
    return {
      resolutionOk: ok,
      resolutionNote: ok ? undefined : `Found ${chosen.count} matching "${chosen.description}", expected ${expected}.`,
      usedAi: false,
      locator: { strategy: chosen.strategy, code: chosen.code, description: chosen.description, confidence: ok ? 0.9 : 0.5 },
    };
  }

  const found = await findTarget(page, step, ctx);
  if (!found.locator) {
    return { resolutionOk: false, resolutionNote: found.note, usedAi: found.usedAi, candidates: found.candidates };
  }
  const locator = found.locator.first();
  const base = { usedAi: found.usedAi, candidates: found.candidates, locator: found.resolvedLocator };

  try {
    switch (step.action) {
      case "expect_visible": {
        // The generated assertion (toBeVisible) auto-waits at replay time;
        // mirror that tolerance here with a short poll, so authoring
        // against ordinary async-rendered content (a spinner, a toast, a
        // badge that appears a moment after load) doesn't spuriously fail
        // just because the check landed before the page settled.
        const visible = await pollUntil(() => locator.isVisible());
        return { ...base, resolutionOk: visible, resolutionNote: visible ? undefined : "Element is not visible." };
      }
      case "expect_enabled": {
        const enabled = await pollUntil(() => locator.isEnabled());
        return { ...base, resolutionOk: enabled, resolutionNote: enabled ? undefined : "Element is disabled." };
      }
      case "expect_disabled": {
        const disabled = await pollUntil(async () => !(await locator.isEnabled()));
        return { ...base, resolutionOk: disabled, resolutionNote: disabled ? undefined : "Element is enabled, expected disabled." };
      }
      case "expect_text": {
        const expected = step.expected ?? "";
        let lastText = "";
        const ok = await pollUntil(async () => {
          lastText = (await locator.innerText().catch(() => locator.textContent())) ?? "";
          return lastText.includes(expected);
        });
        return { ...base, resolutionOk: ok, resolutionNote: ok ? undefined : `Text was "${lastText}", expected it to contain "${expected}".` };
      }
      case "expect_value": {
        const expected = step.expected ?? "";
        let lastValue = "";
        const ok = await pollUntil(async () => {
          lastValue = await locator.inputValue().catch(() => "");
          return lastValue === expected;
        });
        return { ...base, resolutionOk: ok, resolutionNote: ok ? undefined : `Value was "${lastValue}", expected "${expected}".` };
      }
      default:
        return { ...base, resolutionOk: false, resolutionNote: "Unsupported assertion." };
    }
  } catch (err: any) {
    return { ...base, resolutionOk: false, resolutionNote: err?.message ?? String(err) };
  }
}

async function pollUntil(check: () => Promise<boolean>, timeoutMs = 3000, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
