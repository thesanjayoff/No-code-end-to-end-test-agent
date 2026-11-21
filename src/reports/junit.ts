import type { RunRecord, TestDefinition } from "../types.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Renders a set of runs as a JUnit XML report, for CI consumption. */
export function toJUnitXml(entries: Array<{ test: TestDefinition; run: RunRecord }>): string {
  const failures = entries.filter((e) => e.run.status === "failed").length;
  const total = entries.length;
  const totalTimeSec = entries.reduce((s, e) => s + e.run.durationMs, 0) / 1000;

  const cases = entries
    .map(({ test, run }) => {
      const name = esc(`${test.title} [${run.browser}/${run.viewport}]`);
      const timeSec = (run.durationMs / 1000).toFixed(3);
      if (run.status === "passed" || run.status === "flaky") {
        return `  <testcase name="${name}" classname="${esc(test.projectId)}" time="${timeSec}"${run.status === "flaky" ? ' status="flaky"' : ""}/>`;
      }
      if (run.status === "skipped" || run.status === "quarantined") {
        return `  <testcase name="${name}" classname="${esc(test.projectId)}" time="${timeSec}"><skipped/></testcase>`;
      }
      const message = esc(run.error ?? "Test failed");
      return `  <testcase name="${name}" classname="${esc(test.projectId)}" time="${timeSec}"><failure message="${message}">${message}</failure></testcase>`;
    })
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuite name="Testwise" tests="${total}" failures="${failures}" time="${totalTimeSec.toFixed(3)}">`,
    cases,
    `</testsuite>`,
    ``,
  ].join("\n");
}
