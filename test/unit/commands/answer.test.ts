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

function makeConfig(overrides: Partial<LlmceptionConfig> = {}): LlmceptionConfig {
  return {
    provider: "claude-cli",
    maxDepth: 3,
    maxWidth: 4,
    nodeBudget: 20,
    concurrency: 3,
    budget: { perBranchUsd: 5.0, totalUsd: 25.0, mode: "hard" },
    branchTimeoutMs: 300_000,
    model: "sonnet",
    permissionMode: "auto",
    claudeCodePath: "claude",
    providers: {},
    ...overrides,
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
  tree.addChild(root.id, makeAnswer("PostgreSQL"));
  tree.addChild(root.id, makeAnswer("MongoDB"));
  tree.addChild(root.id, makeAnswer("SQLite"));
  return tree;
}

describe("answerAction", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const mockLoadLatest = vi.mocked(TreeSerializer.loadLatest);
  const mockSave = vi.mocked(TreeSerializer.save);

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockLoadLatest.mockReset();
    mockSave.mockReset();
    mockSave.mockResolvedValue(undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("should print 'No active exploration found' when no tree exists", async () => {
    mockLoadLatest.mockResolvedValue(null);
    await answerAction("1");
    expect(logSpy).toHaveBeenCalledWith("No active exploration found.");
  });

  it("should print 'No questions to answer' when tree has no unresolved questions", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    const root = tree.createRoot();
    root.setCompleted(["file.ts"], "+1/-0");
    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("1");
    expect(logSpy).toHaveBeenCalledWith("No questions to answer.");
  });

  it("should reject option 0 (below range)", async () => {
    mockLoadLatest.mockResolvedValue(makeTreeWithQuestion());
    await answerAction("0");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid option: 0"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("should reject option above the number of choices", async () => {
    mockLoadLatest.mockResolvedValue(makeTreeWithQuestion());
    await answerAction("4");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid option: 4"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("should reject non-numeric option", async () => {
    mockLoadLatest.mockResolvedValue(makeTreeWithQuestion());
    await answerAction("abc");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid option: abc"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("should prune sibling branches when choosing option 1", async () => {
    const tree = makeTreeWithQuestion();
    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("1");

    // Should report pruning 2 nodes (the 2 unchosen siblings)
    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain('Chose option 1: "PostgreSQL"');
    expect(allOutput).toContain("Pruned 2 node(s).");

    // The chosen child should not be pruned
    const root = tree.getRootNode();
    const chosenChildId = root.childIds[0];
    const chosenChild = tree.getNode(chosenChildId);
    expect(chosenChild?.status).not.toBe("pruned");

    // The other two should be pruned
    const sibling1 = tree.getNode(root.childIds[1]);
    const sibling2 = tree.getNode(root.childIds[2]);
    expect(sibling1?.status).toBe("pruned");
    expect(sibling2?.status).toBe("pruned");
  });

  it("should prune sibling branches when choosing option 2", async () => {
    const tree = makeTreeWithQuestion();
    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("2");

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain('Chose option 2: "MongoDB"');
    expect(allOutput).toContain("Pruned 2 node(s).");

    // Sibling at index 1 (MongoDB) should survive
    const root = tree.getRootNode();
    const chosenChild = tree.getNode(root.childIds[1]);
    expect(chosenChild?.status).not.toBe("pruned");
  });

  it("should save the tree after answering", async () => {
    const tree = makeTreeWithQuestion();
    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("1");
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(tree, expect.any(String));
  });

  it("should report single implementation when resolved", async () => {
    const tree = makeTreeWithQuestion();
    // Mark one child as completed with a branch
    const root = tree.getRootNode();
    const chosenChildId = root.childIds[0];
    const chosenChild = tree.getNode(chosenChildId)!;
    chosenChild.setCompleted(["app.ts"], "+100/-0");
    chosenChild.setWorktree("/tmp/wt", "llmception/test/node1");

    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("1");

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Resolved to a single implementation");
    expect(allOutput).toContain("PostgreSQL");
    expect(allOutput).toContain("llmception/test/node1");
  });

  it("should show next question if one exists after answering", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    const root = tree.createRoot();
    root.setQuestion({
      question: "Which database?",
      header: "Database Choice",
      options: [makeAnswer("PostgreSQL"), makeAnswer("MongoDB")],
    });
    const c1 = tree.addChild(root.id, makeAnswer("PostgreSQL"));
    tree.addChild(root.id, makeAnswer("MongoDB"));

    // The chosen child also has a question
    c1.setQuestion({
      question: "Which ORM?",
      header: "ORM Choice",
      options: [makeAnswer("Prisma"), makeAnswer("Drizzle")],
    });
    tree.addChild(c1.id, makeAnswer("Prisma"));
    tree.addChild(c1.id, makeAnswer("Drizzle"));

    mockLoadLatest.mockResolvedValue(tree);

    await answerAction("1");

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("ORM Choice");
    expect(allOutput).toContain("answer <option>");
  });
});
