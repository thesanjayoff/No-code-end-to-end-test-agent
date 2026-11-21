import { describe, it, expect } from "vitest";
import { assertHealIsAllowed, isAssertionMutation } from "../src/healer/guard.js";

describe("healer guardrail", () => {
  it("allows a locator change between two plain locators", () => {
    const result = assertHealIsAllowed({
      kind: "locator",
      before: "getByRole('button', { name: 'Submit' })",
      after: "getByRole('button', { name: 'Submit Order' })",
      stepAction: "click",
    });
    expect(result.allowed).toBe(true);
  });

  it("allows a wait addition", () => {
    const result = assertHealIsAllowed({
      kind: "wait",
      before: "(no explicit wait)",
      after: "await page.waitForLoadState('networkidle');",
      stepAction: "click",
    });
    expect(result.allowed).toBe(true);
  });

  it("refuses to heal a step whose action is itself an assertion", () => {
    const result = assertHealIsAllowed({
      kind: "locator",
      before: "getByText('$20')",
      after: "getByText('$10')",
      stepAction: "expect_text",
    });
    expect(result.allowed).toBe(false);
  });

  it("refuses a locator change whose text contains assertion syntax", () => {
    const result = assertHealIsAllowed({
      kind: "locator",
      before: "getByRole('button', { name: 'Pay' })",
      after: "getByRole('button', { name: 'Pay' }); expect(total).toContainText('$20')",
      stepAction: "click",
    });
    expect(result.allowed).toBe(false);
  });

  it("refuses an unsupported heal kind outright", () => {
    // @ts-expect-error -- intentionally passing an invalid kind to prove the guard rejects it
    const result = assertHealIsAllowed({ kind: "assertion", before: "a", after: "b", stepAction: "click" });
    expect(result.allowed).toBe(false);
  });

  it("detects assertion tokens via isAssertionMutation directly", () => {
    expect(isAssertionMutation("locator", "a", "toHaveValue('x')")).toBe(true);
    expect(isAssertionMutation("locator", "a", "getByTestId('x')")).toBe(false);
  });
});
