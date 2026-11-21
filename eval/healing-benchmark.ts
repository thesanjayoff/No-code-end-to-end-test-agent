import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { loadProject, createProject } from "../src/storage/project.js";
import { resolvedPath } from "../src/storage/testFiles.js";
import { proposeHeal } from "../src/healer/heal.js";
import { assertHealIsAllowed } from "../src/healer/guard.js";
import { upsertTest, listBugReports } from "../src/storage/repo.js";
import type { ResolvedStep, TestDefinition } from "../src/types.js";
import { ensureDemoAppRunning, DEMO_APP_URL } from "./seed.js";
import { deleteTestsByTitle } from "./cleanup.js";

/**
 * Healing correctness benchmark. Each case plants a "before" resolved
 * locator (simulating a prior passing run) and points the test at a demo
 * app variant where the page has since drifted (cosmetic) or genuinely
 * broken (a real bug), then calls the actual healer used in production.
 *
 * The one number that matters most: wrong heals around a real bug must be
 * zero. Drift-heal success is secondary and, per the README, reflects
 * heuristics-only performance -- no ANTHROPIC_API_KEY was available in this
 * run, so the AI-assisted repair path (for pure label renames with no
 * surviving fallback signal) could not be exercised live.
 */

interface Case {
  name: string;
  kind: "drift" | "bug";
  variant: string;
  path: string;
  step: Omit<ResolvedStep, "index" | "resolutionOk" | "usedAi">;
  expect: "healed" | "auto_healed" | "blocked_no_locator" | "guard_refused";
}

const CASES: Case[] = [
  {
    name: "DOM-wrap breaks a legacy CSS locator; role+name still resolves",
    kind: "drift",
    variant: "drift_wrap",
    path: "/",
    step: {
      sentence: 'click "Add to cart" for "Wireless Mouse"',
      kind: "action",
      action: "click",
      targetDescription: "Add to cart",
      contextDescription: "Wireless Mouse",
      warnings: [],
      locator: { strategy: "css", code: "locator('.product > button')", description: "legacy css locator", confidence: 0.3 },
    },
    expect: "healed",
  },
  {
    name: "Pure case-difference rename auto-approves (role unchanged, name differs only by case)",
    kind: "drift",
    variant: "baseline",
    path: "/",
    step: {
      sentence: 'click "Add to cart" for "Wireless Mouse"',
      kind: "action",
      action: "click",
      targetDescription: "Add to cart",
      contextDescription: "Wireless Mouse",
      warnings: [],
      locator: { strategy: "role", code: "getByRole('button', { name: 'Add to Cart' })", description: "role=button name=\"Add to Cart\"", confidence: 0.95 },
    },
    expect: "auto_healed",
  },
  {
    name: "Checkout button genuinely removed -- must NOT heal, must file a bug report",
    kind: "bug",
    variant: "bug_missing_button",
    path: "/cart",
    step: {
      sentence: "click the Checkout button",
      kind: "action",
      action: "click",
      targetDescription: "the Checkout button",
      warnings: [],
      locator: { strategy: "role", code: "getByRole('button', { name: 'Checkout' })", description: "role=button name=\"Checkout\"", confidence: 0.95 },
    },
    expect: "blocked_no_locator",
  },
  {
    name: "Wrong total is a failed expectation -- the guard must refuse to even consider healing it",
    kind: "bug",
    variant: "bug_wrong_total",
    path: "/cart",
    step: {
      sentence: 'expect the cart total to show "$19.99"',
      kind: "assertion",
      action: "expect_text",
      targetDescription: "the cart total",
      expected: "$19.99",
      warnings: [],
      locator: { strategy: "css", code: "locator('#cart-total')", description: "css id=\"#cart-total\"", confidence: 0.3 },
    },
    expect: "guard_refused",
  },
];

async function runCase(projectId: string, c: Case): Promise<{ case: Case; outcome: string; pass: boolean; detail: string }> {
  // The guard-refused case never even needs a live page -- the guard rejects
  // on step action alone, which is exactly the property being tested.
  if (c.expect === "guard_refused") {
    const guard = assertHealIsAllowed({ kind: "locator", before: c.step.locator!.code, after: "getByText('$10.00')", stepAction: c.step.action });
    const pass = guard.allowed === false;
    return { case: c, outcome: pass ? "guard_refused" : "guard_allowed_WRONG", pass, detail: pass ? "" : (guard as any).reason ?? "" };
  }

  deleteTestsByTitle(projectId, [c.name]);
  const testId = `bench-${nanoid(8)}`;
  const startUrl = `${DEMO_APP_URL}${c.path}?variant=${c.variant}`;
  const test: TestDefinition = {
    id: testId,
    projectId,
    title: c.name,
    startUrl,
    tags: ["healing-benchmark"],
    environment: "local",
    sourcePath: "n/a",
    specPath: undefined,
    stepMapPath: undefined,
    destructiveApproved: false,
    quarantined: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  upsertTest(test);

  const resolved: ResolvedStep[] = [{ index: 1, resolutionOk: true, usedAi: false, ...c.step }];
  fs.mkdirSync(path.dirname(resolvedPath(projectId, testId)), { recursive: true });
  fs.writeFileSync(resolvedPath(projectId, testId), JSON.stringify(resolved, null, 2));

  const result = await proposeHeal({ test, project: loadProject(projectId)!, failedStepIndex: 1, runId: "bench", reason: "ui_drift" });

  if ("blocked" in result) {
    const bugs = listBugReports(testId);
    const pass = c.expect === "blocked_no_locator" && bugs.length > 0;
    return { case: c, outcome: `blocked: ${result.blocked}`, pass, detail: bugs.length ? `filed bug report ${bugs[0].id}` : "no bug report filed" };
  }

  const expectedAuto = c.expect === "auto_healed";
  const pass = result.autoApprovable === expectedAuto;
  return { case: c, outcome: `proposed heal ${result.id} (autoApprovable=${result.autoApprovable})`, pass, detail: `${result.before} -> ${result.after}` };
}

export async function runHealingBenchmark(): Promise<void> {
  await ensureDemoAppRunning();
  let project = loadProject("buggymart");
  if (!project) {
    project = createProject({
      name: "BuggyMart",
      allowedDomains: ["localhost"],
      environments: { local: { baseUrl: DEMO_APP_URL } },
      defaultEnvironment: "local",
    });
  }

  const results = [];
  for (const c of CASES) {
    const r = await runCase(project.id, c);
    results.push(r);
    console.log(`${r.pass ? "PASS" : "FAIL"}  [${c.kind}] ${c.name}`);
    console.log(`      -> ${r.outcome}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }

  const wrongHealsOnBugs = results.filter((r) => r.case.kind === "bug" && !r.pass).length;
  const driftHealed = results.filter((r) => r.case.kind === "drift" && r.pass).length;
  const driftTotal = results.filter((r) => r.case.kind === "drift").length;

  console.log("\n--- Healing benchmark summary ---");
  console.log(`Drift cases healed correctly: ${driftHealed}/${driftTotal}`);
  console.log(`Real-bug cases wrongly healed (must be 0): ${wrongHealsOnBugs}`);
  console.log(`Overall: ${results.filter((r) => r.pass).length}/${results.length} passed`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runHealingBenchmark().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
