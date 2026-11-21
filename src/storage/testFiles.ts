import path from "node:path";
import { projectDir } from "./project.js";
import { APP_SPEC_FILE_EXT, APP_STEPMAP_FILE_EXT, APP_STEP_FILE_EXT } from "../config/app.js";

export function sourcePath(projectId: string, testId: string): string {
  return path.join(projectDir(projectId), "tests", `${testId}${APP_STEP_FILE_EXT}`);
}
export function specPath(projectId: string, testId: string): string {
  return path.join(projectDir(projectId), "generated", `${testId}${APP_SPEC_FILE_EXT}`);
}
export function stepMapPath(projectId: string, testId: string): string {
  return path.join(projectDir(projectId), "generated", `${testId}${APP_STEPMAP_FILE_EXT}`);
}
export function resolvedPath(projectId: string, testId: string): string {
  return path.join(projectDir(projectId), "generated", `${testId}.resolved.json`);
}
export function specBackupPath(projectId: string, testId: string, healId: string): string {
  return path.join(projectDir(projectId), "generated", "backups", `${testId}.${healId}${APP_SPEC_FILE_EXT}`);
}
export function screenshotDir(projectId: string, testId: string, runId: string): string {
  return path.join(projectDir(projectId), "runs", runId, "screenshots");
}
export function traceDir(projectId: string, testId: string, runId: string): string {
  return path.join(projectDir(projectId), "runs", runId);
}
export function componentPath(projectId: string, name: string): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return path.join(projectDir(projectId), "components", `${slug}${APP_STEP_FILE_EXT}`);
}
