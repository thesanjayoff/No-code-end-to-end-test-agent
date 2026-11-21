import type { Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";

export interface AxeFinding {
  id: string;
  impact: string | null | undefined;
  description: string;
  nodes: number;
}

/** Basic accessibility scan using axe-core, run against the page as it currently stands. */
export async function runAxeScan(page: Page): Promise<AxeFinding[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.map((v) => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.length }));
}
