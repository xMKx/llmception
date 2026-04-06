import type {
  StreamEvent,
  InterceptedQuestion,
  TokenUsage,
} from "../types.js";
import { OptionExtractor } from "./option-extractor.js";

/**
 * Raw JSON shape from Claude Code `--output-format stream-json`.
 * Each line is one JSON object with a `type` field.
 */
interface RawStreamInit {
  type: "system";
  subtype: "init";
  session_id: string;
}

interface RawContentText {
  type: "text";
  text: string;
}

interface RawContentToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

type RawContentBlock = RawContentText | RawContentToolUse;

interface RawAssistantMessage {
  type: "assistant";
  message: {
    content: RawContentBlock[];
  };
}

interface RawResult {
  type: "result";
  result: string;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

type RawStreamLine = RawStreamInit | RawAssistantMessage | RawResult;

const ASK_USER_TOOL_NAME = "AskUserQuestion";

/**
 * Parses Claude Code stream-json output into typed StreamEvents.
 */
export class StreamParser {
  private sessionId: string | null = null;

  constructor() {
    // no-op — stateless aside from sessionId tracking
  }

  /** The session ID extracted from the most recent init event. */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Parse a single JSON line and return zero or more StreamEvents.
   * One assistant message line can produce multiple events (text + tool_use blocks).
   */
  parseLine(line: string): StreamEvent[] {
    const trimmed = line.trim();
    if (trimmed === "") {
      return [];
    }

    let parsed: RawStreamLine;
    try {
      parsed = JSON.parse(trimmed) as RawStreamLine;
    } catch {
      console.warn(`[StreamParser] Skipping malformed JSON line: ${trimmed.slice(0, 120)}`);
      return [];
    }

    return this.handleParsed(parsed);
  }

  /**
   * Split input by newlines and parse all lines.
   */
  parseLines(input: string): StreamEvent[] {
    const lines = input.split("\n");
    const events: StreamEvent[] = [];
    for (const line of lines) {
      events.push(...this.parseLine(line));
    }
    return events;
  }

  private handleParsed(raw: RawStreamLine): StreamEvent[] {
    switch (raw.type) {
      case "system":
        return this.handleInit(raw as RawStreamInit);
      case "assistant":
        return this.handleAssistant(raw as RawAssistantMessage);
      case "result":
        return this.handleResult(raw as RawResult);
      default:
        return [];
    }
  }

  private handleInit(raw: RawStreamInit): StreamEvent[] {
    if (raw.subtype !== "init") {
      return [];
    }
    this.sessionId = raw.session_id;
    return [{ type: "init", sessionId: raw.session_id }];
  }

  private handleAssistant(raw: RawAssistantMessage): StreamEvent[] {
    const events: StreamEvent[] = [];
    const content = raw.message?.content;
    if (!Array.isArray(content)) {
      return events;
    }

    for (const block of content) {
      if (block.type === "text") {
        events.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        const toolEvent: StreamEvent = {
          type: "tool_use",
          name: block.name,
          input: block.input,
          toolUseId: block.id,
        };
        events.push(toolEvent);

        // Detect AskUserQuestion and emit an ask_user event
        if (block.name === ASK_USER_TOOL_NAME) {
          const question = this.parseAskUserQuestion(block.input);
          if (question) {
            events.push({ type: "ask_user", question });
          }
        }
      }
    }

    return events;
  }

  private handleResult(raw: RawResult): StreamEvent[] {
    const usage = raw.usage;
    const tokenUsage: TokenUsage = {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
      costUsd: raw.total_cost_usd ?? 0,
    };

    return [
      {
        type: "result",
        costUsd: raw.total_cost_usd ?? 0,
        sessionId: raw.session_id ?? this.sessionId ?? "",
        tokenUsage,
      },
    ];
  }

  private parseAskUserQuestion(input: unknown): InterceptedQuestion | null {
    if (input == null || typeof input !== "object") {
      return null;
    }

    const obj = input as Record<string, unknown>;
    const questions = obj.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      return null;
    }

    const first = questions[0] as Record<string, unknown>;
    const header = typeof first.header === "string" ? first.header : "";
    const questionText = typeof first.question === "string" ? first.question : "";
    const options = OptionExtractor.fromToolInput(input);

    return {
      header,
      question: questionText,
      options,
      rawToolInput: input,
    };
  }
}
