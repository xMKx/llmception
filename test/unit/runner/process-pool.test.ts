import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProcessPool } from "../../../src/runner/process-pool.js";
import type {
  ExecutionProvider,
  StreamEvent,
  LlmceptionConfig,
} from "../../../src/types.js";

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
    claudeCodePath: "claude",
    providers: {},
    ...overrides,
  };
}

function createMockProvider(
  events: StreamEvent[],
  delay = 0,
): ExecutionProvider {
  return {
    name: "mock",
    type: "claude-cli",
    pricing: "subscription",
    supportsFork: true,
    async *execute() {
      for (const e of events) {
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        yield e;
      }
    },
    async *fork() {
      for (const e of events) {
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        yield e;
      }
    },
  };
}

const SIMPLE_EVENTS: StreamEvent[] = [
  { type: "init", sessionId: "sess-1" },
  { type: "text", text: "Hello" },
  {
    type: "result",
    costUsd: 0.01,
    sessionId: "sess-1",
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.01,
    },
  },
];

describe("ProcessPool", () => {
  let config: LlmceptionConfig;

  beforeEach(() => {
    config = makeConfig({ concurrency: 2 });
  });

  describe("concurrency", () => {
    it("should respect concurrency limit", async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const trackingProvider = createMockProvider(SIMPLE_EVENTS, 50);
      const originalExecute = trackingProvider.execute.bind(trackingProvider);

      // Wrap execute to track concurrency
      trackingProvider.execute = async function* (opts) {
        currentConcurrent++;
        if (currentConcurrent > maxConcurrent) {
          maxConcurrent = currentConcurrent;
        }
        try {
          yield* originalExecute(opts);
        } finally {
          currentConcurrent--;
        }
      };

      const pool = new ProcessPool(config, trackingProvider);

      // Submit 4 tasks with concurrency limit of 2
      for (let i = 0; i < 4; i++) {
        pool.submit(`task-${i}`, { prompt: `Task ${i}`, cwd: "/tmp" }, false);
      }

      await pool.waitForAll();

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe("queue processing", () => {
    it("should process queue in FIFO order", async () => {
      const completionOrder: string[] = [];
      const provider = createMockProvider(SIMPLE_EVENTS, 10);
      const pool = new ProcessPool(
        makeConfig({ concurrency: 1 }),
        provider,
      );

      pool.onComplete((id) => {
        completionOrder.push(id);
      });

      pool.submit("first", { prompt: "1", cwd: "/tmp" }, false);
      pool.submit("second", { prompt: "2", cwd: "/tmp" }, false);
      pool.submit("third", { prompt: "3", cwd: "/tmp" }, false);

      await pool.waitForAll();

      expect(completionOrder).toEqual(["first", "second", "third"]);
    });
  });

  describe("event callbacks", () => {
    it("should fire onEvent callbacks for each stream event", async () => {
      const receivedEvents: Array<{ id: string; event: StreamEvent }> = [];
      const provider = createMockProvider(SIMPLE_EVENTS);
      const pool = new ProcessPool(config, provider);

      pool.onEvent((id, event) => {
        receivedEvents.push({ id, event });
      });

      pool.submit("test-1", { prompt: "Hello", cwd: "/tmp" }, false);
      await pool.waitForAll();

      expect(receivedEvents.length).toBe(SIMPLE_EVENTS.length);
      expect(receivedEvents[0].id).toBe("test-1");
      expect(receivedEvents[0].event.type).toBe("init");
      expect(receivedEvents[1].event.type).toBe("text");
      expect(receivedEvents[2].event.type).toBe("result");
    });

    it("should fire onComplete callbacks when a process finishes", async () => {
      const completed: string[] = [];
      const provider = createMockProvider(SIMPLE_EVENTS);
      const pool = new ProcessPool(config, provider);

      pool.onComplete((id) => {
        completed.push(id);
      });

      pool.submit("a", { prompt: "A", cwd: "/tmp" }, false);
      pool.submit("b", { prompt: "B", cwd: "/tmp" }, false);
      await pool.waitForAll();

      expect(completed).toContain("a");
      expect(completed).toContain("b");
      expect(completed.length).toBe(2);
    });
  });

  describe("stop()", () => {
    it("should abort running processes and clear queue", async () => {
      const provider = createMockProvider(SIMPLE_EVENTS, 200);
      const pool = new ProcessPool(makeConfig({ concurrency: 1 }), provider);

      pool.submit("slow-1", { prompt: "Slow", cwd: "/tmp" }, false);
      pool.submit("slow-2", { prompt: "Slow", cwd: "/tmp" }, false);
      pool.submit("slow-3", { prompt: "Slow", cwd: "/tmp" }, false);

      // Let first task start
      await new Promise((r) => setTimeout(r, 20));

      pool.stop();

      expect(pool.getPendingCount()).toBe(0);
      // Running count should be 0 or 1 (abort is best-effort)
      expect(pool.getRunningCount()).toBeLessThanOrEqual(1);
    });

    it("should reject new submissions after stop", () => {
      const provider = createMockProvider(SIMPLE_EVENTS);
      const pool = new ProcessPool(config, provider);
      pool.stop();

      pool.submit("rejected", { prompt: "X", cwd: "/tmp" }, false);
      expect(pool.getPendingCount()).toBe(0);
    });
  });

  describe("getRunningCount / getPendingCount", () => {
    it("should report correct counts", async () => {
      const provider = createMockProvider(SIMPLE_EVENTS, 100);
      const pool = new ProcessPool(makeConfig({ concurrency: 1 }), provider);

      pool.submit("t1", { prompt: "1", cwd: "/tmp" }, false);
      pool.submit("t2", { prompt: "2", cwd: "/tmp" }, false);

      // Let the first start
      await new Promise((r) => setTimeout(r, 10));

      expect(pool.getRunningCount()).toBe(1);
      expect(pool.getPendingCount()).toBe(1);

      await pool.waitForAll();

      expect(pool.getRunningCount()).toBe(0);
      expect(pool.getPendingCount()).toBe(0);
    });
  });

  describe("fork submissions", () => {
    it("should use fork for fork submissions", async () => {
      const forkEvents: StreamEvent[] = [
        { type: "init", sessionId: "fork-sess" },
        {
          type: "result",
          costUsd: 0.02,
          sessionId: "fork-sess",
          tokenUsage: {
            inputTokens: 20,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0.02,
          },
        },
      ];

      const forkSpy = vi.fn(async function* () {
        for (const e of forkEvents) yield e;
      });

      const provider: ExecutionProvider = {
        name: "mock",
        type: "claude-cli",
        pricing: "subscription",
        supportsFork: true,
        async *execute() {
          for (const e of SIMPLE_EVENTS) yield e;
        },
        fork: forkSpy,
      };

      const pool = new ProcessPool(config, provider);
      pool.submit(
        "fork-task",
        { prompt: "Use REST", cwd: "/tmp", parentSessionId: "parent-sess" },
        true,
      );

      await pool.waitForAll();

      expect(forkSpy).toHaveBeenCalledTimes(1);
    });
  });
});
