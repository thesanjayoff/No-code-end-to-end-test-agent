import Anthropic from "@anthropic-ai/sdk";
import type { LlmCallOptions, LlmCallResult, LlmMessage, LlmProvider } from "./provider.js";

// Pricing is per-million-tokens, approximate Claude Sonnet rates, used only
// for the local cost dashboard -- not billed anywhere.
const INPUT_PER_M = 3.0;
const OUTPUT_PER_M = 15.0;

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(messages: LlmMessage[], opts: LlmCallOptions): Promise<LlmCallResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd = (inputTokens / 1_000_000) * INPUT_PER_M + (outputTokens / 1_000_000) * OUTPUT_PER_M;
    return { text, inputTokens, outputTokens, costUsd, provider: this.name, model: this.model };
  }
}
