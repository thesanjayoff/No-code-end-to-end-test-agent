import { describe, it, expect } from "vitest";
import { classifyDeterministic } from "../src/triage/classify.js";
import type { RunRecord } from "../src/types.js";

function baseRun(overrides: Partial<RunRecord>): RunRecord {
  return {
    id: "r1",
    testId: "t1",
    projectId: "p1",
    status: "failed",
    browser: "chromium",
    viewport: "desktop",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1000,
    retries: 0,
    attempts: 1,
    screenshotPaths: [],
    consoleErrors: [],
    networkErrors: [],
    stepResults: [],
    llmCallsUsed: 0,
    ...overrides,
  };
}

describe("deterministic triage classifier", () => {
  it("classifies a pass-after-retry as flake, not a clean pass", () => {
    const run = baseRun({ status: "flaky", retries: 1, attempts: 2 });
    const result = classifyDeterministic(run, () => "action");
    expect(result.classification).toBe("flake");
  });

  it("classifies a failed assertion as a real bug, never ui_drift", () => {
    const run = baseRun({
      stepResults: [{ index: 2, sentence: "expect total", status: "failed", durationMs: 10, error: "expect(locator).toContainText: received: '$10' expected: '$20'" }],
    });
    const result = classifyDeterministic(run, (i) => (i === 2 ? "assertion" : "action"));
    expect(result.classification).toBe("real_bug");
    expect(result.classification).not.toBe("ui_drift");
  });

  it("classifies a locator-not-found action failure as tentative ui_drift", () => {
    const run = baseRun({
      stepResults: [{ index: 1, sentence: "click Pay", status: "failed", durationMs: 10, error: "waiting for locator('button') to be visible" }],
    });
    const result = classifyDeterministic(run, (i) => (i === 1 ? "action" : undefined));
    expect(result.classification).toBe("ui_drift");
  });

  it("classifies a network/server error as environment, even on an assertion step", () => {
    const run = baseRun({
      networkErrors: ["502 https://example.com/api/total"],
      stepResults: [{ index: 2, sentence: "expect total", status: "failed", durationMs: 10, error: "expect received undefined" }],
    });
    const result = classifyDeterministic(run, (i) => (i === 2 ? "assertion" : "action"));
    expect(result.classification).toBe("environment");
  });

  it("does not mistake a '5000ms' timeout for a 5xx network status", () => {
    const run = baseRun({
      stepResults: [{ index: 2, sentence: "expect total", status: "failed", durationMs: 10, error: "expect(locator).toContainText failed\nTimeout: 5000ms" }],
    });
    const result = classifyDeterministic(run, (i) => (i === 2 ? "assertion" : "action"));
    expect(result.classification).toBe("real_bug");
  });

  it("falls back to unknown when nothing matches", () => {
    const run = baseRun({ stepResults: [{ index: 1, sentence: "???", status: "failed", durationMs: 1, error: "something weird happened" }] });
    const result = classifyDeterministic(run, () => undefined);
    expect(result.classification).toBe("unknown");
  });
});
