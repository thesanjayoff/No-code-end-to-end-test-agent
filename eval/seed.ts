// Thin re-export: the actual seeding logic lives in src/demo/seed.ts so the
// built CLI's `testwise seed` command can use it too (eval/ sits outside
// src/'s build root). This file just keeps `npx tsx eval/seed.ts` working as
// a direct entry point for the evaluation harness.
import { fileURLToPath } from "node:url";
import { seedDemoProjects } from "../src/demo/seed.js";

export { DEMO_APP_PORT, DEMO_APP_URL, ensureDemoAppRunning, BUGGYMART_TESTS, seedDemoProjects } from "../src/demo/seed.js";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedDemoProjects().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
