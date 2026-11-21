import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { APP_CONFIG_FILE } from "../config/app.js";
import { PROJECTS_DIR } from "../config/env.js";
import type { ProjectConfig } from "../types.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function projectDir(projectIdOrSlug: string): string {
  return path.join(PROJECTS_DIR, projectIdOrSlug);
}

export function listProjects(): ProjectConfig[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => loadProject(e.name))
    .filter((p): p is ProjectConfig => p !== null);
}

export function loadProject(slug: string): ProjectConfig | null {
  const file = path.join(projectDir(slug), APP_CONFIG_FILE);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export function saveProject(config: ProjectConfig): void {
  const dir = projectDir(config.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.mkdirSync(path.join(dir, "components"), { recursive: true });
  fs.mkdirSync(path.join(dir, "generated"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(dir, APP_CONFIG_FILE), JSON.stringify(config, null, 2));
}

export interface CreateProjectInput {
  name: string;
  allowedDomains: string[];
  environments: Record<string, { baseUrl: string }>;
  defaultEnvironment: string;
  productionDomains?: string[];
}

/**
 * Creates a new project. Every domain in `allowedDomains` must be explicitly
 * listed by the caller -- this is the authorization step described in the
 * safety model: Testwise never tests a domain the user hasn't named.
 */
export function createProject(input: CreateProjectInput): ProjectConfig {
  const id = slugify(input.name) || nanoid(8);
  if (loadProject(id)) {
    throw new Error(`Project "${id}" already exists.`);
  }
  const config: ProjectConfig = {
    id,
    name: input.name,
    allowedDomains: input.allowedDomains.map((d) => d.toLowerCase()),
    environments: input.environments,
    defaultEnvironment: input.defaultEnvironment,
    productionDomains: (input.productionDomains ?? []).map((d) => d.toLowerCase()),
    createdAt: new Date().toISOString(),
  };
  saveProject(config);
  return config;
}
