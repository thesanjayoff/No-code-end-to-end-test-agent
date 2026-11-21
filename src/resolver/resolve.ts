import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { ParsedStep, ProjectConfig, ResolvedStep } from "../types.js";
import { buildLocatorCandidates } from "./locatorStrategies.js";
import { pickBest } from "../locator/rank.js";
import { assertAllowListed, checkAllowListed } from "../safety/allowlist.js";
import { evaluateDestructiveGuard } from "../safety/destructive.js";
import { wrapUntrusted, scanForInjection } from "../safety/injection.js";
import { substituteTemplates } from "./testData.js";
import { SecretVault } from "../safety/secrets.js";
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
        return { ...step, resolutionOk: true, screenshotPath, usedAi: false };
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

async function verifyAssertion(
  page: Page,
  step: ParsedStep,
  ctx: StepResolveContext
): Promise<{ resolutionOk: boolean; resolutionNote?: string; usedAi: boolean; candidates?: ResolvedStep["candidates"] }> {
  if (step.action === "expect_count") {
    // Count assertions intentionally want >1 match, so the uniqueness-penalizing
    // ranking in pickBest() doesn't apply here -- just take the first candidate
    // (in stability order) that matches anything on the page.
    const description = step.targetDescription ?? "";
    const candidates = buildLocatorCandidates(description);
    let chosen: { description: string; count: number } | undefined;
    for (const c of candidates) {
      const n = await matchCount(page, c.locate);
      if (n > 0) {
        chosen = { description: c.description, count: n };
        break;
      }
    }
    if (!chosen) return { resolutionOk: false, resolutionNote: `No elements matching "${description}" found at all.`, usedAi: false };
    const expected = Number(step.expected ?? "0");
    const ok = chosen.count === expected;
    return { resolutionOk: ok, resolutionNote: ok ? undefined : `Found ${chosen.count} matching "${chosen.description}", expected ${expected}.`, usedAi: false };
  }

  const found = await findTarget(page, step, ctx);
  if (!found.locator) {
    return { resolutionOk: false, resolutionNote: found.note, usedAi: found.usedAi, candidates: found.candidates };
  }
  const locator = found.locator.first();

  try {
    switch (step.action) {
      case "expect_visible": {
        const visible = await locator.isVisible();
        return { resolutionOk: visible, resolutionNote: visible ? undefined : "Element is not visible.", usedAi: found.usedAi, candidates: found.candidates };
      }
      case "expect_enabled": {
        const enabled = await locator.isEnabled();
        return { resolutionOk: enabled, resolutionNote: enabled ? undefined : "Element is disabled.", usedAi: found.usedAi, candidates: found.candidates };
      }
      case "expect_disabled": {
        const enabled = await locator.isEnabled();
        return { resolutionOk: !enabled, resolutionNote: !enabled ? undefined : "Element is enabled, expected disabled.", usedAi: found.usedAi, candidates: found.candidates };
      }
      case "expect_text": {
        const text = (await locator.innerText().catch(() => locator.textContent())) ?? "";
        const expected = step.expected ?? "";
        const ok = (text ?? "").includes(expected);
        return { resolutionOk: ok, resolutionNote: ok ? undefined : `Text was "${text}", expected it to contain "${expected}".`, usedAi: found.usedAi, candidates: found.candidates };
      }
      case "expect_value": {
        const value = await locator.inputValue().catch(() => "");
        const expected = step.expected ?? "";
        const ok = value === expected;
        return { resolutionOk: ok, resolutionNote: ok ? undefined : `Value was "${value}", expected "${expected}".`, usedAi: found.usedAi, candidates: found.candidates };
      }
      default:
        return { resolutionOk: false, resolutionNote: "Unsupported assertion.", usedAi: found.usedAi };
    }
  } catch (err: any) {
    return { resolutionOk: false, resolutionNote: err?.message ?? String(err), usedAi: found.usedAi, candidates: found.candidates };
  }
}
