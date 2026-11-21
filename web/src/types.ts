// Mirrors src/types.ts and src/storage/repo.ts on the server. Kept as a
// separate, minimal copy rather than importing across the web/<->src
// boundary, since the web app has its own build and dependency graph.

export type StepAction =
  | "goto"
  | "click"
  | "fill"
  | "select"
  | "check"
  | "uncheck"
  | "upload"
  | "hover"
  | "press"
  | "wait"
  | "expect_visible"
  | "expect_text"
  | "expect_value"
  | "expect_enabled"
  | "expect_disabled"
  | "expect_url"
  | "expect_count"
  | "use_component"
  | "unknown";

export type StepKind = "action" | "assertion" | "component";

export interface ParsedStep {
  index: number;
  sentence: string;
  kind: StepKind;
  action: StepAction;
  targetDescription?: string;
  contextDescription?: string;
  data?: string;
  expected?: string;
  gherkin?: "given" | "when" | "then" | "and" | "but";
  componentName?: string;
  warnings: string[];
}

export type LocatorStrategy = "role" | "label" | "placeholder" | "testid" | "text" | "css";

export interface ResolvedLocator {
  strategy: LocatorStrategy;
  code: string;
  description: string;
  confidence: number;
}

export interface ResolvedStep extends ParsedStep {
  locator?: ResolvedLocator;
  candidates?: ResolvedLocator[];
  resolutionOk: boolean;
  resolutionNote?: string;
  screenshotPath?: string;
  usedAi: boolean;
}

export interface TestDefinition {
  id: string;
  projectId: string;
  title: string;
  startUrl: string;
  tags: string[];
  environment: string;
  sourcePath: string;
  specPath?: string;
  stepMapPath?: string;
  destructiveApproved: boolean;
  quarantined: boolean;
  quarantineReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = "passed" | "failed" | "flaky" | "skipped" | "quarantined";

export interface StepRunResult {
  index: number;
  sentence: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  error?: string;
}

export interface RunRecord {
  id: string;
  testId: string;
  projectId: string;
  status: RunStatus;
  browser: "chromium" | "firefox" | "webkit";
  viewport: "desktop" | "mobile";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  retries: number;
  attempts: number;
  tracePath?: string;
  videoPath?: string;
  screenshotPaths: string[];
  consoleErrors: string[];
  networkErrors: string[];
  stepResults: StepRunResult[];
  llmCallsUsed: number;
  error?: string;
}

export type TriageClass = "flake" | "environment" | "ui_drift" | "real_bug" | "unknown";

export interface TriageEvidence {
  signal: string;
  detail: string;
}

export interface TriageResult {
  runId: string;
  classification: TriageClass;
  confidence: number;
  evidence: TriageEvidence[];
  summary: string;
  usedAi: boolean;
}

export type HealKind = "locator" | "wait";

export interface HealProposal {
  id: string;
  testId: string;
  runId: string;
  stepIndex: number;
  kind: HealKind;
  before: string;
  after: string;
  beforeEvidence: string;
  afterEvidence: string;
  rationale: string;
  autoApprovable: boolean;
  status: "pending" | "approved" | "rejected" | "reverted";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface ProjectConfig {
  id: string;
  name: string;
  allowedDomains: string[];
  environments: Record<string, { baseUrl: string }>;
  defaultEnvironment: string;
  productionDomains: string[];
  createdAt: string;
}

export interface BugReport {
  id: string;
  testId: string;
  runId: string;
  stepIndex: number;
  summary: string;
  evidence: string[];
  createdAt: string;
}

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

export interface DashboardEntry {
  project: ProjectConfig;
  tests: Array<{ test: TestDefinition; flake: FlakeStats; lastRun?: RunRecord }>;
}
