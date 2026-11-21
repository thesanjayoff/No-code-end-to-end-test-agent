import { describe, it, expect } from "vitest";
import { rankCandidates, pickBest, type LocatorCandidate } from "../src/locator/rank.js";

describe("locator ranking", () => {
  it("prefers role over label, testid, text, and css, when all are unique", () => {
    const candidates: LocatorCandidate[] = [
      { strategy: "css", code: ".btn-primary", description: "css", matchCount: 1 },
      { strategy: "text", code: "text=Pay", description: "text", matchCount: 1 },
      { strategy: "testid", code: "testid=pay-btn", description: "testid", matchCount: 1 },
      { strategy: "label", code: "label=Pay", description: "label", matchCount: 1 },
      { strategy: "role", code: "role=button[name=Pay]", description: "role", matchCount: 1 },
    ];
    const { best } = pickBest(candidates);
    expect(best?.strategy).toBe("role");
  });

  it("penalizes a locator that matches more than one element", () => {
    const candidates: LocatorCandidate[] = [
      { strategy: "role", code: "role=button[name=Submit]", description: "role, ambiguous", matchCount: 3 },
      { strategy: "testid", code: "testid=submit-btn", description: "testid, unique", matchCount: 1 },
    ];
    const ranked = rankCandidates(candidates);
    const role = ranked.find((r) => r.strategy === "role")!;
    const testid = ranked.find((r) => r.strategy === "testid")!;
    expect(testid.confidence).toBeGreaterThan(role.confidence);
  });

  it("gives zero confidence to a locator with no matches", () => {
    const candidates: LocatorCandidate[] = [{ strategy: "role", code: "role=button[name=X]", description: "x", matchCount: 0 }];
    const ranked = rankCandidates(candidates);
    expect(ranked[0].confidence).toBe(0);
  });

  it("flags ambiguity when nothing has a confident unique match", () => {
    const candidates: LocatorCandidate[] = [{ strategy: "css", code: ".x", description: "css only", matchCount: 1 }];
    const { ambiguous } = pickBest(candidates);
    expect(ambiguous).toBe(true);
  });

  it("is not ambiguous when a strong, unique role match exists", () => {
    const candidates: LocatorCandidate[] = [{ strategy: "role", code: "role=button[name=Pay]", description: "role", matchCount: 1 }];
    const { ambiguous } = pickBest(candidates);
    expect(ambiguous).toBe(false);
  });
});
