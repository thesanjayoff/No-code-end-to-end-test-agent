import { describe, it, expect } from "vitest";
import { evaluateDestructiveGuard, findDestructiveSteps } from "../src/safety/destructive.js";
import type { ParsedStep } from "../src/types.js";

function step(sentence: string, index = 1): ParsedStep {
  return { index, sentence, kind: "action", action: "click", warnings: [] };
}

describe("destructive-action guard", () => {
  it("flags a payment step", () => {
    const findings = findDestructiveSteps([step("click Pay now")]);
    expect(findings).toHaveLength(1);
  });

  it("flags placing an order", () => {
    const findings = findDestructiveSteps([step("click Place the order button")]);
    expect(findings).toHaveLength(1);
  });

  it("does not flag an ordinary click", () => {
    const findings = findDestructiveSteps([step("click the Login button")]);
    expect(findings).toHaveLength(0);
  });

  it("requires approval when a destructive step is present and not yet approved", () => {
    const result = evaluateDestructiveGuard([step("click Delete account")], false);
    expect(result.requiresApproval).toBe(true);
  });

  it("does not require approval once destructiveApproved is true", () => {
    const result = evaluateDestructiveGuard([step("click Delete account")], true);
    expect(result.requiresApproval).toBe(false);
  });

  it("never requires approval when there's nothing destructive", () => {
    const result = evaluateDestructiveGuard([step("click the Search button")], false);
    expect(result.requiresApproval).toBe(false);
  });
});
