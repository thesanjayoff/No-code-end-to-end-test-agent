import { loadLlmConfig } from "../config/env.js";
import { AnthropicProvider } from "./anthropic.js";
import { LocalLlmProvider } from "./local.js";
import { NoLlmProvider, type LlmProvider } from "./provider.js";

let cached: LlmProvider | null = null;

/** Resolves the configured LLM provider from TESTWISE_LLM_PROVIDER (anthropic by default). */
export function getLlmProvider(): LlmProvider {
  if (cached) return cached;
  const cfg = loadLlmConfig();
  if (cfg.provider === "none") {
    cached = new NoLlmProvider();
  } else if (cfg.provider === "local") {
    cached = new LocalLlmProvider(cfg.localBaseUrl, cfg.localModel);
  } else {
    if (!cfg.anthropicApiKey) {
      throw new Error(
        "TESTWISE_LLM_PROVIDER=anthropic (the default) but ANTHROPIC_API_KEY is not set. " +
          "Set it, or set TESTWISE_LLM_PROVIDER=local to use a local model, or =none to disable AI entirely."
      );
    }
    cached = new AnthropicProvider(cfg.anthropicApiKey, cfg.anthropicModel);
  }
  return cached;
}

export * from "./provider.js";
