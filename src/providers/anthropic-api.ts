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

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 8192;

/**
 * Provider that executes tasks via the Anthropic Messages API.
 * Uses native fetch (Node 20+) and parses SSE streams.
 */
export class AnthropicApiProvider implements ExecutionProvider {
  readonly name = "Anthropic API";
  readonly type: ProviderType = "anthropic";
  readonly pricing: PricingModel = "metered";
  readonly supportsFork = false;

  private config: LlmceptionConfig;
  private abortController: AbortController | null = null;

  constructor(config: LlmceptionConfig) {
    this.config = config;
  }

  async *execute(opts: ExecuteOpts): AsyncGenerator<StreamEvent> {
    const apiKey = this.getApiKey();
    const model = opts.model ?? this.config.providers.anthropic?.model ?? this.config.model ?? DEFAULT_MODEL;

    const body = {
      model,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: opts.systemPrompt ?? "",
      messages: [{ role: "user", content: opts.prompt }],
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
      this.config.providers.anthropic?.apiKey ??
      process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        "Anthropic API key not configured. Set providers.anthropic.apiKey or ANTHROPIC_API_KEY env var.",
      );
    }
    return key;
  }

  private async *streamRequest(
    apiKey: string,
    body: Record<string, unknown>,
  ): AsyncGenerator<StreamEvent> {
    this.abortController = new AbortController();

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "error", message: `Anthropic API request failed: ${msg}` };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      yield {
        type: "error",
        message: `Anthropic API error ${response.status}: ${text.slice(0, 500)}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "Anthropic API returned no body" };
      return;
    }

    let sessionId = "";
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
        // Keep the last partial line in the buffer
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

          const events = this.mapAnthropicEvent(parsed, sessionId, tokenUsage);
          for (const event of events) {
            if (event.type === "init") {
              sessionId = event.sessionId;
            }
            yield event;
          }
        }
      }
    } finally {
      reader.releaseLock();
      this.abortController = null;
    }
  }

  private mapAnthropicEvent(
    event: Record<string, unknown>,
    _sessionId: string,
    tokenUsage: TokenUsage,
  ): StreamEvent[] {
    const eventType = event.type as string;
    const events: StreamEvent[] = [];

    switch (eventType) {
      case "message_start": {
        const message = event.message as Record<string, unknown> | undefined;
        const id = (message?.id as string) ?? `anthropic-${Date.now()}`;
        const usage = message?.usage as Record<string, number> | undefined;
        if (usage) {
          tokenUsage.inputTokens += usage.input_tokens ?? 0;
          tokenUsage.outputTokens += usage.output_tokens ?? 0;
          tokenUsage.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
          tokenUsage.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
        }
        events.push({ type: "init", sessionId: id });
        break;
      }

      case "content_block_start": {
        const contentBlock = event.content_block as Record<string, unknown> | undefined;
        if (contentBlock?.type === "tool_use") {
          events.push({
            type: "tool_use",
            name: contentBlock.name as string,
            input: {},
            toolUseId: contentBlock.id as string,
          });
        }
        break;
      }

      case "content_block_delta": {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta") {
          events.push({
            type: "text",
            text: delta.text as string,
          });
        } else if (delta?.type === "input_json_delta") {
          // Accumulating tool input JSON — we could track this but it's
          // partial JSON, so we skip for now. The full input arrives in
          // content_block_stop in some implementations.
        }
        break;
      }

      case "message_delta": {
        const usage = event.usage as Record<string, number> | undefined;
        if (usage) {
          tokenUsage.outputTokens += usage.output_tokens ?? 0;
        }
        break;
      }

      case "message_stop": {
        events.push({
          type: "result",
          costUsd: tokenUsage.costUsd,
          sessionId: _sessionId,
          tokenUsage: { ...tokenUsage },
        });
        break;
      }

      default:
        // Ignore ping, content_block_stop, etc.
        break;
    }

    return events;
  }
}
