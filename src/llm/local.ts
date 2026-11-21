import type { LlmCallOptions, LlmCallResult, LlmMessage, LlmProvider } from "./provider.js";

/**
 * Local-model provider speaking the OpenAI-compatible chat/completions
 * protocol (works with Ollama, LM Studio, vLLM, etc). Cost is always 0 --
 * it's your own hardware.
 */
export class LocalLlmProvider implements LlmProvider {
  readonly name = "local";

  constructor(private baseUrl: string, readonly model: string) {}

  async complete(messages: LlmMessage[], opts: LlmCallOptions): Promise<LlmCallResult> {
    const body = {
      model: this.model,
      max_tokens: opts.maxTokens ?? 2048,
      messages: [
        ...(opts.system ? [{ role: "system", content: opts.system }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    };
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Local LLM provider at ${this.baseUrl} returned ${res.status}: ${await res.text()}`);
    }
    const json: any = await res.json();
    const text: string = json.choices?.[0]?.message?.content ?? "";
    const inputTokens: number = json.usage?.prompt_tokens ?? 0;
    const outputTokens: number = json.usage?.completion_tokens ?? 0;
    return { text, inputTokens, outputTokens, costUsd: 0, provider: this.name, model: this.model };
  }
}
