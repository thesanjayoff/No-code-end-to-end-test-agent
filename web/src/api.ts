import type {
  BugReport,
  DashboardEntry,
  FlakeStats,
  HealProposal,
  ProjectConfig,
  RunRecord,
  TestDefinition,
  TriageResult,
} from "./types";

export class ApiError extends Error {}

export interface CompareResult {
  current: RunRecord;
  lastGood?: RunRecord;
  stepDiff: Array<{ index: number; before: string; after: string; changed: boolean }>;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  dashboard: () => req<DashboardEntry[]>("/dashboard"),

  projects: () => req<ProjectConfig[]>("/projects"),
  project: (id: string) => req<ProjectConfig>(`/projects/${id}`),

  tests: (projectId?: string) => req<TestDefinition[]>(`/tests${projectId ? `?projectId=${projectId}` : ""}`),
  test: (id: string) => req<TestDefinition>(`/tests/${id}`),
  testSource: (id: string) => req<{ title: string; startUrl?: string; steps: string[] }>(`/tests/${id}/source`),
  testSpec: (id: string) =>
    fetch(`/api/tests/${id}/spec`).then((r) => (r.ok ? r.text() : Promise.reject(new ApiError("not generated yet")))),
  testRuns: (id: string) => req<RunRecord[]>(`/tests/${id}/runs`),
  testFlake: (id: string) => req<FlakeStats>(`/tests/${id}/flake`),
  testHeals: (id: string) => req<HealProposal[]>(`/tests/${id}/heals`),
  testBugs: (id: string) => req<BugReport[]>(`/tests/${id}/bugs`),
  runTest: (id: string, opts: { browsers?: string[]; viewports?: string[]; headed?: boolean; retries?: number } = {}) =>
    req<RunRecord[]>(`/tests/${id}/run`, { method: "POST", body: JSON.stringify(opts) }),
  stabilityCheck: (id: string, iterations = 20) =>
    req<{ totalRuns: number; passed: number; failed: number; flaky: number; passRate: number; flakeRate: number }>(
      `/tests/${id}/stability`,
      { method: "POST", body: JSON.stringify({ iterations }) }
    ),

  run: (id: string) => req<RunRecord>(`/runs/${id}`),
  runTriage: (id: string) => req<TriageResult>(`/runs/${id}/triage`),

  compare: (testId: string, runId: string) => req<CompareResult>(`/tests/${testId}/compare/${runId}`),

  proposeHeal: (testId: string, runId: string, stepIndex: number, reason: "ui_drift" | "flake") =>
    req<HealProposal | { blocked: string }>("/heals/propose", { method: "POST", body: JSON.stringify({ testId, runId, stepIndex, reason }) }),
  approveHeal: (id: string) => req<{ ok: true }>(`/heals/${id}/approve`, { method: "POST" }),
  rejectHeal: (id: string) => req<{ ok: true }>(`/heals/${id}/reject`, { method: "POST" }),
  revertHeal: (id: string) => req<{ ok: true }>(`/heals/${id}/revert`, { method: "POST" }),
  healPrecision: () => req<{ total: number; approved: number; rejected: number; reverted: number; precision: number }>("/heals/precision"),

  llmUsage: () => req<{ totalCostUsd: number; byPurpose: Record<string, number>; calls: number }>("/llm-usage"),
};
