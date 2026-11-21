import type { RunRecord, TestDefinition } from "../types.js";
import { runTests } from "../runner/run.js";
import { insertRun, flakeStatsFor } from "../storage/repo.js";

export interface StabilityCheckResult {
  testId: string;
  iterations: number;
  passed: number;
  failed: number;
  flaky: number;
  flakeRate: number;
  stable: boolean;
  runs: RunRecord[];
}

/**
 * Runs a single test N times back-to-back (sequential, fresh browser
 * context each time) and reports the observed flake rate -- the "run 20
 * times" stability gate described in the spec, before marking a test stable.
 */
export async function runStabilityCheck(test: TestDefinition, iterations: number): Promise<StabilityCheckResult> {
  const runs: RunRecord[] = [];
  for (let i = 0; i < iterations; i++) {
    const [run] = await runTests({ tests: [test], browsers: ["chromium"], viewports: ["desktop"], retries: 0, workers: 1 });
    if (run) {
      insertRun(run);
      runs.push(run);
    }
  }
  const passed = runs.filter((r) => r.status === "passed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const flaky = runs.filter((r) => r.status === "flaky").length;
  // Flake, here, means inconsistent across identical repeated runs -- not a
  // consistent 0% or 100% pass rate, which points to a real, reproducible bug instead.
  const inconsistent = passed > 0 && failed + flaky > 0;
  const flakeRate = runs.length && inconsistent ? (failed + flaky) / runs.length : 0;
  return { testId: test.id, iterations: runs.length, passed, failed, flaky, flakeRate, stable: flakeRate === 0 && failed === 0, runs };
}

export { flakeStatsFor };
