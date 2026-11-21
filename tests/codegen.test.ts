import { describe, it, expect } from "vitest";
import { generateSpec } from "../src/codegen/generate.js";
import type { ResolvedStep } from "../src/types.js";

function fillStep(data: string): ResolvedStep {
  return {
    index: 1,
    sentence: `fill password with "${data}"`,
    kind: "action",
    action: "fill",
    targetDescription: "password",
    data,
    warnings: [],
    resolutionOk: true,
    usedAi: false,
    locator: { strategy: "label", code: "getByLabel('Password')", description: 'label="Password"', confidence: 0.9 },
  };
}

describe("codegen secrets handling", () => {
  it("bakes a literal fill value into the generated spec as-is", () => {
    const { code } = generateSpec({ title: "t", startUrl: "/", steps: [fillStep("secret_sauce")] });
    expect(code).toContain('.fill("secret_sauce")');
    expect(code).not.toContain("SecretVault");
  });

  it("renders a {{secret:name}} fill as a runtime vault lookup, not a literal", () => {
    const { code } = generateSpec({ title: "t", startUrl: "/", steps: [fillStep("{{secret:site_password}}")] });
    expect(code).toContain("import { SecretVault }");
    expect(code).toContain("new SecretVault()");
    expect(code).toContain('__testwiseVault.get("site_password")');
  });

  it("omits the vault import entirely when no step uses a secret", () => {
    const { code } = generateSpec({ title: "t", startUrl: "/", steps: [fillStep("plain-value")] });
    expect(code).not.toContain("SecretVault");
  });
});
