import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DecisionTree } from "../../../src/tree/tree.js";
import type { LlmceptionConfig, AnswerOption } from "../../../src/types.js";

// Mock TreeSerializer
vi.mock("../../../src/tree/serializer.js", () => ({
  TreeSerializer: {
    loadLatest: vi.fn(),
  },
}));

// Mock ProviderRegistry for pricing info
vi.mock("../../../src/providers/registry.js", () => ({
  ProviderRegistry: {
    getProviderInfo: vi.fn(() => ({
      name: "Claude Code CLI",
      pricing: "subscription",
      supportsFork: true,
    })),
  },
}));

import { TreeSerializer } from "../../../src/tree/serializer.js";
import { costAction } from "../../../src/commands/cost.js";

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

describe("costAction", () => {
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
    await costAction();
    expect(logSpy).toHaveBeenCalledWith("No active exploration found.");
  });

  it("should print cost and token header", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    tree.createRoot();
    mockLoadLatest.mockResolvedValue(tree);

    await costAction();

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Cost");
    expect(allOutput).toContain("Token");
  });

  it("should show per-node cost and token rows", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    const root = tree.createRoot();
    root.setCost({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.0150,
    });

    const child = tree.addChild(root.id, makeAnswer("Option A"));
    child.setCost({
      inputTokens: 2000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.0300,
    });

    mockLoadLatest.mockResolvedValue(tree);

    await costAction();

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Should show ROOT and child labels
    expect(allOutput).toContain("ROOT");
    expect(allOutput).toContain("Option A");
    // Should show token columns
    expect(allOutput).toContain("1.0k");
    expect(allOutput).toContain("2.0k");
  });

  it("should show $0.00 for nodes with zero cost", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    tree.createRoot();
    mockLoadLatest.mockResolvedValue(tree);

    await costAction();

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("$0.00");
  });

  it("should show node status in the table", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    const root = tree.createRoot();
    root.setCompleted(["file.ts"], "+1/-0");

    const child = tree.addChild(root.id, makeAnswer("OptionA"));
    child.setStatus("running");

    mockLoadLatest.mockResolvedValue(tree);

    await costAction();

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("completed");
    expect(allOutput).toContain("running");
  });

  it("should show table header with column labels", async () => {
    const tree = new DecisionTree("Build a widget", makeConfig());
    tree.createRoot();
    mockLoadLatest.mockResolvedValue(tree);

    await costAction();

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Node");
    expect(allOutput).toContain("Label");
    expect(allOutput).toContain("Status");
    expect(allOutput).toContain("Cost");
    expect(allOutput).toContain("Input");
    expect(allOutput).toContain("Output");
  });
});
