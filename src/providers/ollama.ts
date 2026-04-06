import type {
  ExecutionProvider,
  ExecuteOpts,
  ForkOpts,
  StreamEvent,
  PricingModel,
  ProviderType,
  TokenUsage,
  LlmceptionConfig,
} from "../types.js";
import { logger } from "../util/logger.js";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3";

/**
 * Provider that executes tasks via a local Ollama instance.
 * Hits the /api/chat endpoint with streaming NDJSON responses.
 */
export class OllamaProvider implements ExecutionProvider {
  readonly name = "Ollama";
  readonly type: ProviderType = "ollama";
  readonly pricing: PricingModel = "free";
  readonly supportsFork = false;

  private config: LlmceptionConfig;
  private abortController: AbortController | null = null;

  constructor(config: LlmceptionConfig) {
    this.config = config;
  }

  async *execute(opts: ExecuteOpts): AsyncGenerator<StreamEvent> {
    const model = opts.model ?? this.config.providers.ollama?.model ?? this.config.model ?? DEFAULT_MODEL;

    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) {
      messages.push({ role: "system", content: opts.systemPrompt });
    }
    messages.push({ role: "user", content: opts.prompt });

    const body = {
      model,
      messages,
      stream: true,
    };

    yield* this.streamRequest(body);
  }

  async *fork(opts: ForkOpts): AsyncGenerator<StreamEvent> {
    // No native fork support — just execute with the prompt
    yield* this.execute(opts);
  }

  /** Abort the active request if one is in flight. */
  kill(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private getBaseUrl(): string {
    return this.config.providers.ollama?.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async *streamRequest(
    body: Record<string, unknown>,
  ): AsyncGenerator<StreamEvent> {
    this.abortController = new AbortController();
    const url = `${this.getBaseUrl()}/api/chat`;

    const sessionId = `ollama-${Date.now()}`;
    yield { type: "init", sessionId };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "error", message: `Ollama request failed: ${msg}` };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      yield {
        type: "error",
        message: `Ollama error ${response.status}: ${text.slice(0, 500)}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "Ollama returned no body" };
      return;
    }

    const tokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            logger.debug(`Skipping malformed NDJSON: ${trimmed.slice(0, 100)}`);
            continue;
          }

          const events = this.mapOllamaEvent(parsed, tokenUsage);
          for (const event of events) {
            yield event;
          }
        }
      }
    } finally {
      reader.releaseLock();
      this.abortController = null;
    }

    // Emit final result
    yield {
      type: "result",
      costUsd: 0,
      sessionId,
      tokenUsage: { ...tokenUsage },
    };
  }

  private mapOllamaEvent(
    chunk: Record<string, unknown>,
    tokenUsage: TokenUsage,
  ): StreamEvent[] {
    const events: StreamEvent[] = [];

    // Ollama streaming: each chunk has { message: { role, content }, done: bool }
    const message = chunk.message as Record<string, unknown> | undefined;
    if (message) {
      const content = message.content as string | undefined;
      if (content) {
        events.push({ type: "text", text: content });
      }
    }

    // When done=true, the final chunk includes eval_count and prompt_eval_count
    if (chunk.done === true) {
      tokenUsage.inputTokens = (chunk.prompt_eval_count as number) ?? 0;
      tokenUsage.outputTokens = (chunk.eval_count as number) ?? 0;
    }

    return events;
  }
}
