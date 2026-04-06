import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "../../../src/runner/orchestrator.js";
import type {
  ExecutionProvider,
  StreamEvent,
  LlmceptionConfig,
  InterceptedQuestion,
  TokenUsage,
} from "../../../src/types.js";

// Mock external dependencies so we don't hit real file system or git
vi.mock("../../../src/tree/serializer.js", () => ({
  TreeSerializer: {
    save: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../src/git/worktree.js", () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({
    ensureGitignore: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "llmception/test/node",
    }),
    getRepoRoot: vi.fn().mockReturnValue("/tmp/repo"),
    snapshot: vi.fn().mockResolvedValue("abc123"),
  })),
}));

// We need to mock ProviderRegistry to return our test providers
let mockProvider: ExecutionProvider;

vi.mock("../../../src/providers/registry.js", () => ({
  ProviderRegistry: {
    create: vi.fn(() => mockProvider),
  },
}));

function makeConfig(
  overrides: Partial<LlmceptionConfig> = {},
): LlmceptionConfig {
  return {
    provider: "claude-cli",
    maxDepth: 3,
    maxWidth: 4,
    nodeBudget: 20,
    concurrency: 3,
    budget: { perBranchUsd: 5.0, totalUsd: 25.0, mode: "hard" },
    branchTimeoutMs: 60000,
    model: "sonnet",
    permissionMode: "auto",
    claudeCodePath: "claude",
    providers: {},
    ...overrides,
  };
}

function makeTokenUsage(costUsd = 0.01): TokenUsage {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd,
  };
}

function makeQuestion(
  header: string,
  options: string[],
): InterceptedQuestion {
  return {
    header,
    question: `Full question about ${header}`,
    options: options.map((label) => ({
      label,
      description: `Description for ${label}`,
      answerText: `Use ${label}`,
    })),
  };
}

/**
 * Creates a mock provider whose execute() yields predetermined events.
 * If the events include an ask_user, the fork() will yield completion events
 * for the child branches.
 */
function createMockProvider(
  executeEvents: StreamEvent[],
  forkEvents?: StreamEvent[],
): ExecutionProvider {
  const defaultForkEvents: StreamEvent[] = forkEvents ?? [
    { type: "init", sessionId: "fork-sess-" + Date.now() },
    { type: "text", text: "Continuing with chosen option..." },
    {
      type: "result",
      costUsd: 0.005,
      sessionId: "fork-sess-" + Date.now(),
      tokenUsage: makeTokenUsage(0.005),
    },
  ];

  return {
    name: "mock",
    type: "claude-cli",
    pricing: "subscription",
    supportsFork: true,
    async *execute() {
      for (const e of executeEvents) {
        await new Promise((r) => setTimeout(r, 5));
        yield e;
      }
    },
    async *fork() {
      for (const e of defaultForkEvents) {
        await new Promise((r) => setTimeout(r, 5));
        yield e;
      }
    },
  };
}

describe("Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("simple task with no questions", () => {
    it("should produce a single completed root node", async () => {
      const events: StreamEvent[] = [
        { type: "init", sessionId: "sess-root" },
        { type: "text", text: "Building the API..." },
        {
          type: "result",
          costUsd: 0.05,
          sessionId: "sess-root",
          tokenUsage: makeTokenUsage(0.05),
        },
      ];

      mockProvider = createMockProvider(events);
      const config = makeConfig();
      const orchestrator = new Orchestrator(config);

      const tree = await orchestrator.explore("Build a REST API", "/tmp/repo");

      const stats = tree.getStats();
      expect(stats.totalNodes).toBe(1);
      expect(stats.completedNodes).toBe(1);
      expect(stats.questionedNodes).toBe(0);

      const root = tree.getRootNode();
      expect(root.status).toBe("completed");
      expect(root.sessionId).toBe("sess-root");
    });
  });

  describe("task with one question", () => {
    it("should fork into children for each answer option", async () => {
      const question = makeQuestion("Auth Strategy", ["JWT", "Sessions"]);

      const executeEvents: StreamEvent[] = [
        { type: "init", sessionId: "sess-root" },
        { type: "text", text: "Let me analyze the requirements..." },
        { type: "ask_user", question },
        // After ask_user, the root process completes
        {
          type: "result",
          costUsd: 0.03,
          sessionId: "sess-root",
          tokenUsage: makeTokenUsage(0.03),
        },
      ];

      mockProvider = createMockProvider(executeEvents);
      const config = makeConfig({ maxWidth: 4 });
      const orchestrator = new Orchestrator(config);

      const tree = await orchestrator.explore("Build auth system", "/tmp/repo");

      const stats = tree.getStats();
      // Root (questioned/forking) + 2 children (completed)
      expect(stats.totalNodes).toBe(3);

      const root = tree.getRootNode();
      // Root should be in forking state (it had a question)
      expect(root.question).not.toBeNull();
      expect(root.question!.header).toBe("Auth Strategy");
      expect(root.childIds.length).toBe(2);

      // Children should be completed
      for (const childId of root.childIds) {
        const child = tree.getNode(childId);
        expect(child).toBeDefined();
        expect(child!.status).toBe("completed");
        expect(child!.answer).not.toBeNull();
      }
    });
  });

  describe("respects maxDepth", () => {
    it("should auto-resolve questions at maxDepth", async () => {
      const question = makeQuestion("Database", ["PostgreSQL", "MySQL"]);

      const executeEvents: StreamEvent[] = [
        { type: "init", sessionId: "sess-root" },
        { type: "ask_user", question },
        {
          type: "result",
          costUsd: 0.02,
          sessionId: "sess-root",
          tokenUsage: makeTokenUsage(0.02),
        },
      ];

      // Set maxDepth=1 so children at depth 1 that get questions auto-resolve
      // But first, the root (depth 0) is still within depth, so it will fork.
      // The fork children will be at depth 1 (== maxDepth), so if THEY
      // encounter a question, they'd auto-resolve.
      //
      // For this test, set maxDepth=0 so the root itself auto-resolves.
      mockProvider = createMockProvider(executeEvents);
      const config = makeConfig({ maxDepth: 0 });
      const orchestrator = new Orchestrator(config);

      const tree = await orchestrator.explore("Choose DB", "/tmp/repo");

      const root = tree.getRootNode();
      // Root should be auto-resolved (depth 0 >= maxDepth 0)
      expect(root.status).toBe("auto-resolved");
      // Should have exactly 1 child (the auto-resolved choice)
      expect(root.childIds.length).toBe(1);

      const child = tree.getNode(root.childIds[0]);
      expect(child).toBeDefined();
      expect(child!.answer!.label).toBe("PostgreSQL"); // First option
    });
  });

  describe("respects nodeBudget", () => {
    it("should stop forking when node budget is exhausted", async () => {
      const question = makeQuestion("Framework", [
        "Express",
        "Fastify",
        "Hono",
        "Koa",
      ]);

      const executeEvents: StreamEvent[] = [
        { type: "init", sessionId: "sess-root" },
        { type: "ask_user", question },
        {
          type: "result",
          costUsd: 0.01,
          sessionId: "sess-root",
          tokenUsage: makeTokenUsage(0.01),
        },
      ];

      // nodeBudget = 3 means: root + at most 2 children
      mockProvider = createMockProvider(executeEvents);
      const config = makeConfig({ nodeBudget: 3, maxWidth: 4 });
      const orchestrator = new Orchestrator(config);

      const tree = await orchestrator.explore("Pick framework", "/tmp/repo");

      const stats = tree.getStats();
      // Should have root + 2 children (not 4, despite 4 options)
      expect(stats.totalNodes).toBeLessThanOrEqual(3);
    });
  });

  describe("cost tracking", () => {
    it("should accumulate costs across nodes", async () => {
      const events: StreamEvent[] = [
        { type: "init", sessionId: "sess-root" },
        { type: "text", text: "Done" },
        {
          type: "result",
          costUsd: 0.10,
          sessionId: "sess-root",
          tokenUsage: makeTokenUsage(0.10),
        },
      ];

      mockProvider = createMockProvider(events);
      const config = makeConfig();
      const orchestrator = new Orchestrator(config);

      const tree = await orchestrator.explore("Simple task", "/tmp/repo");

      const stats = tree.getStats();
      expect(stats.totalCostUsd).toBeGreaterThan(0);

      const root = tree.getRootNode();
      expect(root.costUsd).toBe(0.10);
    });
  });

  describe("error handling", () => {
    it("should mark node as failed on error event", async () => {
      const events: StreamEvent[] = [
        { type: "init", sessionId: "sess-root" },
        { type: "error", message: "Something exploded" },
      ];

      mockProvider = createMockProvider(events);
      const config = makeConfig();
      const orchestrator = new Orchestrator(config);

      const tree = await orchestrator.explore("Failing task", "/tmp/repo");

      const root = tree.getRootNode();
      expect(root.status).toBe("failed");
      expect(root.error).toBe("Something exploded");
    });
  });

  describe("progress callbacks", () => {
    it("should fire progress callbacks during exploration", async () => {
      const progressSpy = vi.fn();

      const events: StreamEvent[] = [
        { type: "init", sessionId: "sess-root" },
        { type: "text", text: "Working..." },
        {
          type: "result",
          costUsd: 0.01,
          sessionId: "sess-root",
          tokenUsage: makeTokenUsage(0.01),
        },
      ];

      mockProvider = createMockProvider(events);
      const config = makeConfig();
      const orchestrator = new Orchestrator(config);
      orchestrator.onProgress(progressSpy);

      await orchestrator.explore("Task", "/tmp/repo");

      // Should have been called at least twice: once for root start, once for root complete
      expect(progressSpy).toHaveBeenCalled();
      expect(progressSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("question with no options", () => {
    it("should mark node as completed when question has no options", async () => {
      const emptyQuestion: InterceptedQuestion = {
        header: "Empty",
        question: "No options here",
        options: [],
      };

      const events: StreamEvent[] = [
        { type: "init", sessionId: "sess-root" },
        { type: "ask_user", question: emptyQuestion },
        {
          type: "result",
          costUsd: 0.01,
          sessionId: "sess-root",
          tokenUsage: makeTokenUsage(0.01),
        },
      ];

      mockProvider = createMockProvider(events);
      const config = makeConfig();
      const orchestrator = new Orchestrator(config);

      const tree = await orchestrator.explore("Empty options", "/tmp/repo");

      const stats = tree.getStats();
      // Root only, no children since no options
      expect(stats.totalNodes).toBe(1);
    });
  });
});
