import fs from "node:fs";
import { listTests, deleteTest } from "../src/storage/repo.js";
import { sourcePath, specPath, stepMapPath, resolvedPath } from "../src/storage/testFiles.js";
import { authorTest, type AuthorOptions, type AuthorReport } from "../src/authoring/author.js";

/**
 * Benchmark scripts need a clean slate every run -- re-authoring the same
 * scenario under a fresh id each time would otherwise pile up duplicate,
 * orphaned test rows and generated files in the project on every re-run
 * (unlike the main seed corpus, which is idempotent by title; these are
 * meant to be thrown away and rebuilt each time instead).
 */
export function deleteTestsByTitle(projectId: string, titles: string[]): void {
  const titleSet = new Set(titles);
  for (const test of listTests(projectId)) {
    if (!titleSet.has(test.title)) continue;
    deleteTest(test.id);
    for (const f of [sourcePath(projectId, test.id), specPath(projectId, test.id), stepMapPath(projectId, test.id), resolvedPath(projectId, test.id)]) {
      fs.rmSync(f, { force: true });
    }
  }
}

export async function reauthor(opts: AuthorOptions): Promise<AuthorReport> {
  deleteTestsByTitle(opts.project.id, [opts.source.title]);
  return authorTest(opts);
}
