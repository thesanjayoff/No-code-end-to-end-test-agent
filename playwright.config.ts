import { defineConfig, devices } from "@playwright/test";

/**
 * Dynamic config consumed only by the Testwise runner (src/runner/run.ts),
 * which sets these env vars before spawning `playwright test`. Not meant to
 * be run by hand with plain `npx playwright test` from the repo root.
 */
const browsers = (process.env.TESTWISE_RUN_BROWSERS ?? "chromium").split(",");
const viewports = (process.env.TESTWISE_RUN_VIEWPORT ?? "desktop").split(",");
const retries = Number(process.env.TESTWISE_RETRIES ?? 0);
const headed = process.env.TESTWISE_HEADED === "true";
const outputDir = process.env.TESTWISE_OUTPUT_DIR ?? "test-results";
const resultsJson = process.env.TESTWISE_RESULTS_JSON ?? "test-results/results.json";
const workers = process.env.TESTWISE_WORKERS ? Number(process.env.TESTWISE_WORKERS) : undefined;

const DEVICE_MAP: Record<string, Record<string, any>> = {
  "chromium-desktop": devices["Desktop Chrome"],
  "chromium-mobile": devices["Pixel 7"],
  "firefox-desktop": devices["Desktop Firefox"],
  "firefox-mobile": devices["Pixel 7"], // Playwright has no Firefox-mobile device preset; viewport override below approximates it.
  "webkit-desktop": devices["Desktop Safari"],
  "webkit-mobile": devices["iPhone 14"],
};

const projects = [];
for (const browser of browsers) {
  for (const viewport of viewports) {
    const key = `${browser}-${viewport}`;
    const device = DEVICE_MAP[key] ?? devices["Desktop Chrome"];
    projects.push({
      name: key,
      use: { ...device, browserName: browser as "chromium" | "firefox" | "webkit" },
    });
  }
}

export default defineConfig({
  retries,
  workers,
  outputDir,
  reporter: [["json", { outputFile: resultsJson }], ["list"]],
  use: {
    headless: !headed,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects,
});
