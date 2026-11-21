import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_DATA_DIRNAME } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved relative to this file (src/config/env.ts -> repo root). */
export const ROOT_DIR = path.resolve(here, "..", "..");
export const DATA_DIR = path.join(ROOT_DIR, APP_DATA_DIRNAME);
export const PROJECTS_DIR = path.join(ROOT_DIR, "projects");
export const DB_PATH = path.join(DATA_DIR, "testwise.sqlite");
export const VAULT_PATH = path.join(DATA_DIR, "vault.enc.json");

export type LlmProviderName = "anthropic" | "local" | "none";

export interface LlmConfig {
  provider: LlmProviderName;
  anthropicApiKey?: string;
  anthropicModel: string;
  localBaseUrl: string;
  localModel: string;
}

/** Reads LLM provider configuration from the environment. Claude is the default. */
export function loadLlmConfig(): LlmConfig {
  const provider = (process.env.TESTWISE_LLM_PROVIDER ?? "anthropic").toLowerCase() as LlmProviderName;
  return {
    provider: provider === "local" || provider === "none" ? provider : "anthropic",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.TESTWISE_ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    localBaseUrl: process.env.TESTWISE_LOCAL_LLM_BASE_URL ?? "http://localhost:11434/v1",
    localModel: process.env.TESTWISE_LOCAL_LLM_MODEL ?? "llama3.1",
  };
}

export const SERVER_PORT = Number(process.env.TESTWISE_PORT ?? 4780);
export const PRODUCTION_LOCK = (process.env.TESTWISE_ALLOW_PRODUCTION ?? "false").toLowerCase() === "true";
