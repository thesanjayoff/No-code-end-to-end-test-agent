import { describe, it, expect } from "vitest";
import { parseTestSource } from "../src/parser/index.js";

describe("step parser", () => {
  it("parses a basic action + assertion flow", () => {
    const result = parseTestSource({
      title: "t",
      startUrl: "https://example.com",
      steps: ['fill username with "bob"', "click the Login button", 'expect the welcome text to show "Hello"'],
    });
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]).toMatchObject({ action: "fill", targetDescription: "username", data: "bob" });
    expect(result.steps[1]).toMatchObject({ action: "click", targetDescription: "the Login button" });
    expect(result.steps[2]).toMatchObject({ action: "expect_text", targetDescription: "the welcome text", expected: "Hello" });
  });

  it("splits a compound expectation into two assertions", () => {
    const result = parseTestSource({
      title: "t",
      steps: ["expect the total to show ₹999 and the Pay button to be enabled"],
    });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].action).toBe("expect_text");
    expect(result.steps[1].action).toBe("expect_enabled");
    expect(result.steps[1].targetDescription).toContain("Pay button");
  });

  it("supports Gherkin given/when/then prefixes", () => {
    const result = parseTestSource({
      title: "t",
      steps: ["Given I go to https://example.com", 'When I click "Submit"', 'Then I expect "Done" to be visible'],
    });
    expect(result.steps[0].gherkin).toBe("given");
    expect(result.steps[0].action).toBe("goto");
    expect(result.steps[1].gherkin).toBe("when");
    expect(result.steps[2].gherkin).toBe("then");
    expect(result.steps[2].action).toBe("expect_visible");
  });

  it("flags an ambiguous bare target with a warning", () => {
    const result = parseTestSource({ title: "t", steps: ["click the button"] });
    expect(result.steps[0].warnings.some((w) => w.includes("Ambiguous"))).toBe(true);
  });

  it("does not flag a qualified target", () => {
    const result = parseTestSource({ title: "t", steps: ['click the "Submit" button'] });
    expect(result.steps[0].warnings).toHaveLength(0);
  });

  it("warns when no start URL is given", () => {
    const result = parseTestSource({ title: "t", steps: ["click X"] });
    expect(result.warnings.some((w) => w.includes("start URL"))).toBe(true);
  });

  it("recognizes a count assertion", () => {
    const result = parseTestSource({ title: "t", steps: ["expect 3 items in the cart"] });
    expect(result.steps[0]).toMatchObject({ action: "expect_count", expected: "3" });
  });

  it("scopes a repeated-item click to its context", () => {
    const result = parseTestSource({ title: "t", steps: ['click "Add to cart" for "Wireless Mouse"'] });
    expect(result.steps[0]).toMatchObject({ action: "click", targetDescription: "Add to cart", contextDescription: "Wireless Mouse" });
  });

  it("falls back to unknown for unparseable sentences with a warning", () => {
    const result = parseTestSource({ title: "t", steps: ["do the thing somehow"] });
    expect(result.steps[0].action).toBe("unknown");
    expect(result.steps[0].warnings.length).toBeGreaterThan(0);
  });
});
