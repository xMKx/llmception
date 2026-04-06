import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DecisionTree } from "../../../src/tree/tree.js";
import type { LlmceptionConfig, AnswerOption } from "../../../src/types.js";

// Mock TreeSerializer before importing the module under test
vi.mock("../../../src/tree/serializer.js", () => ({
  TreeSerializer: {
    loadLatest: vi.fn(),
  },
}));

import { TreeSerializer } from "../../../src/tree/serializer.js";
import { statusAction } from "../../../src/commands/status.js";

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

describe("statusAction", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const mockLoadLatest = vi.mocked(TreeSerializer.loadLatest);

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockLoadLatest.mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("should print 'No active exploration found' when no tree exists", async () => {
    mockLoadLatest.mockResolvedValue(null);
    await statusAction({});
    expect(logSpy).toHaveBeenCalledWith("No active exploration found.");
  });

  it("should print JSON when --json flag is set", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    tree.createRoot();
    mockLoadLatest.mockResolvedValue(tree);

    await statusAction({ json: true });

    const output = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.task).toBe("Build a widget");
    expect(parsed.rootId).toBeTruthy();
    expect(parsed.nodes).toBeDefined();
  });

  it("should print tree visualization when --tree flag is set", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    const root = tree.createRoot();
    root.setStatus("completed");
    tree.addChild(root.id, makeAnswer("Option A"));
    tree.addChild(root.id, makeAnswer("Option B"));
    mockLoadLatest.mockResolvedValue(tree);

    await statusAction({ tree: true });

    // formatTree output includes "Decision Tree:" and node labels
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("Decision Tree:");
    expect(output).toContain("ROOT");
  });

  it("should print status summary by default", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    tree.createRoot();
    mockLoadLatest.mockResolvedValue(tree);

    await statusAction({});

    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("Tree Status");
    expect(output).toContain("Build a widget");
  });

  it("should print the first unresolved question with status summary", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    const root = tree.createRoot();
    root.setQuestion({
      question: "Which database should we use?",
      header: "Database Choice",
      options: [makeAnswer("PostgreSQL"), makeAnswer("MongoDB")],
    });
    tree.addChild(root.id, makeAnswer("PostgreSQL"));
    tree.addChild(root.id, makeAnswer("MongoDB"));
    mockLoadLatest.mockResolvedValue(tree);

    await statusAction({});

    // Should have 3 calls: formatStatus, formatQuestion, and the prompt
    expect(logSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Database Choice");
  });

  it("should not show question prompt when no questions exist", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    const root = tree.createRoot();
    root.setCompleted(["file.ts"], "+1/-0");
    mockLoadLatest.mockResolvedValue(tree);

    await statusAction({});

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).not.toContain("answer <option>");
  });
});
