import { seedDemoProjects } from "./seed.js";
import { runTriageBenchmark } from "./triage-benchmark.js";
import { runHealingBenchmark } from "./healing-benchmark.js";
import { runStabilityBenchmark } from "./stability-benchmark.js";
import { runSafetyBenchmark } from "./safety-benchmark.js";

/**
 * Runs the whole evaluation suite described in README.md "Evaluation": seed
 * the 61-test authoring corpus, then the triage confusion matrix, healing
 * correctness, stability-gate, and safety-layer benchmarks, in sequence
 * against the one running demo app. Each script also runs standalone
 * (`tsx eval/<name>.ts`) if you only want one section.
 *
 * Not included here, since they need a human or external state: the full
 * corpus's live pass/fail run (see README for the exact command and
 * numbers), the production-lock on/off check (needs two separate processes,
 * see README), and the non-developer usability notes (see README).
 */
async function main() {
  console.log("=== Seeding the 61-test authoring corpus (BuggyMart, TodoMVC, SauceDemo) ===");
  await seedDemoProjects();

  console.log("\n=== Triage confusion matrix ===");
  await runTriageBenchmark();

  console.log("\n=== Healing correctness ===");
  await runHealingBenchmark();

  console.log("\n=== Stability gate (100 real runs of a genuinely flaky page) ===");
  await runStabilityBenchmark();

  console.log("\n=== Safety layer (live, against a real browser) ===");
  await runSafetyBenchmark();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
