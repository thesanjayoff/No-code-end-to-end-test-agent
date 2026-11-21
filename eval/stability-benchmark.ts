import { createProject, loadProject } from "../src/storage/project.js";
import { authorTest } from "../src/authoring/author.js";
import { runTests } from "../src/runner/run.js";
import { runStabilityCheck } from "../src/flake/stability.js";
import { ensureDemoAppRunning, DEMO_APP_URL } from "./seed.js";

/**
 * Stability-check evaluation. demo-app's /flaky route is genuinely
 * non-deterministic (its "Ready" badge is delayed past a normal assertion
 * timeout on ~30% of loads, by real setTimeout jitter, not a scripted
 * pass/fail) -- exactly the case the "run 20/100 times before marking a
 * test stable" gate exists for.
 *
 * Shows two things a single run can't:
 *  1. Without the stability gate, a lone run's pass or fail is close to a
 *     coin flip -- not evidence the test (or the page) is reliable.
 *  2. The runner's own retry pass (the same one every normal replay uses)
 *     already turns a flaky single attempt into status "flaky" rather than
 *     a false "failed" -- the stability gate's job is to then quantify how
 *     OFTEN that happens, so a test isn't marked stable off a lucky run.
 */
export async function runStabilityBenchmark(): Promise<void> {
  await ensureDemoAppRunning();
  let project = loadProject("buggymart");
  if (!project) {
    project = createProject({ name: "BuggyMart", allowedDomains: ["localhost"], environments: { local: { baseUrl: DEMO_APP_URL } }, defaultEnvironment: "local" });
  }

  // Authoring itself hits the same 30% delayed-load chance as any other
  // visit to /flaky, so a single authoring attempt can legitimately fail
  // to resolve -- retry a few times rather than treat that as a bug.
  let test;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const report = await authorTest({
      project,
      source: {
        title: "stability-bench: flaky badge",
        startUrl: "/flaky",
        environment: "local",
        tags: ["stability-benchmark"],
        steps: ['expect "Ready" to be visible'],
      },
      useAi: false,
    });
    const unresolved = report.resolution.resolvedSteps.filter((s) => !s.resolutionOk);
    if (!unresolved.length) {
      test = report.test;
      break;
    }
    console.log(`  (authoring attempt ${attempt} hit the slow-load branch, retrying...)`);
  }
  if (!test) throw new Error("stability-bench test didn't resolve after 5 attempts -- can't run the benchmark.");

  console.log("Single bare runs (retries: 0) -- what one run alone tells you:");
  const bareOutcomes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const [run] = await runTests({ tests: [test], browsers: ["chromium"], viewports: ["desktop"], retries: 0, workers: 1 });
    bareOutcomes.push(run.status);
  }
  console.log(`  ${bareOutcomes.join(", ")}`);
  const bareFailures = bareOutcomes.filter((s) => s === "failed").length;
  console.log(`  ${bareFailures}/10 failed outright with no retry -- a single run is not evidence either way.\n`);

  console.log("One run with the runner's normal retry pass (retries: 1):");
  const [retried] = await runTests({ tests: [test], browsers: ["chromium"], viewports: ["desktop"], retries: 1, workers: 1 });
  console.log(`  status: ${retried.status} (attempts: ${retried.attempts}, retries: ${retried.retries})`);
  console.log(`  ${retried.status === "flaky" ? "Correctly flagged as flaky, not a false failure." : "Passed clean or failed even after a retry."}\n`);

  console.log("Stability check: 100 sequential runs (the real gate used before marking a test stable)...");
  const result = await runStabilityCheck(test, 100);
  console.log(`  passed: ${result.passed}, failed: ${result.failed}, flaky: ${result.flaky}, out of ${result.iterations}`);
  console.log(`  flake rate: ${(result.flakeRate * 100).toFixed(1)}%`);
  console.log(`  stable: ${result.stable}`);
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith("stability-benchmark.ts")) {
  runStabilityBenchmark().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
