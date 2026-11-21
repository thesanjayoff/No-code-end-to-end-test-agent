import fs from "node:fs";
import { createProject, loadProject } from "../src/storage/project.js";
import { authorTest } from "../src/authoring/author.js";
import { runTests } from "../src/runner/run.js";
import { triageRun } from "../src/triage/run.js";
import type { TriageClass } from "../src/types.js";
import type { TestSource } from "../src/parser/index.js";
import { ensureDemoAppRunning, DEMO_APP_URL } from "./seed.js";

/**
 * Triage confusion-matrix benchmark. Each case authors a test against
 * BuggyMart's "baseline" variant (fully resolved, deterministic locators),
 * then swaps the variant in the already-generated spec file to simulate
 * "this is the one page the test always points at, and it changed" --
 * without re-resolving anything, exactly like a real regression -- and
 * checks the real triage classifier's output against a known ground truth.
 *
 * flake and environment classifications are deliberately NOT exercised
 * here; they're already covered deterministically in tests/triage.test.ts.
 * This benchmark is specifically for the harder, demo-app-dependent
 * distinction: cosmetic drift vs. a genuine behavior regression.
 */

interface Case {
  name: string;
  source: TestSource;
  variant: string;
  expected: TriageClass | "passed";
  note?: string;
}

const CASES: Case[] = [
  {
    name: "Cosmetic rename (Add to cart -> Add to bag)",
    variant: "drift_rename",
    expected: "ui_drift",
    source: {
      title: "triage-bench: add to cart",
      startUrl: "/?variant=baseline",
      environment: "local",
      tags: ["triage-benchmark"],
      steps: ['click "Add to cart" for "Wireless Mouse"'],
    },
  },
  {
    name: "DOM rewrap, no behavior change (should still pass)",
    variant: "drift_wrap",
    expected: "passed",
    source: {
      title: "triage-bench: add to cart (wrap)",
      startUrl: "/?variant=baseline",
      environment: "local",
      tags: ["triage-benchmark"],
      steps: ['click "Add to cart" for "Wireless Mouse"'],
    },
  },
  {
    name: "Wrong cart total (pricing bug)",
    variant: "bug_wrong_total",
    expected: "real_bug",
    source: {
      title: "triage-bench: cart total",
      startUrl: "/?variant=baseline",
      environment: "local",
      tags: ["triage-benchmark"],
      steps: [
        'click "Add to cart" for "Wireless Mouse"',
        'click "Add to cart" for "USB-C Hub"',
        "go to /cart?variant=baseline",
        'expect "$43.99" to be visible',
      ],
    },
  },
  {
    name: "Checkout button removed entirely",
    variant: "bug_missing_button",
    expected: "ui_drift",
    note: "Known limitation: triage alone can't tell 'renamed' from 'removed' -- both look like a locator-not-found. The healer's own live re-check (see eval/healing-benchmark.ts) is what catches this one and refuses to heal it.",
    source: {
      title: "triage-bench: checkout button",
      startUrl: "/?variant=baseline",
      environment: "local",
      tags: ["triage-benchmark"],
      steps: ['click "Add to cart" for "Wireless Mouse"', "go to /cart?variant=baseline", "click the Checkout button"],
    },
  },
  {
    name: "Checkout button always disabled",
    variant: "bug_disabled_field",
    expected: "real_bug",
    source: {
      title: "triage-bench: checkout disabled",
      startUrl: "/?variant=baseline",
      environment: "local",
      tags: ["triage-benchmark"],
      steps: ['click "Add to cart" for "Wireless Mouse"', "go to /cart?variant=baseline", "expect the Checkout button to be enabled"],
    },
  },
  {
    name: "Broken email validation on contact form",
    variant: "bug_broken_validation",
    expected: "real_bug",
    source: {
      title: "triage-bench: contact validation",
      startUrl: "/contact?variant=baseline",
      environment: "local",
      tags: ["triage-benchmark"],
      steps: [
        'fill name with "Jordan"',
        'fill email with "not-an-email"',
        'fill message with "Hello there"',
        "click the Send button",
        'expect the contact result to show "valid email"',
      ],
    },
  },
];

export async function runTriageBenchmark(): Promise<void> {
  await ensureDemoAppRunning();
  let project = loadProject("buggymart");
  if (!project) {
    project = createProject({ name: "BuggyMart", allowedDomains: ["localhost"], environments: { local: { baseUrl: DEMO_APP_URL } }, defaultEnvironment: "local" });
  }

  const results: Array<{ case: Case; actual: TriageClass | "passed" | "unresolved"; pass: boolean }> = [];

  for (const c of CASES) {
    // "checkout" trips the destructive-action guard (safety/destructive.ts)
    // for real -- this benchmark is read-only against our own local demo
    // app, so it's fine to pre-approve here.
    const report = await authorTest({ project, source: c.source, useAi: false, destructiveApproved: true });
    const unresolved = report.resolution.resolvedSteps.filter((s) => !s.resolutionOk);
    if (unresolved.length) {
      results.push({ case: c, actual: "unresolved", pass: false });
      console.log(`SKIP  ${c.name} -- baseline authoring didn't fully resolve (${unresolved.length} step(s)), can't establish ground truth.`);
      continue;
    }

    const test = report.test;
    if (!test.specPath) throw new Error(`No spec generated for "${c.name}".`);
    const spec = fs.readFileSync(test.specPath, "utf-8");
    fs.writeFileSync(test.specPath, spec.replaceAll("variant=baseline", `variant=${c.variant}`));

    const [run] = await runTests({ tests: [test], browsers: ["chromium"], viewports: ["desktop"], retries: 0 });
    const actual: TriageClass | "passed" = run.status === "passed" ? "passed" : (await triageRun(run, test)).classification;
    const pass = actual === c.expected;
    results.push({ case: c, actual, pass });
    console.log(`${pass ? "PASS" : "FAIL"}  ${c.name}`);
    console.log(`      expected: ${c.expected}  actual: ${actual}`);
    if (c.note) console.log(`      note: ${c.note}`);
  }

  console.log("\n--- Triage confusion matrix ---");
  console.log("case                                              | expected      | actual");
  for (const r of results) {
    console.log(`${r.case.name.padEnd(50)}| ${String(r.case.expected).padEnd(14)}| ${r.actual}`);
  }
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} matched ground truth.`);
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith("triage-benchmark.ts")) {
  runTriageBenchmark().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
