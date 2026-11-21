import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import { ROOT_DIR } from "../config/env.js";
import type { RunRecord, RunStatus, StepRunResult, TestDefinition } from "../types.js";

export interface RunOptions {
  tests: TestDefinition[];
  browsers: Array<"chromium" | "firefox" | "webkit">;
  viewports: Array<"desktop" | "mobile">;
  headed?: boolean;
  retries?: number;
  workers?: number;
}

interface RawStep {
  title: string;
  duration: number;
  error?: { message?: string };
  steps?: RawStep[];
}

interface RawAttachment {
  name: string;
  path?: string;
  contentType: string;
}

interface RawResult {
  status: string;
  duration: number;
  retry: number;
  error?: { message?: string };
  steps?: RawStep[];
  attachments?: RawAttachment[];
}

interface RawTest {
  projectName: string;
  results: RawResult[];
}

interface RawSpec {
  title: string;
  file: string;
  tests: RawTest[];
}

function collectSpecs(node: any, out: RawSpec[]): void {
  if (!node) return;
  if (Array.isArray(node.specs)) out.push(...node.specs);
  if (Array.isArray(node.suites)) for (const s of node.suites) collectSpecs(s, out);
}

// Playwright's JSON reporter carries terminal ANSI color codes inside
// error.message (it reuses the same formatting used for console output).
// Strip them so stored errors -- which feed the triage classifier, the
// web UI, and reports -- are plain, readable text everywhere.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function flattenSteps(steps: RawStep[] | undefined, out: StepRunResult[]): void {
  if (!steps) return;
  for (const s of steps) {
    const m = s.title.match(/^Step (\d+):\s*(.*)$/);
    if (m) {
      out.push({
        index: Number(m[1]),
        sentence: m[2],
        status: s.error ? "failed" : "passed",
        durationMs: s.duration,
        error: s.error?.message ? stripAnsi(s.error.message) : undefined,
      });
    }
    if (s.steps) flattenSteps(s.steps, out);
  }
}

function readAttachmentJson<T>(attachments: RawAttachment[] | undefined, name: string): T | undefined {
  const a = attachments?.find((x) => x.name === name);
  if (!a?.path || !fs.existsSync(a.path)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(a.path, "utf-8"));
  } catch {
    return undefined;
  }
}

function attachmentPath(attachments: RawAttachment[] | undefined, name: string): string | undefined {
  return attachments?.find((x) => x.name === name)?.path;
}

/**
 * Drives the actual Playwright Test runner as a subprocess (no LLM
 * involvement anywhere in this file -- that's the zero-LLM-replay
 * guarantee) and turns its JSON reporter output into RunRecords, one per
 * (test x browser x viewport) project combination.
 */
export async function runTests(opts: RunOptions): Promise<RunRecord[]> {
  const resultsJson = path.join(os.tmpdir(), `testwise-results-${nanoid(8)}.json`);
  const outputDir = path.join(os.tmpdir(), `testwise-output-${nanoid(8)}`);

  // Pass paths relative to the config's testDir ("projects"), with forward
  // slashes, as Playwright's CLI path filter matches against POSIX-style
  // relative paths -- an absolute Windows path with backslashes silently
  // fails to filter, which previously made it run every generated spec.
  const specFiles = opts.tests
    .map((t) => t.specPath)
    .filter((p): p is string => !!p)
    .map((p) => path.relative(path.join(ROOT_DIR, "projects"), p).split(path.sep).join("/"));
  if (specFiles.length === 0) return [];

  const env = {
    ...process.env,
    TESTWISE_RUN_BROWSERS: opts.browsers.join(","),
    TESTWISE_RUN_VIEWPORT: opts.viewports.join(","),
    TESTWISE_RETRIES: String(opts.retries ?? 1),
    TESTWISE_HEADED: opts.headed ? "true" : "false",
    TESTWISE_OUTPUT_DIR: outputDir,
    TESTWISE_RESULTS_JSON: resultsJson,
    ...(opts.workers ? { TESTWISE_WORKERS: String(opts.workers) } : {}),
  };

  await new Promise<void>((resolve) => {
    const child = spawn("npx", ["playwright", "test", ...specFiles, "--config=playwright.config.ts"], {
      cwd: ROOT_DIR,
      env,
      stdio: "inherit",
      shell: true,
    });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });

  if (!fs.existsSync(resultsJson)) {
    return opts.tests.map((t) => emptyFailedRun(t, "Playwright did not produce a results file -- it may have crashed before starting."));
  }

  const report = JSON.parse(fs.readFileSync(resultsJson, "utf-8"));
  const specs: RawSpec[] = [];
  collectSpecs(report, specs);

  const records: RunRecord[] = [];
  const testsByTitle = new Map(opts.tests.map((t) => [t.title, t]));

  for (const spec of specs) {
    const test = testsByTitle.get(spec.title);
    if (!test) continue;

    for (const rawTest of spec.tests) {
      const results = rawTest.results;
      const last = results[results.length - 1];
      if (!last) continue;

      const statuses = results.map((r) => r.status);
      let status: RunStatus;
      if (last.status === "passed" && results.length > 1 && statuses.some((s) => s === "failed" || s === "timedOut")) status = "flaky";
      else if (last.status === "passed") status = "passed";
      else if (last.status === "skipped") status = "skipped";
      else status = "failed";

      const stepResults: StepRunResult[] = [];
      flattenSteps(last.steps, stepResults);

      const [browser, viewport] = splitProjectName(rawTest.projectName);
      const consoleErrors = readAttachmentJson<string[]>(last.attachments, "console-errors.json") ?? [];
      const networkErrors = readAttachmentJson<string[]>(last.attachments, "network-errors.json") ?? [];

      records.push({
        id: nanoid(10),
        testId: test.id,
        projectId: test.projectId,
        status,
        browser,
        viewport,
        startedAt: new Date(Date.now() - last.duration).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: last.duration,
        retries: results.length - 1,
        attempts: results.length,
        tracePath: attachmentPath(last.attachments, "trace"),
        videoPath: attachmentPath(last.attachments, "video"),
        screenshotPaths: [attachmentPath(last.attachments, "screenshot")].filter((p): p is string => !!p),
        consoleErrors,
        networkErrors,
        stepResults,
        llmCallsUsed: 0,
        error: last.error?.message ? stripAnsi(last.error.message) : undefined,
      });
    }
  }

  return records;
}

function splitProjectName(name: string): ["chromium" | "firefox" | "webkit", "desktop" | "mobile"] {
  const [browser, viewport] = name.split("-");
  return [(browser as any) ?? "chromium", (viewport as any) ?? "desktop"];
}

function emptyFailedRun(test: TestDefinition, error: string): RunRecord {
  const now = new Date().toISOString();
  return {
    id: nanoid(10),
    testId: test.id,
    projectId: test.projectId,
    status: "failed",
    browser: "chromium",
    viewport: "desktop",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    retries: 0,
    attempts: 1,
    screenshotPaths: [],
    consoleErrors: [],
    networkErrors: [],
    stepResults: [],
    llmCallsUsed: 0,
    error,
  };
}
