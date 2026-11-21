export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  provider: string;
  model: string;
}

export interface LlmCallOptions {
  system?: string;
  maxTokens?: number;
  /** Tag used for cost/usage attribution, e.g. "author", "heal", "triage", "explore". */
  purpose: "author" | "heal" | "triage" | "explore";
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: LlmMessage[], opts: LlmCallOptions): Promise<LlmCallResult>;
}

/** A provider that always refuses -- used when TESTWISE_LLM_PROVIDER=none to prove replay/triage can run without AI. */
export class NoLlmProvider implements LlmProvider {
  readonly name = "none";
  readonly model = "none";
  async complete(): Promise<LlmCallResult> {
    throw new Error("LLM calls are disabled (TESTWISE_LLM_PROVIDER=none). This call path should not run during replay.");
  }
}
