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

const API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o";

/**
 * Provider that executes tasks via the OpenAI Chat Completions API.
 * Uses native fetch (Node 20+) and parses SSE streams.
 */
export class OpenAiApiProvider implements ExecutionProvider {
  readonly name = "OpenAI API";
  readonly type: ProviderType = "openai";
  readonly pricing: PricingModel = "metered";
  readonly supportsFork = false;

  private config: LlmceptionConfig;
  private abortController: AbortController | null = null;

  constructor(config: LlmceptionConfig) {
    this.config = config;
  }

  async *execute(opts: ExecuteOpts): AsyncGenerator<StreamEvent> {
    const apiKey = this.getApiKey();
    const model = opts.model ?? this.config.providers.openai?.model ?? this.config.model ?? DEFAULT_MODEL;

    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) {
      messages.push({ role: "system", content: opts.systemPrompt });
    }
    messages.push({ role: "user", content: opts.prompt });

    const body = {
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages,
    };

    yield* this.streamRequest(apiKey, body);
  }

  async *fork(opts: ForkOpts): AsyncGenerator<StreamEvent> {
    // No native fork support — just execute with the prompt as the answer
    yield* this.execute(opts);
  }

  /** Abort the active request if one is in flight. */
  kill(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private getApiKey(): string {
    const key =
      this.config.providers.openai?.apiKey ??
      process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OpenAI API key not configured. Set providers.openai.apiKey or OPENAI_API_KEY env var.",
      );
    }
    return key;
  }

  private async *streamRequest(
    apiKey: string,
    body: Record<string, unknown>,
  ): AsyncGenerator<StreamEvent> {
    this.abortController = new AbortController();

    const baseUrl = this.config.providers.openai?.baseUrl ?? API_URL;

    let response: Response;
    try {
      response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "error", message: `OpenAI API request failed: ${msg}` };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      yield {
        type: "error",
        message: `OpenAI API error ${response.status}: ${text.slice(0, 500)}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "OpenAI API returned no body" };
      return;
    }

    let sessionId = `openai-${Date.now()}`;
    let emittedInit = false;
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
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data) as Record<string, unknown>;
          } catch {
            logger.debug(`Skipping malformed SSE data: ${data.slice(0, 100)}`);
            continue;
          }

          // Emit init on first chunk
          if (!emittedInit) {
            const id = (parsed.id as string) ?? sessionId;
            sessionId = id;
            emittedInit = true;
            yield { type: "init", sessionId };
          }

          const events = this.mapOpenAiEvent(parsed, tokenUsage);
          for (const event of events) {
            yield event;
          }
        }
      }
    } finally {
      reader.releaseLock();
      this.abortController = null;
    }

    // Emit result at the end
    yield {
      type: "result",
      costUsd: tokenUsage.costUsd,
      sessionId,
      tokenUsage: { ...tokenUsage },
    };
  }

  private mapOpenAiEvent(
    chunk: Record<string, unknown>,
    tokenUsage: TokenUsage,
  ): StreamEvent[] {
    const events: StreamEvent[] = [];

    // Handle usage in the chunk (when stream_options.include_usage is true)
    const usage = chunk.usage as Record<string, number> | undefined;
    if (usage) {
      tokenUsage.inputTokens = usage.prompt_tokens ?? tokenUsage.inputTokens;
      tokenUsage.outputTokens = usage.completion_tokens ?? tokenUsage.outputTokens;
    }

    // Handle choices delta
    const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) return events;

    const choice = choices[0];
    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) return events;

    // Text content
    const content = delta.content as string | undefined;
    if (content) {
      events.push({ type: "text", text: content });
    }

    // Tool calls
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown> | undefined;
        if (fn?.name) {
          events.push({
            type: "tool_use",
            name: fn.name as string,
            input: fn.arguments ? tryParseJson(fn.arguments as string) : {},
            toolUseId: (tc.id as string) ?? `tc-${Date.now()}`,
          });
        }
      }
    }

    return events;
  }
}

function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
