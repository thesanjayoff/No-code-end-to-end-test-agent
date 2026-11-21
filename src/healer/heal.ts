import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { nanoid } from "nanoid";
import type { HealProposal, ParsedStep, ProjectConfig, ResolvedStep, TestDefinition } from "../types.js";
import { findTarget, resolveOneStep, type StepResolveContext } from "../resolver/resolve.js";
import { assertHealIsAllowed } from "./guard.js";
import { SecretVault } from "../safety/secrets.js";
import { assertAllowListed } from "../safety/allowlist.js";
import { resolvedPath, specPath, specBackupPath, stepMapPath } from "../storage/testFiles.js";
import { generateSpec, writeGeneratedFiles } from "../codegen/generate.js";
import { insertHeal, decideHeal, insertBugReport } from "../storage/repo.js";

function loadParsedSteps(test: TestDefinition): ResolvedStep[] {
  return JSON.parse(fs.readFileSync(resolvedPath(test.projectId, test.id), "utf-8"));
}

function similarName(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  return na === nb;
}

export interface ProposeHealOptions {
  test: TestDefinition;
  project: ProjectConfig;
  failedStepIndex: number;
  runId: string;
  reason: "ui_drift" | "flake";
}

/**
 * Replays a test from the start (same deterministic resolver used at
 * authoring time) up to the failing step, then re-resolves ONLY that step's
 * target fresh against the live page. If a confident replacement is found,
 * proposes a locator heal; for flaky timing failures, proposes an explicit
 * wait instead. Every proposal passes through the guardrail before it's
 * ever persisted.
 */
export async function proposeHeal(opts: ProposeHealOptions): Promise<HealProposal | { blocked: string }> {
  const oldSteps = loadParsedSteps(opts.test);
  const failing = oldSteps.find((s) => s.index === opts.failedStepIndex);
  if (!failing) return { blocked: `Step ${opts.failedStepIndex} not found in the saved resolution.` };

  if (opts.reason === "flake") {
    const before = "(no explicit wait before this step)";
    const after = `await page.waitForLoadState('networkidle').catch(() => {}); // before step ${opts.failedStepIndex}`;
    const guard = assertHealIsAllowed({ kind: "wait", before, after, stepAction: failing.action });
    if (!guard.allowed) return { blocked: guard.reason };
    return insertHeal({
      testId: opts.test.id,
      runId: opts.runId,
      stepIndex: opts.failedStepIndex,
      kind: "wait",
      before,
      after,
      beforeEvidence: "No explicit wait was present; this run passed only after a retry.",
      afterEvidence: "Adding a settle point before the step removes the race without touching intent.",
      rationale: "Flaky run (passed on retry) -- proposing a timing fix, not a locator change.",
      autoApprovable: false,
      status: "pending",
    });
  }

  assertAllowListed(opts.test.startUrl, opts.project);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const vault = new SecretVault();
  const envVars = { baseUrl: opts.project.environments[opts.test.environment]?.baseUrl ?? "" };
  const ctx: StepResolveContext = {
    project: opts.project,
    envVars,
    vault,
    screenshotDir: path.join(path.dirname(resolvedPath(opts.project.id, opts.test.id)), "heal-tmp"),
    useAi: false,
    onLlmUsage: () => {},
    onInjectionAlert: () => {},
  };
  fs.mkdirSync(ctx.screenshotDir, { recursive: true });

  try {
    for (const step of oldSteps) {
      if (step.index >= opts.failedStepIndex) break;
      await resolveOneStep(page, step, ctx);
    }

    const found = await findTarget(page, failing, ctx);
    const oldLocator = failing.locator;

    if (!found.resolvedLocator) {
      // No plausible replacement at all -- this is evidence the element is
      // genuinely gone, not renamed. That's a real bug, not drift.
      const report = insertBugReport({
        testId: opts.test.id,
        runId: opts.runId,
        stepIndex: opts.failedStepIndex,
        summary: `No element matching "${failing.targetDescription ?? failing.sentence}" could be found anywhere on the page, even with relaxed matching. This looks like the element was removed, not just renamed.`,
        evidence: [found.note ?? "No candidates found."],
      });
      return { blocked: `No healable locator found. Filed bug report ${report.id} instead.` };
    }

    const best = found.resolvedLocator;
    const before = oldLocator?.code ?? "(unknown previous locator)";
    const after = best.code;

    const guard = assertHealIsAllowed({ kind: "locator", before, after, stepAction: failing.action });
    if (!guard.allowed) return { blocked: guard.reason };

    const autoApprovable =
      best.strategy === "role" && oldLocator?.strategy === "role" && similarName(extractName(before), extractName(after)) && best.confidence > 0.8;

    return insertHeal({
      testId: opts.test.id,
      runId: opts.runId,
      stepIndex: opts.failedStepIndex,
      kind: "locator",
      before,
      after,
      beforeEvidence: `Last known-good locator (strategy: ${oldLocator?.strategy ?? "unknown"}).`,
      afterEvidence: `Found via ${best.strategy} on the current page (confidence ${best.confidence.toFixed(2)}).`,
      rationale:
        best.strategy === oldLocator?.strategy
          ? "Same locator strategy still resolves, but to a different match -- likely a label/text rename, not a behavior change."
          : `Original strategy ("${oldLocator?.strategy}") no longer resolves uniquely; falling back to ${best.strategy}, which is lower in the stability order.`,
      autoApprovable,
      status: "pending",
    });
  } finally {
    await browser.close();
  }
}

function extractName(code: string): string | undefined {
  const m = code.match(/name:\s*'([^']*)'/) ?? code.match(/getBy(?:Label|Text|TestId)\('([^']*)'\)/);
  return m?.[1];
}

export function applyHeal(heal: HealProposal, test: TestDefinition): void {
  const guard = assertHealIsAllowed({ kind: heal.kind, before: heal.before, after: heal.after, stepAction: "" });
  if (!guard.allowed) throw new Error(`Refusing to apply heal ${heal.id}: ${guard.reason}`);

  const resolved: ResolvedStep[] = JSON.parse(fs.readFileSync(resolvedPath(test.projectId, test.id), "utf-8"));
  const step = resolved.find((s) => s.index === heal.stepIndex);
  if (!step) throw new Error(`Step ${heal.stepIndex} not found.`);

  const spec = specPath(test.projectId, test.id);
  const backup = specBackupPath(test.projectId, test.id, heal.id);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  if (fs.existsSync(spec)) fs.copyFileSync(spec, backup);

  if (heal.kind === "locator" && step.locator) {
    step.locator = { ...step.locator, code: heal.after, description: heal.after, confidence: 0.9 };
    step.resolutionOk = true;
    step.resolutionNote = `Healed (heal ${heal.id}): ${heal.rationale}`;
  }

  fs.writeFileSync(resolvedPath(test.projectId, test.id), JSON.stringify(resolved, null, 2));
  const gen = generateSpec({ title: test.title, startUrl: test.startUrl, steps: resolved });
  writeGeneratedFiles({ specPath: spec, stepMapPath: stepMapPath(test.projectId, test.id), result: gen });

  decideHeal(heal.id, "approved", "user");
}

export function revertHeal(heal: HealProposal, test: TestDefinition): void {
  const backup = specBackupPath(test.projectId, test.id, heal.id);
  if (!fs.existsSync(backup)) throw new Error(`No backup found for heal ${heal.id}; cannot revert.`);
  fs.copyFileSync(backup, specPath(test.projectId, test.id));
  decideHeal(heal.id, "reverted", "user");
}

export function rejectHeal(heal: HealProposal): void {
  decideHeal(heal.id, "rejected", "user");
}
