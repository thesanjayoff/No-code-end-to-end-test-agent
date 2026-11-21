import fs from "node:fs";
import crypto from "node:crypto";
import { VAULT_PATH, DATA_DIR } from "../config/env.js";

const ALGO = "aes-256-gcm";
const KEY_FILE = () => `${VAULT_PATH}.key`;

function loadOrCreateKey(): Buffer {
  if (process.env.TESTWISE_VAULT_KEY) {
    return crypto.createHash("sha256").update(process.env.TESTWISE_VAULT_KEY).digest();
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const keyFile = KEY_FILE();
  if (fs.existsSync(keyFile)) {
    return Buffer.from(fs.readFileSync(keyFile, "utf-8"), "hex");
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key.toString("hex"), { mode: 0o600 });
  return key;
}

interface VaultFile {
  entries: Record<string, { iv: string; tag: string; data: string }>;
}

function readVaultFile(): VaultFile {
  if (!fs.existsSync(VAULT_PATH)) return { entries: {} };
  return JSON.parse(fs.readFileSync(VAULT_PATH, "utf-8"));
}

function writeVaultFile(v: VaultFile): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(VAULT_PATH, JSON.stringify(v, null, 2), { mode: 0o600 });
}

/**
 * Local, encrypted-at-rest secret storage for credentials, API keys and test
 * card numbers. Secrets are decrypted only at the point of use (step
 * execution) and are never included in LLM prompts -- callers must use
 * `maskSecrets` before logging, screenshotting, or sending anything to a
 * provider.
 */
export class SecretVault {
  private key = loadOrCreateKey();

  set(name: string, value: string, scope = "global"): void {
    const vault = readVaultFile();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, this.key, iv);
    const data = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    vault.entries[`${scope}:${name}`] = {
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      data: data.toString("hex"),
    };
    writeVaultFile(vault);
  }

  get(name: string, scope = "global"): string | undefined {
    const vault = readVaultFile();
    const entry = vault.entries[`${scope}:${name}`];
    if (!entry) return undefined;
    const decipher = crypto.createDecipheriv(ALGO, this.key, Buffer.from(entry.iv, "hex"));
    decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
    const data = Buffer.concat([decipher.update(Buffer.from(entry.data, "hex")), decipher.final()]);
    return data.toString("utf-8");
  }

  list(scope = "global"): string[] {
    const vault = readVaultFile();
    const prefix = `${scope}:`;
    return Object.keys(vault.entries)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }

  delete(name: string, scope = "global"): void {
    const vault = readVaultFile();
    delete vault.entries[`${scope}:${name}`];
    writeVaultFile(vault);
  }

  /** All currently stored secret *values*, across scopes, for masking purposes. */
  allValues(): string[] {
    const vault = readVaultFile();
    const values: string[] = [];
    for (const key of Object.keys(vault.entries)) {
      const [scope, name] = key.split(":", 2);
      const v = this.get(name, scope);
      if (v) values.push(v);
    }
    return values;
  }
}

const SECRET_PLACEHOLDER = /^\{\{secret:([^}]+)\}\}$/;

/** True for a step value written as `{{secret:name}}` rather than a literal. */
export function isSecretPlaceholder(value: string): boolean {
  return SECRET_PLACEHOLDER.test(value.trim());
}

/** The vault entry name referenced by a `{{secret:name}}` placeholder, if any. */
export function parseSecretPlaceholder(value: string): string | undefined {
  return SECRET_PLACEHOLDER.exec(value.trim())?.[1];
}

const MASK = "••••••••";

/** Replaces every known secret value with a mask. Used on logs, prompts, traces metadata, and reports. */
export function maskSecrets(text: string, vault: SecretVault): string {
  let masked = text;
  for (const value of vault.allValues()) {
    if (value.length < 3) continue;
    masked = masked.split(value).join(MASK);
  }
  return masked;
}
