import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DecisionTree } from "../../../src/tree/tree.js";
import type { LlmceptionConfig, AnswerOption } from "../../../src/types.js";

// Mock TreeSerializer before importing the module under test
vi.mock("../../../src/tree/serializer.js", () => ({
  TreeSerializer: {
    loadLatest: vi.fn(),
    save: vi.fn(),
  },
}));

import { TreeSerializer } from "../../../src/tree/serializer.js";
import { answerAction } from "../../../src/commands/answer.js";

function makeConfig(): LlmceptionConfig {
  return {
    provider: "claude-cli",
    maxDepth: 3,
    maxWidth: 4,
    nodeBudget: 20,
    concurrency: 3,
    budget: { perBranchUsd: 5.0, totalUsd: 25.0, mode: "hard" },
    branchTimeoutMs: 300_000,
    model: "sonnet",
    permissionMode: "bypassPermissions",
    claudeCodePath: "claude",
    providers: {},
  };
}

function makeAnswer(label: string): AnswerOption {
  return {
    label,
    description: `Description for ${label}`,
    answerText: `Use ${label}`,
  };
}

function makeTreeWithQuestion(): DecisionTree {
  const tree = new DecisionTree("Build a widget", makeConfig());
  const root = tree.createRoot();
  root.setQuestion({
    question: "Which database should we use?",
    header: "Database Choice",
    options: [
      makeAnswer("PostgreSQL"),
      makeAnswer("MongoDB"),
      makeAnswer("SQLite"),
    ],
  });
  const c1 = tree.addChild(root.id, makeAnswer("PostgreSQL"));
  const c2 = tree.addChild(root.id, makeAnswer("MongoDB"));
  const c3 = tree.addChild(root.id, makeAnswer("SQLite"));
  c1.setCompleted([], "");
  c2.setCompleted([], "");
  c3.setCompleted([], "");
  return tree;
}

describe("answerAction", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const mockLoadLatest = vi.mocked(TreeSerializer.loadLatest);
  const mockSave = vi.mocked(TreeSerializer.save);

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockLoadLatest.mockReset();
    mockSave.mockReset();
    mockSave.mockResolvedValue(undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("should print 'No active exploration found' when no tree exists", async () => {
    mockLoadLatest.mockResolvedValue(null);
    await answerAction("1");
    expect(logSpy).toHaveBeenCalledWith("No active exploration found.");
  });

  it("should show guidance when no questions remain", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    const root = tree.createRoot();
    root.setCompleted(["file.ts"], "+1/-0");
    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("1");
    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Single completed leaf — should show resolved message
    expect(allOutput).toMatch(/[Rr]esolved/);
  });

  it("should prune sibling branches when choosing by number", async () => {
    const tree = makeTreeWithQuestion();
    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("1");

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("PostgreSQL");
    expect(allOutput).toContain("pruned 2 branch");

    // The other two should be pruned
    const root = tree.getRootNode();
    const sibling1 = tree.getNode(root.childIds[1]);
    const sibling2 = tree.getNode(root.childIds[2]);
    expect(sibling1?.status).toBe("pruned");
    expect(sibling2?.status).toBe("pruned");
  });

  it("should prune completed siblings (force prune)", async () => {
    const tree = makeTreeWithQuestion();
    // All children are "completed" - pruner must force-prune them
    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("2");

    const root = tree.getRootNode();
    const chosen = tree.getNode(root.childIds[1]);
    const sibling0 = tree.getNode(root.childIds[0]);
    const sibling2 = tree.getNode(root.childIds[2]);
    expect(chosen?.status).toBe("completed"); // not pruned
    expect(sibling0?.status).toBe("pruned");
    expect(sibling2?.status).toBe("pruned");
  });

  it("should match by label substring (case-insensitive)", async () => {
    const tree = makeTreeWithQuestion();
    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("postgres");

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("PostgreSQL");
  });

  it("should save the tree after answering", async () => {
    const tree = makeTreeWithQuestion();
    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("1");
    expect(mockSave).toHaveBeenCalled();
  });

  it("should report resolved when single leaf remains", async () => {
    const tree = makeTreeWithQuestion();
    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("1");

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Resolved");
    expect(allOutput).toContain("apply");
  });

  it("should show next question after answering first one", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    const root = tree.createRoot();
    root.setQuestion({
      question: "Which database?",
      header: "Database Choice",
      options: [makeAnswer("PostgreSQL"), makeAnswer("MongoDB")],
    });
    const c1 = tree.addChild(root.id, makeAnswer("PostgreSQL"));
    const c2 = tree.addChild(root.id, makeAnswer("MongoDB"));
    c1.setCompleted([], "");
    c2.setCompleted([], "");

    // The chosen child has a sub-question with children
    c1.setQuestion({
      question: "Which ORM?",
      header: "ORM Choice",
      options: [makeAnswer("Prisma"), makeAnswer("Drizzle")],
    });
    const gc1 = tree.addChild(c1.id, makeAnswer("Prisma"));
    const gc2 = tree.addChild(c1.id, makeAnswer("Drizzle"));
    gc1.setCompleted([], "");
    gc2.setCompleted([], "");

    mockLoadLatest.mockResolvedValue(tree);

    // Mock stdin to provide "q" for the second question (so the loop exits)
    const { Readable } = await import("node:stream");
    const mockStdin = new Readable({ read() { this.push("q\n"); this.push(null); } });
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, writable: true });

    try {
      await answerAction("1");

      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("PostgreSQL");
      // Should show the ORM question before exiting
      expect(allOutput).toContain("ORM Choice");
    } finally {
      Object.defineProperty(process, "stdin", { value: originalStdin, writable: true });
    }
  });
});
