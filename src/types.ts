/** Core domain types shared across the parser, resolver, runner, triage, and healer. */

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
  /** 1-based position in the original plain-English/Gherkin source. */
  index: number;
  /** The original sentence, verbatim, kept as source of truth. */
  sentence: string;
  kind: StepKind;
  action: StepAction;
  /** Natural-language description of the target element, e.g. "the Pay button". */
  targetDescription?: string;
  /** For "click X for Y" / repeated-item steps: scopes the search to the item/row containing this text. */
  contextDescription?: string;
  /** Literal data to type/select/upload, after variable substitution markers are preserved. */
  data?: string;
  /** Expected result text for assertions, e.g. "₹" or "enabled". */
  expected?: string;
  /** Gherkin phase this step belongs to, if the source was Gherkin. */
  gherkin?: "given" | "when" | "then" | "and" | "but";
  /** Reference to a reusable component by name, for kind === "component". */
  componentName?: string;
  /** Warnings raised during parsing, e.g. ambiguous target references. */
  warnings: string[];
}

export interface ParseResult {
  title: string;
  startUrl?: string;
  steps: ParsedStep[];
  warnings: string[];
}

export type LocatorStrategy = "role" | "label" | "placeholder" | "testid" | "text" | "css";

export interface ResolvedLocator {
  strategy: LocatorStrategy;
  /** Playwright locator expression, e.g. getByRole('button', { name: 'Pay' }) */
  code: string;
  /** Human-readable description used in reports/diffs. */
  description: string;
  confidence: number;
}

export interface ResolvedStep extends ParsedStep {
  locator?: ResolvedLocator;
  /** Alternate locators considered, in ranked order, for healing later. */
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
