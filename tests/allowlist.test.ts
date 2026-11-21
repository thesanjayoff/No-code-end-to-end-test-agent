import { describe, it, expect } from "vitest";
import { checkAllowListed, assertAllowListed, AllowListViolation } from "../src/safety/allowlist.js";
import type { ProjectConfig } from "../src/types.js";

function project(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: "p1",
    name: "Project",
    allowedDomains: ["example.com", "staging.internal.example.com"],
    environments: {},
    defaultEnvironment: "staging",
    productionDomains: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("domain allow-list", () => {
  it("allows a URL whose host is exactly on the allow-list", () => {
    expect(checkAllowListed("https://example.com/checkout", project())).toEqual({ ok: true });
  });

  it("allows a subdomain of an allow-listed domain", () => {
    expect(checkAllowListed("https://shop.example.com/cart", project()).ok).toBe(true);
  });

  it("blocks a domain that isn't on the allow-list", () => {
    const result = checkAllowListed("https://evil.example.org", project());
    expect(result.ok).toBe(false);
  });

  it("does not treat example.com as a suffix match for notexample.com", () => {
    const result = checkAllowListed("https://notexample.com", project());
    expect(result.ok).toBe(false);
  });

  it("throws AllowListViolation via assertAllowListed for a blocked domain", () => {
    expect(() => assertAllowListed("https://evil.example.org", project())).toThrow(AllowListViolation);
  });

  it("blocks a production domain unless TESTWISE_ALLOW_PRODUCTION=true", () => {
    const p = project({ allowedDomains: ["example.com"], productionDomains: ["example.com"] });
    const result = checkAllowListed("https://example.com", p);
    expect(result.ok).toBe(false);
  });

  it("rejects a URL with no parseable hostname", () => {
    const result = checkAllowListed("not a url", project());
    expect(result.ok).toBe(false);
  });
});
