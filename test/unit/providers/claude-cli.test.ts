import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClaudeCliProvider } from "../../../src/providers/claude-cli.js";
import type { LlmceptionConfig, StreamEvent } from "../../../src/types.js";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

// Mock child_process.spawn
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
const mockSpawn = vi.mocked(spawn);

function makeConfig(
  overrides: Partial<LlmceptionConfig> = {},
): LlmceptionConfig {
  return {
    provider: "claude-cli",
    maxDepth: 3,
    maxWidth: 4,
    nodeBudget: 20,
    concurrency: 2,
    budget: { perBranchUsd: 5.0, totalUsd: 25.0, mode: "hard" },
    branchTimeoutMs: 60000,
    model: "sonnet",
    permissionMode: "auto",
    claudeCodePath: "/usr/local/bin/claude",
    providers: {},
    ...overrides,
  };
}

interface MockProcess extends EventEmitter {
  stdout: Readable;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
  });
  return proc;
}

function pushLines(proc: MockProcess, lines: string[]): void {
  for (const line of lines) {
    proc.stdout.push(line + "\n");
  }
  proc.stdout.push(null); // EOF
}

async function collectEvents(
  gen: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("ClaudeCliProvider", () => {
  let provider: ClaudeCliProvider;

  beforeEach(() => {
    provider = new ClaudeCliProvider(makeConfig());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("properties", () => {
    it("should have correct name, type, pricing, supportsFork", () => {
      expect(provider.name).toBe("Claude Code CLI");
      expect(provider.type).toBe("claude-cli");
      expect(provider.pricing).toBe("subscription");
      expect(provider.supportsFork).toBe(true);
    });
  });

  describe("execute()", () => {
    it("should yield events from mocked stream output", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc as never);

      const lines = [
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "sess-123",
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Hello world" }],
          },
        }),
        JSON.stringify({
          type: "result",
          result: "Done",
          session_id: "sess-123",
          total_cost_usd: 0.05,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 5,
          },
        }),
      ];

      // Push lines and close after a tick
      setTimeout(() => {
        pushLines(mockProc, lines);
        mockProc.emit("close", 0);
      }, 10);

      const events = await collectEvents(
        provider.execute({
          prompt: "Build a REST API",
          cwd: "/tmp/test",
        }),
      );

      expect(events.length).toBe(3);
      expect(events[0]).toEqual({ type: "init", sessionId: "sess-123" });
      expect(events[1]).toEqual({ type: "text", text: "Hello world" });
      expect(events[2]).toMatchObject({
        type: "result",
        costUsd: 0.05,
        sessionId: "sess-123",
      });

      // Verify spawn was called with the right executable
      expect(mockSpawn).toHaveBeenCalledWith(
        "/usr/local/bin/claude",
        expect.any(Array),
        expect.objectContaining({ cwd: "/tmp/test" }),
      );
    });

    it("should yield error event on non-zero exit code", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc as never);

      setTimeout(() => {
        mockProc.stderr.emit("data", Buffer.from("Something went wrong"));
        mockProc.stdout.push(null);
        mockProc.emit("close", 1);
      }, 10);

      const events = await collectEvents(
        provider.execute({
          prompt: "Build something",
          cwd: "/tmp/test",
        }),
      );

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect((errorEvent as { type: "error"; message: string }).message).toContain(
        "Something went wrong",
      );
    });

    it("should handle process spawn errors", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc as never);

      setTimeout(() => {
        mockProc.stdout.push(null);
        mockProc.emit("error", new Error("ENOENT"));
        mockProc.emit("close", 1);
      }, 10);

      const events = await collectEvents(
        provider.execute({
          prompt: "Build something",
          cwd: "/tmp/test",
        }),
      );

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });
  });

  describe("fork()", () => {
    it("should include resume args with parent session id", async () => {
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc as never);

      const initLine = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "sess-child-456",
      });
      const resultLine = JSON.stringify({
        type: "result",
        result: "Done",
        session_id: "sess-child-456",
        total_cost_usd: 0.02,
        usage: {
          input_tokens: 50,
          output_tokens: 25,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      });

      setTimeout(() => {
        pushLines(mockProc, [initLine, resultLine]);
        mockProc.emit("close", 0);
      }, 10);

      const events = await collectEvents(
        provider.fork({
          prompt: "Use REST",
          cwd: "/tmp/test",
          parentSessionId: "sess-parent-123",
        }),
      );

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]).toEqual({
        type: "init",
        sessionId: "sess-child-456",
      });

      // Check the spawn args contain --resume and the parent session ID
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain("--resume");
      expect(spawnArgs).toContain("sess-parent-123");
    });
  });
});
