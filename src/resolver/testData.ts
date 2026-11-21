import { nanoid } from "nanoid";
import { SecretVault } from "../safety/secrets.js";

const FIRST_NAMES = ["Alex", "Priya", "Jordan", "Sam", "Riya", "Chen", "Maya", "Noah"];
const LAST_NAMES = ["Smith", "Patel", "Garcia", "Kim", "Nguyen", "Brown", "Rao", "Singh"];

export function uniqueEmail(): string {
  return `testwise.${nanoid(8).toLowerCase()}@example.com`;
}

export function randomName(): string {
  const f = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const l = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${f} ${l}`;
}

export interface SubstitutionContext {
  env: Record<string, string>;
  vault: SecretVault;
}

const TEMPLATE = /\{\{\s*([a-zA-Z0-9_:.-]+)\s*\}\}/g;

/** Expands `{{unique_email}}`, `{{random_name}}`, `{{env:KEY}}`, `{{secret:NAME}}` placeholders. Secrets stay out of logs by design -- callers must mask before persisting. */
export function substituteTemplates(input: string | undefined, ctx: SubstitutionContext): string | undefined {
  if (input === undefined) return undefined;
  return input.replace(TEMPLATE, (_match, token: string) => {
    if (token === "unique_email") return uniqueEmail();
    if (token === "random_name") return randomName();
    if (token.startsWith("env:")) return ctx.env[token.slice(4)] ?? "";
    if (token.startsWith("secret:")) return ctx.vault.get(token.slice(7)) ?? "";
    return _match;
  });
}
