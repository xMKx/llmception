import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamParser } from "../../../src/interceptor/stream-parser.js";

describe("StreamParser", () => {
  let parser: StreamParser;

  beforeEach(() => {
    parser = new StreamParser();
  });

  describe("parseLine", () => {
    it("should parse init event and extract session ID", () => {
      const line = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "sess-abc-123",
      });

      const events = parser.parseLine(line);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "init",
        sessionId: "sess-abc-123",
      });
      expect(parser.getSessionId()).toBe("sess-abc-123");
    });

    it("should parse assistant message with text content", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello, I will help you build this." }],
        },
      });

      const events = parser.parseLine(line);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "text",
        text: "Hello, I will help you build this.",
      });
    });

    it("should parse assistant message with tool_use content", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "/src/app.ts" },
            },
          ],
        },
      });

      const events = parser.parseLine(line);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_use",
        name: "Read",
        input: { file_path: "/src/app.ts" },
        toolUseId: "tool-1",
      });
    });

    it("should parse assistant message with mixed text + tool_use blocks", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me read that file." },
            {
              type: "tool_use",
              id: "tool-2",
              name: "Read",
              input: { file_path: "/src/index.ts" },
            },
          ],
        },
      });

      const events = parser.parseLine(line);
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: "text",
        text: "Let me read that file.",
      });
      expect(events[1]).toEqual({
        type: "tool_use",
        name: "Read",
        input: { file_path: "/src/index.ts" },
        toolUseId: "tool-2",
      });
    });

    it("should parse AskUserQuestion tool call and emit ask_user event", () => {
      const toolInput = {
        questions: [
          {
            header: "Auth method",
            question: "Which authentication approach should I use?",
            options: [
              { label: "OAuth2", description: "Use OAuth2 with provider login" },
              { label: "JWT", description: "Use JWT tokens" },
            ],
          },
        ],
      };

      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-ask-1",
              name: "AskUserQuestion",
              input: toolInput,
            },
          ],
        },
      });

      const events = parser.parseLine(line);
      // tool_use event + ask_user event
      expect(events).toHaveLength(2);

      expect(events[0]).toEqual({
        type: "tool_use",
        name: "AskUserQuestion",
        input: toolInput,
        toolUseId: "tool-ask-1",
      });

      expect(events[1].type).toBe("ask_user");
      if (events[1].type === "ask_user") {
        expect(events[1].question.header).toBe("Auth method");
        expect(events[1].question.question).toBe(
          "Which authentication approach should I use?",
        );
        expect(events[1].question.options).toHaveLength(2);
        expect(events[1].question.options[0].label).toBe("OAuth2");
        expect(events[1].question.options[0].description).toBe(
          "Use OAuth2 with provider login",
        );
        expect(events[1].question.options[0].answerText).toBe(
          "OAuth2. Use OAuth2 with provider login",
        );
        expect(events[1].question.options[1].label).toBe("JWT");
        expect(events[1].question.rawToolInput).toEqual(toolInput);
      }
    });

    it("should parse result event with cost and token usage", () => {
      const line = JSON.stringify({
        type: "result",
        result: "Task completed successfully.",
        session_id: "sess-xyz",
        total_cost_usd: 0.05,
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100,
        },
      });

      const events = parser.parseLine(line);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "result",
        costUsd: 0.05,
        sessionId: "sess-xyz",
        tokenUsage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 200,
          cacheWriteTokens: 100,
          costUsd: 0.05,
        },
      });
    });

    it("should handle malformed JSON lines gracefully", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const events = parser.parseLine("this is not json {{{");
      expect(events).toEqual([]);
      expect(warnSpy).toHaveBeenCalledOnce();

      warnSpy.mockRestore();
    });

    it("should handle empty lines", () => {
      expect(parser.parseLine("")).toEqual([]);
      expect(parser.parseLine("   ")).toEqual([]);
      expect(parser.parseLine("\t")).toEqual([]);
    });

    it("should handle unknown event types gracefully", () => {
      const line = JSON.stringify({ type: "unknown_type", data: "something" });
      const events = parser.parseLine(line);
      expect(events).toEqual([]);
    });

    it("should handle assistant message with empty content array", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: { content: [] },
      });

      const events = parser.parseLine(line);
      expect(events).toEqual([]);
    });

    it("should handle assistant message with missing content", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {},
      });

      const events = parser.parseLine(line);
      expect(events).toEqual([]);
    });
  });

  describe("parseLine — AskUserQuestion edge cases", () => {
    it("should take the first question when multiple are present", () => {
      const toolInput = {
        questions: [
          {
            header: "First question",
            question: "Choose option A or B?",
            options: [
              { label: "A", description: "Option A" },
              { label: "B", description: "Option B" },
            ],
          },
          {
            header: "Second question",
            question: "Choose X or Y?",
            options: [
              { label: "X", description: "Option X" },
              { label: "Y", description: "Option Y" },
            ],
          },
        ],
      };

      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-multi",
              name: "AskUserQuestion",
              input: toolInput,
            },
          ],
        },
      });

      const events = parser.parseLine(line);
      const askEvent = events.find((e) => e.type === "ask_user");
      expect(askEvent).toBeDefined();
      if (askEvent && askEvent.type === "ask_user") {
        expect(askEvent.question.header).toBe("First question");
        expect(askEvent.question.question).toBe("Choose option A or B?");
        expect(askEvent.question.options).toHaveLength(2);
      }
    });

    it("should handle AskUserQuestion with missing fields gracefully", () => {
      const toolInput = {
        questions: [
          {
            // missing header and question
            options: [{ label: "Only label" }],
          },
        ],
      };

      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-degraded",
              name: "AskUserQuestion",
              input: toolInput,
            },
          ],
        },
      });

      const events = parser.parseLine(line);
      const askEvent = events.find((e) => e.type === "ask_user");
      expect(askEvent).toBeDefined();
      if (askEvent && askEvent.type === "ask_user") {
        expect(askEvent.question.header).toBe("");
        expect(askEvent.question.question).toBe("");
        // The option should still be extracted with label acting as description
        expect(askEvent.question.options).toHaveLength(1);
        expect(askEvent.question.options[0].label).toBe("Only label");
      }
    });

    it("should handle AskUserQuestion with null input", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-null",
              name: "AskUserQuestion",
              input: null,
            },
          ],
        },
      });

      const events = parser.parseLine(line);
      // Should still produce tool_use event but no ask_user
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_use");
    });

    it("should handle AskUserQuestion with empty questions array", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-empty-q",
              name: "AskUserQuestion",
              input: { questions: [] },
            },
          ],
        },
      });

      const events = parser.parseLine(line);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_use");
    });
  });

  describe("parseLines", () => {
    it("should parse multi-line input", () => {
      const input = [
        JSON.stringify({ type: "system", subtype: "init", session_id: "sess-1" }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Working on it..." }],
          },
        }),
        JSON.stringify({
          type: "result",
          result: "Done",
          session_id: "sess-1",
          total_cost_usd: 0.02,
          usage: {
            input_tokens: 500,
            output_tokens: 200,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        }),
      ].join("\n");

      const events = parser.parseLines(input);
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe("init");
      expect(events[1].type).toBe("text");
      expect(events[2].type).toBe("result");
    });

    it("should skip empty lines in multi-line input", () => {
      const input = [
        "",
        JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
        "",
        "",
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "hi" }] },
        }),
        "",
      ].join("\n");

      const events = parser.parseLines(input);
      expect(events).toHaveLength(2);
    });

    it("should skip malformed lines and continue parsing", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const input = [
        JSON.stringify({ type: "system", subtype: "init", session_id: "s2" }),
        "not json at all",
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "still works" }] },
        }),
      ].join("\n");

      const events = parser.parseLines(input);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("init");
      expect(events[1].type).toBe("text");

      warnSpy.mockRestore();
    });
  });

  describe("getSessionId", () => {
    it("should return null before any init event", () => {
      expect(parser.getSessionId()).toBeNull();
    });

    it("should track the most recent session ID", () => {
      parser.parseLine(
        JSON.stringify({ type: "system", subtype: "init", session_id: "first" }),
      );
      expect(parser.getSessionId()).toBe("first");

      parser.parseLine(
        JSON.stringify({ type: "system", subtype: "init", session_id: "second" }),
      );
      expect(parser.getSessionId()).toBe("second");
    });
  });
});
