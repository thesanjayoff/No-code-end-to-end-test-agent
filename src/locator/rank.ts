import type { LocatorStrategy, ResolvedLocator } from "../types.js";

/** Stability order requested by the spec: role+name, then label, then test id, then visible text, then CSS last. */
const STRATEGY_ORDER: LocatorStrategy[] = ["role", "label", "placeholder", "testid", "text", "css"];

const BASE_CONFIDENCE: Record<LocatorStrategy, number> = {
  role: 0.95,
  label: 0.9,
  placeholder: 0.88,
  testid: 0.85,
  text: 0.6,
  css: 0.3,
};

export interface LocatorCandidate {
  strategy: LocatorStrategy;
  code: string;
  description: string;
  /** How many elements on the page this locator currently matches. 1 is ideal. */
  matchCount: number;
}

/**
 * Ranks candidate locators for a single target by strategy stability first,
 * then by whether they uniquely identify one element. A candidate matching
 * more than one element is penalized heavily since it can't be trusted to
 * click the right thing.
 */
export function rankCandidates(candidates: LocatorCandidate[]): ResolvedLocator[] {
  return candidates
    .map((c) => {
      let confidence = BASE_CONFIDENCE[c.strategy];
      if (c.matchCount === 0) confidence = 0;
      else if (c.matchCount > 1) confidence *= 0.3 / c.matchCount;
      return { strategy: c.strategy, code: c.code, description: c.description, confidence };
    })
    .sort((a, b) => {
      const orderDiff = STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy);
      if (Math.abs(a.confidence - b.confidence) > 0.05) return b.confidence - a.confidence;
      return orderDiff;
    });
}

export function pickBest(candidates: LocatorCandidate[]): { best?: ResolvedLocator; ranked: ResolvedLocator[]; ambiguous: boolean } {
  const ranked = rankCandidates(candidates);
  const best = ranked.find((r) => r.confidence > 0);
  const ambiguous = !best || best.confidence < 0.5;
  return { best, ranked, ambiguous };
}

export function strategyRank(strategy: LocatorStrategy): number {
  return STRATEGY_ORDER.indexOf(strategy);
}
