import fs from "node:fs";
import { describe, it, expect, afterEach } from "vitest";
import { SecretVault, maskSecrets } from "../src/safety/secrets.js";
import { VAULT_PATH } from "../src/config/env.js";

const scope = `test-${Date.now()}`;

describe("secret vault", () => {
  afterEach(() => {
    const vault = new SecretVault();
    for (const name of vault.list(scope)) vault.delete(name, scope);
  });

  it("round-trips an encrypted value", () => {
    const vault = new SecretVault();
    vault.set("api_key", "sk-super-secret-value", scope);
    expect(vault.get("api_key", scope)).toBe("sk-super-secret-value");
  });

  it("stores the value encrypted at rest, not as plaintext", () => {
    const vault = new SecretVault();
    vault.set("plaintext_check", "unmistakable-marker-value", scope);
    const raw = fs.readFileSync(VAULT_PATH, "utf-8");
    expect(raw.includes("unmistakable-marker-value")).toBe(false);
  });

  it("masks every known secret value in arbitrary text", () => {
    const vault = new SecretVault();
    vault.set("password", "hunter2", scope);
    const log = `Logging in with password=hunter2 for user bob`;
    const masked = maskSecrets(log, vault);
    expect(masked).not.toContain("hunter2");
    expect(masked).toContain("••••••••");
  });

  it("lists secret names without exposing values", () => {
    const vault = new SecretVault();
    vault.set("card_number", "4111111111111111", scope);
    expect(vault.list(scope)).toContain("card_number");
  });
});
