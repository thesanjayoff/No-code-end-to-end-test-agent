import fs from "node:fs";
import type { RunRecord, ResolvedStep, TestDefinition, TriageResult } from "../types.js";
import { resolvedPath } from "../storage/testFiles.js";
import { classifyDeterministic, summarize } from "./classify.js";
import { upsertTriage } from "../storage/repo.js";

function stepKindLookup(test: TestDefinition): (i: number) => "action" | "assertion" | "component" | undefined {
  try {
    const resolved: ResolvedStep[] = JSON.parse(fs.readFileSync(resolvedPath(test.projectId, test.id), "utf-8"));
    const map = new Map(resolved.map((s) => [s.index, s.kind]));
    return (i) => map.get(i);
  } catch {
    return () => undefined;
  }
}

/** Classifies a run's outcome and persists the result. Deterministic signals decide the class; AI only writes the summary. */
export async function triageRun(run: RunRecord, test: TestDefinition): Promise<TriageResult> {
  const lookup = stepKindLookup(test);
  const det = classifyDeterministic(run, lookup);
  const { summary, usedAi } = await summarize(run, det.classification, det.evidence);
  const result: TriageResult = { ...det, summary, usedAi };
  upsertTriage(result);
  return result;
}
