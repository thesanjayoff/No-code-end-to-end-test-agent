import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { componentPath } from "../storage/testFiles.js";

export interface ComponentDefinition {
  name: string;
  steps: string[];
}

/** Saves a reusable step sequence (e.g. "log in as customer") that other tests can reference with a `use <name>` step. */
export function saveComponent(projectId: string, name: string, steps: string[]): void {
  const file = componentPath(projectId, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify({ name, steps } satisfies ComponentDefinition), "utf-8");
}

export function loadComponentSteps(projectId: string, name: string): string[] | undefined {
  const file = componentPath(projectId, name);
  if (!fs.existsSync(file)) return undefined;
  const def: ComponentDefinition = YAML.parse(fs.readFileSync(file, "utf-8"));
  return def.steps;
}

export function listComponents(projectId: string): string[] {
  const dir = path.dirname(componentPath(projectId, "x"));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => f.replace(/\.steps\.yaml$/, ""));
}

/**
 * Expands `use <component>` references in a flat step list into the
 * component's own sentences, recursively (with simple cycle protection), so
 * the parser and resolver only ever see plain sentences.
 */
export function expandComponentReferences(projectId: string, steps: string[], seen: Set<string> = new Set()): string[] {
  const expanded: string[] = [];
  for (const sentence of steps) {
    const m = sentence.trim().match(/^use\s+(?:component\s+)?["“]?([a-z0-9 _-]+?)["”]?$/i);
    if (!m) {
      expanded.push(sentence);
      continue;
    }
    const name = m[1].trim();
    if (seen.has(name)) {
      throw new Error(`Component "${name}" is referenced in a cycle.`);
    }
    const componentSteps = loadComponentSteps(projectId, name);
    if (!componentSteps) {
      expanded.push(sentence); // left unexpanded -> parser will report it as unresolved/unknown
      continue;
    }
    expanded.push(...expandComponentReferences(projectId, componentSteps, new Set([...seen, name])));
  }
  return expanded;
}
