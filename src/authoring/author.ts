import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { nanoid } from "nanoid";
import type { ProjectConfig, TestDefinition } from "../types.js";
import { parseTestSource, type TestSource } from "../parser/index.js";
import { expandComponentReferences } from "./components.js";
import { runResolution, type ResolveReport } from "../resolver/resolve.js";
import { generateSpec, writeGeneratedFiles } from "../codegen/generate.js";
import { evaluateDestructiveGuard } from "../safety/destructive.js";
import { sourcePath, specPath, stepMapPath, resolvedPath, screenshotDir } from "../storage/testFiles.js";
import { upsertTest, recordLlmUsage, getTest } from "../storage/repo.js";
import { getLlmProvider } from "../llm/index.js";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
}

export interface AuthorOptions {
  project: ProjectConfig;
  source: TestSource;
  existingTestId?: string;
  destructiveApproved?: boolean;
  headed?: boolean;
  useAi?: boolean;
}

export interface AuthorReport {
  test: TestDefinition;
  parseWarnings: string[];
  resolution: ResolveReport;
  requiresDestructiveApproval: boolean;
  destructiveFindings: { stepIndex: number; sentence: string; matched: string }[];
  generatedCode: string;
}

/**
 * The full plain-English-to-deterministic-test pipeline: parse, flag
 * destructive steps up front, run the live resolution, generate the
 * Playwright spec + step map, and persist everything (source, generated
 * files, DB row). This is the single entry point both the CLI and the
 * server's authoring endpoint call.
 */
export async function authorTest(opts: AuthorOptions): Promise<AuthorReport> {
  const expandedSteps = expandComponentReferences(opts.project.id, opts.source.steps);
  const parsed = parseTestSource({ ...opts.source, steps: expandedSteps });
  const startUrl = resolveStartUrl(opts.source, opts.project);

  const destructive = evaluateDestructiveGuard(parsed.steps, opts.destructiveApproved ?? false);

  const testId = opts.existingTestId ?? `${slugify(opts.source.title)}-${nanoid(6)}`;
  const now = new Date().toISOString();
  const existing = getTest(testId);

  const srcPath = sourcePath(opts.project.id, testId);
  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.writeFileSync(srcPath, YAML.stringify(opts.source), "utf-8");

  let resolution: ResolveReport = { resolvedSteps: [], aborted: true, llmCallsUsed: 0, llmCostUsd: 0, injectionAlerts: [] };
  let generatedCode = "";

  if (!destructive.requiresApproval) {
    resolution = await runResolution({
      project: opts.project,
      environment: opts.source.environment ?? opts.project.defaultEnvironment,
      startUrl,
      steps: parsed.steps,
      destructiveApproved: opts.destructiveApproved ?? false,
      headed: opts.headed,
      screenshotDir: screenshotDir(opts.project.id, testId, "authoring"),
      useAi: opts.useAi ?? true,
    });

    const gen = generateSpec({ title: opts.source.title, startUrl, steps: resolution.resolvedSteps });
    generatedCode = gen.code;
    writeGeneratedFiles({ specPath: specPath(opts.project.id, testId), stepMapPath: stepMapPath(opts.project.id, testId), result: gen });
    fs.writeFileSync(resolvedPath(opts.project.id, testId), JSON.stringify(resolution.resolvedSteps, null, 2));

    if (resolution.llmCallsUsed > 0) {
      let provider;
      try {
        provider = getLlmProvider();
      } catch {
        provider = undefined;
      }
      recordLlmUsage({
        testId,
        purpose: "author",
        provider: provider?.name ?? "unknown",
        model: provider?.model ?? "unknown",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: resolution.llmCostUsd,
      });
    }
  }

  const test: TestDefinition = {
    id: testId,
    projectId: opts.project.id,
    title: opts.source.title,
    startUrl,
    tags: opts.source.tags ?? [],
    environment: opts.source.environment ?? opts.project.defaultEnvironment,
    sourcePath: srcPath,
    specPath: !destructive.requiresApproval ? specPath(opts.project.id, testId) : existing?.specPath,
    stepMapPath: !destructive.requiresApproval ? stepMapPath(opts.project.id, testId) : existing?.stepMapPath,
    destructiveApproved: opts.destructiveApproved ?? false,
    quarantined: existing?.quarantined ?? false,
    quarantineReason: existing?.quarantineReason,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  upsertTest(test);

  return {
    test,
    parseWarnings: parsed.warnings,
    resolution,
    requiresDestructiveApproval: destructive.requiresApproval,
    destructiveFindings: destructive.findings,
    generatedCode,
  };
}

function resolveStartUrl(source: TestSource, project: ProjectConfig): string {
  if (source.startUrl && /^https?:\/\//i.test(source.startUrl)) return source.startUrl;
  const env = source.environment ?? project.defaultEnvironment;
  const base = project.environments[env]?.baseUrl ?? "";
  if (!source.startUrl) return base;
  return `${base.replace(/\/$/, "")}/${source.startUrl.replace(/^\//, "")}`;
}

export function loadTestSource(projectId: string, testId: string): TestSource {
  const file = sourcePath(projectId, testId);
  return YAML.parse(fs.readFileSync(file, "utf-8"));
}
