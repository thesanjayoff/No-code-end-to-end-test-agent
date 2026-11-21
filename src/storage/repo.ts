import { nanoid } from "nanoid";
import { db } from "./db.js";
import type { HealProposal, RunRecord, TestDefinition, TriageResult } from "../types.js";

// ---------- tests ----------

export function upsertTest(test: TestDefinition): void {
  db.prepare(
    `INSERT INTO tests (id, project_id, title, start_url, tags, environment, source_path, spec_path, step_map_path, destructive_approved, quarantined, quarantine_reason, created_at, updated_at)
     VALUES (@id, @projectId, @title, @startUrl, @tags, @environment, @sourcePath, @specPath, @stepMapPath, @destructiveApproved, @quarantined, @quarantineReason, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, start_url=excluded.start_url, tags=excluded.tags, environment=excluded.environment,
       source_path=excluded.source_path, spec_path=excluded.spec_path, step_map_path=excluded.step_map_path,
       destructive_approved=excluded.destructive_approved, quarantined=excluded.quarantined,
       quarantine_reason=excluded.quarantine_reason, updated_at=excluded.updated_at`
  ).run({
    id: test.id,
    projectId: test.projectId,
    title: test.title,
    startUrl: test.startUrl,
    tags: JSON.stringify(test.tags),
    environment: test.environment,
    sourcePath: test.sourcePath,
    specPath: test.specPath ?? null,
    stepMapPath: test.stepMapPath ?? null,
    destructiveApproved: test.destructiveApproved ? 1 : 0,
    quarantined: test.quarantined ? 1 : 0,
    quarantineReason: test.quarantineReason ?? null,
    createdAt: test.createdAt,
    updatedAt: test.updatedAt,
  });
}

function rowToTest(row: any): TestDefinition {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    startUrl: row.start_url,
    tags: JSON.parse(row.tags),
    environment: row.environment,
    sourcePath: row.source_path,
    specPath: row.spec_path ?? undefined,
    stepMapPath: row.step_map_path ?? undefined,
    destructiveApproved: !!row.destructive_approved,
    quarantined: !!row.quarantined,
    quarantineReason: row.quarantine_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getTest(id: string): TestDefinition | undefined {
  const row = db.prepare(`SELECT * FROM tests WHERE id = ?`).get(id);
  return row ? rowToTest(row) : undefined;
}

export function listTests(projectId?: string): TestDefinition[] {
  const rows = projectId
    ? db.prepare(`SELECT * FROM tests WHERE project_id = ? ORDER BY created_at DESC`).all(projectId)
    : db.prepare(`SELECT * FROM tests ORDER BY created_at DESC`).all();
  return rows.map(rowToTest);
}

export function deleteTest(id: string): void {
  db.prepare(`DELETE FROM tests WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM runs WHERE test_id = ?`).run(id);
  db.prepare(`DELETE FROM heals WHERE test_id = ?`).run(id);
}

// ---------- runs ----------

export function insertRun(run: RunRecord): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, project_id, status, browser, viewport, started_at, finished_at, duration_ms, retries, attempts, trace_path, video_path, screenshot_paths, console_errors, network_errors, step_results, llm_calls_used, error)
     VALUES (@id, @testId, @projectId, @status, @browser, @viewport, @startedAt, @finishedAt, @durationMs, @retries, @attempts, @tracePath, @videoPath, @screenshotPaths, @consoleErrors, @networkErrors, @stepResults, @llmCallsUsed, @error)`
  ).run({
    id: run.id,
    testId: run.testId,
    projectId: run.projectId,
    status: run.status,
    browser: run.browser,
    viewport: run.viewport,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    retries: run.retries,
    attempts: run.attempts,
    tracePath: run.tracePath ?? null,
    videoPath: run.videoPath ?? null,
    screenshotPaths: JSON.stringify(run.screenshotPaths),
    consoleErrors: JSON.stringify(run.consoleErrors),
    networkErrors: JSON.stringify(run.networkErrors),
    stepResults: JSON.stringify(run.stepResults),
    llmCallsUsed: run.llmCallsUsed,
    error: run.error ?? null,
  });
}

function rowToRun(row: any): RunRecord {
  return {
    id: row.id,
    testId: row.test_id,
    projectId: row.project_id,
    status: row.status,
    browser: row.browser,
    viewport: row.viewport,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    retries: row.retries,
    attempts: row.attempts,
    tracePath: row.trace_path ?? undefined,
    videoPath: row.video_path ?? undefined,
    screenshotPaths: JSON.parse(row.screenshot_paths),
    consoleErrors: JSON.parse(row.console_errors),
    networkErrors: JSON.parse(row.network_errors),
    stepResults: JSON.parse(row.step_results),
    llmCallsUsed: row.llm_calls_used,
    error: row.error ?? undefined,
  };
}

export function listRuns(testId: string, limit = 50): RunRecord[] {
  return db.prepare(`SELECT * FROM runs WHERE test_id = ? ORDER BY started_at DESC LIMIT ?`).all(testId, limit).map(rowToRun);
}

export function getRun(id: string): RunRecord | undefined {
  const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id);
  return row ? rowToRun(row) : undefined;
}

export function lastGoodRun(testId: string, beforeRunId?: string): RunRecord | undefined {
  const rows: any[] = db.prepare(`SELECT * FROM runs WHERE test_id = ? AND status = 'passed' ORDER BY started_at DESC`).all(testId);
  if (!beforeRunId) return rows[0] ? rowToRun(rows[0]) : undefined;
  const target = db.prepare(`SELECT started_at FROM runs WHERE id = ?`).get(beforeRunId) as any;
  const earlier = rows.filter((r) => !target || r.started_at < target.started_at);
  return earlier[0] ? rowToRun(earlier[0]) : undefined;
}

// ---------- triage ----------

export function upsertTriage(t: TriageResult): void {
  db.prepare(
    `INSERT INTO triage (run_id, classification, confidence, evidence, summary, used_ai)
     VALUES (@runId, @classification, @confidence, @evidence, @summary, @usedAi)
     ON CONFLICT(run_id) DO UPDATE SET classification=excluded.classification, confidence=excluded.confidence,
       evidence=excluded.evidence, summary=excluded.summary, used_ai=excluded.used_ai`
  ).run({
    runId: t.runId,
    classification: t.classification,
    confidence: t.confidence,
    evidence: JSON.stringify(t.evidence),
    summary: t.summary,
    usedAi: t.usedAi ? 1 : 0,
  });
}

export function getTriage(runId: string): TriageResult | undefined {
  const row: any = db.prepare(`SELECT * FROM triage WHERE run_id = ?`).get(runId);
  if (!row) return undefined;
  return {
    runId: row.run_id,
    classification: row.classification,
    confidence: row.confidence,
    evidence: JSON.parse(row.evidence),
    summary: row.summary,
    usedAi: !!row.used_ai,
  };
}

// ---------- heals ----------

export function insertHeal(h: Omit<HealProposal, "id" | "createdAt"> & { id?: string; createdAt?: string }): HealProposal {
  const heal: HealProposal = {
    id: h.id ?? nanoid(10),
    createdAt: h.createdAt ?? new Date().toISOString(),
    ...h,
  } as HealProposal;
  db.prepare(
    `INSERT INTO heals (id, test_id, run_id, step_index, kind, before, after, before_evidence, after_evidence, rationale, auto_approvable, status, created_at, decided_at, decided_by)
     VALUES (@id, @testId, @runId, @stepIndex, @kind, @before, @after, @beforeEvidence, @afterEvidence, @rationale, @autoApprovable, @status, @createdAt, @decidedAt, @decidedBy)`
  ).run({
    id: heal.id,
    testId: heal.testId,
    runId: heal.runId,
    stepIndex: heal.stepIndex,
    kind: heal.kind,
    before: heal.before,
    after: heal.after,
    beforeEvidence: heal.beforeEvidence,
    afterEvidence: heal.afterEvidence,
    rationale: heal.rationale,
    autoApprovable: heal.autoApprovable ? 1 : 0,
    status: heal.status,
    createdAt: heal.createdAt,
    decidedAt: heal.decidedAt ?? null,
    decidedBy: heal.decidedBy ?? null,
  });
  return heal;
}

function rowToHeal(row: any): HealProposal {
  return {
    id: row.id,
    testId: row.test_id,
    runId: row.run_id,
    stepIndex: row.step_index,
    kind: row.kind,
    before: row.before,
    after: row.after,
    beforeEvidence: row.before_evidence,
    afterEvidence: row.after_evidence,
    rationale: row.rationale,
    autoApprovable: !!row.auto_approvable,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
    decidedBy: row.decided_by ?? undefined,
  };
}

export function listHeals(testId?: string): HealProposal[] {
  const rows = testId
    ? db.prepare(`SELECT * FROM heals WHERE test_id = ? ORDER BY created_at DESC`).all(testId)
    : db.prepare(`SELECT * FROM heals ORDER BY created_at DESC`).all();
  return rows.map(rowToHeal);
}

export function getHeal(id: string): HealProposal | undefined {
  const row = db.prepare(`SELECT * FROM heals WHERE id = ?`).get(id);
  return row ? rowToHeal(row) : undefined;
}

export function decideHeal(id: string, status: "approved" | "rejected" | "reverted", decidedBy: string): void {
  db.prepare(`UPDATE heals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?`).run(status, new Date().toISOString(), decidedBy, id);
}

export function healPrecision(): { total: number; approved: number; rejected: number; reverted: number; precision: number } {
  const total = (db.prepare(`SELECT COUNT(*) c FROM heals WHERE status != 'pending'`).get() as any).c;
  const approved = (db.prepare(`SELECT COUNT(*) c FROM heals WHERE status = 'approved'`).get() as any).c;
  const rejected = (db.prepare(`SELECT COUNT(*) c FROM heals WHERE status = 'rejected'`).get() as any).c;
  const reverted = (db.prepare(`SELECT COUNT(*) c FROM heals WHERE status = 'reverted'`).get() as any).c;
  const precision = total === 0 ? 1 : approved / total;
  return { total, approved, rejected, reverted, precision };
}

// ---------- bug reports ----------

export interface BugReport {
  id: string;
  testId: string;
  runId: string;
  stepIndex: number;
  summary: string;
  evidence: string[];
  createdAt: string;
}

export function insertBugReport(b: Omit<BugReport, "id" | "createdAt">): BugReport {
  const report: BugReport = { ...b, id: nanoid(10), createdAt: new Date().toISOString() };
  db.prepare(
    `INSERT INTO bug_reports (id, test_id, run_id, step_index, summary, evidence, created_at) VALUES (@id, @testId, @runId, @stepIndex, @summary, @evidence, @createdAt)`
  ).run({ ...report, evidence: JSON.stringify(report.evidence) });
  return report;
}

export function listBugReports(testId?: string): BugReport[] {
  const rows = testId
    ? db.prepare(`SELECT * FROM bug_reports WHERE test_id = ? ORDER BY created_at DESC`).all(testId)
    : db.prepare(`SELECT * FROM bug_reports ORDER BY created_at DESC`).all();
  return rows.map((row: any) => ({ ...row, evidence: JSON.parse(row.evidence) }));
}

// ---------- LLM usage ----------

export function recordLlmUsage(entry: {
  testId?: string;
  purpose: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}): void {
  db.prepare(
    `INSERT INTO llm_usage (id, test_id, purpose, provider, model, input_tokens, output_tokens, cost_usd, created_at)
     VALUES (@id, @testId, @purpose, @provider, @model, @inputTokens, @outputTokens, @costUsd, @createdAt)`
  ).run({ id: nanoid(10), testId: entry.testId ?? null, createdAt: new Date().toISOString(), ...entry });
}

export function llmUsageSummary(): { totalCostUsd: number; byPurpose: Record<string, number>; calls: number } {
  const rows: any[] = db.prepare(`SELECT purpose, SUM(cost_usd) cost, COUNT(*) n FROM llm_usage GROUP BY purpose`).all();
  const byPurpose: Record<string, number> = {};
  let totalCostUsd = 0;
  let calls = 0;
  for (const row of rows) {
    byPurpose[row.purpose] = row.cost;
    totalCostUsd += row.cost;
    calls += row.n;
  }
  return { totalCostUsd, byPurpose, calls };
}

// ---------- flake ----------

export interface FlakeStats {
  testId: string;
  totalRuns: number;
  passed: number;
  failed: number;
  flaky: number;
  passRate: number;
  flakeRate: number;
  avgDurationMs: number;
}

export function flakeStatsFor(testId: string): FlakeStats {
  const rows = listRuns(testId, 1000);
  const totalRuns = rows.length;
  const passed = rows.filter((r) => r.status === "passed").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const flaky = rows.filter((r) => r.status === "flaky").length;
  const avgDurationMs = totalRuns ? rows.reduce((s, r) => s + r.durationMs, 0) / totalRuns : 0;
  return {
    testId,
    totalRuns,
    passed,
    failed,
    flaky,
    passRate: totalRuns ? (passed + flaky) / totalRuns : 0,
    flakeRate: totalRuns ? flaky / totalRuns : 0,
    avgDurationMs,
  };
}
