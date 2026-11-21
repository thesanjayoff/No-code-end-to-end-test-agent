import type { ParseResult, ParsedStep } from "../types.js";
import { parseSentence } from "./plainEnglish.js";

export interface TestSource {
  title: string;
  startUrl?: string;
  environment?: string;
  tags?: string[];
  steps: string[];
}

/** Parses an authored test (title + start URL + plain-English/Gherkin sentences) into structured steps. */
export function parseTestSource(source: TestSource): ParseResult {
  const warnings: string[] = [];
  const steps: ParsedStep[] = [];

  source.steps.forEach((sentence, i) => {
    if (!sentence.trim()) return;
    const parsedClauses = parseSentence(sentence, steps.length + 1);
    for (const step of parsedClauses) {
      step.index = steps.length + 1;
      steps.push(step);
      warnings.push(...step.warnings.map((w) => `Step ${step.index}: ${w}`));
    }
  });

  if (!source.startUrl) {
    warnings.push("No start URL given -- the first step must be a 'go to <url>' step.");
  }

  return { title: source.title, startUrl: source.startUrl, steps, warnings };
}

export { parseSentence } from "./plainEnglish.js";
