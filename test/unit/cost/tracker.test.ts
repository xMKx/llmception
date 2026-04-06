import { describe, it, expect, beforeEach } from "vitest";
import { CostTracker, BudgetExceededError } from "../../../src/cost/tracker.js";
import type { LlmceptionConfig, TokenUsage } from "../../../src/types.js";

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

function makeUsage(costUsd: number): TokenUsage {
  return {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd,
  };
}

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker(makeConfig());
  });

  describe("record and getNodeCost", () => {
    it("should track cost for a single node", () => {
      tracker.record("node-1", makeUsage(1.5));
      expect(tracker.getNodeCost("node-1")).toBe(1.5);
    });

    it("should accumulate costs for the same node", () => {
      tracker.record("node-1", makeUsage(1.0));
      tracker.record("node-1", makeUsage(0.5));
      expect(tracker.getNodeCost("node-1")).toBeCloseTo(1.5, 10);
    });

    it("should return 0 for an unknown node", () => {
      expect(tracker.getNodeCost("unknown")).toBe(0);
    });

    it("should track costs independently per node", () => {
      tracker.record("node-1", makeUsage(2.0));
      tracker.record("node-2", makeUsage(3.0));
      expect(tracker.getNodeCost("node-1")).toBe(2.0);
      expect(tracker.getNodeCost("node-2")).toBe(3.0);
    });
  });

  describe("getTotalCost", () => {
    it("should return 0 with no recorded costs", () => {
      expect(tracker.getTotalCost()).toBe(0);
    });

    it("should sum all node costs", () => {
      tracker.record("node-1", makeUsage(1.0));
      tracker.record("node-2", makeUsage(2.0));
      tracker.record("node-3", makeUsage(3.0));
      expect(tracker.getTotalCost()).toBeCloseTo(6.0, 10);
    });
  });

  describe("budget mode: hard", () => {
    it("should throw BudgetExceededError when total budget is exceeded", () => {
      const config = makeConfig({ budget: { perBranchUsd: 100, totalUsd: 2.0, mode: "hard" } });
      const t = new CostTracker(config);
      t.record("node-1", makeUsage(1.5));
      expect(() => t.record("node-2", makeUsage(1.0))).toThrow(BudgetExceededError);
    });

    it("should throw BudgetExceededError when per-branch budget is exceeded", () => {
      const config = makeConfig({ budget: { perBranchUsd: 1.0, totalUsd: 100, mode: "hard" } });
      const t = new CostTracker(config);
      expect(() => t.record("node-1", makeUsage(1.5))).toThrow(BudgetExceededError);
    });

    it("should not throw when within budget", () => {
      tracker.record("node-1", makeUsage(0.5));
      expect(tracker.getNodeCost("node-1")).toBe(0.5);
    });
  });

  describe("budget mode: warn", () => {
    it("should not throw when total budget is exceeded", () => {
      const config = makeConfig({ budget: { perBranchUsd: 100, totalUsd: 1.0, mode: "warn" } });
      const t = new CostTracker(config);
      t.record("node-1", makeUsage(0.8));
      expect(() => t.record("node-2", makeUsage(0.5))).not.toThrow();
    });

    it("should not throw when per-branch budget is exceeded", () => {
      const config = makeConfig({ budget: { perBranchUsd: 1.0, totalUsd: 100, mode: "warn" } });
      const t = new CostTracker(config);
      expect(() => t.record("node-1", makeUsage(2.0))).not.toThrow();
    });
  });

  describe("budget mode: none", () => {
    it("should not throw when total budget is exceeded", () => {
      const config = makeConfig({ budget: { perBranchUsd: 100, totalUsd: 1.0, mode: "none" } });
      const t = new CostTracker(config);
      t.record("node-1", makeUsage(5.0));
      expect(() => t.record("node-2", makeUsage(5.0))).not.toThrow();
    });

    it("should still track costs", () => {
      const config = makeConfig({ budget: { perBranchUsd: 100, totalUsd: 1.0, mode: "none" } });
      const t = new CostTracker(config);
      t.record("node-1", makeUsage(5.0));
      expect(t.getTotalCost()).toBe(5.0);
    });
  });

  describe("isWithinBudget", () => {
    it("should return true when within total budget", () => {
      tracker.record("node-1", makeUsage(1.0));
      expect(tracker.isWithinBudget(2.0)).toBe(true);
    });

    it("should return false when adding amount exceeds total budget", () => {
      // Use "none" mode to avoid BudgetExceededError during recording
      const config = makeConfig({ budget: { perBranchUsd: 100, totalUsd: 25.0, mode: "none" } });
      const t = new CostTracker(config);
      t.record("node-1", makeUsage(20.0));
      expect(t.isWithinBudget(10.0)).toBe(false);
    });

    it("should default additional to 0", () => {
      expect(tracker.isWithinBudget()).toBe(true);
    });
  });

  describe("isNodeWithinBudget", () => {
    it("should return true when node is within per-branch budget", () => {
      tracker.record("node-1", makeUsage(1.0));
      expect(tracker.isNodeWithinBudget("node-1", 1.0)).toBe(true);
    });

    it("should return false when adding amount exceeds per-branch budget", () => {
      tracker.record("node-1", makeUsage(4.0));
      expect(tracker.isNodeWithinBudget("node-1", 2.0)).toBe(false);
    });

    it("should return true for unknown node with small amount", () => {
      expect(tracker.isNodeWithinBudget("unknown", 1.0)).toBe(true);
    });
  });

  describe("getSummary", () => {
    it("should return a summary with all tracked data", () => {
      tracker.record("node-1", makeUsage(2.0));
      tracker.record("node-2", makeUsage(3.0));
      const summary = tracker.getSummary();
      expect(summary.totalCostUsd).toBeCloseTo(5.0, 10);
      expect(summary.nodeCosts["node-1"]).toBe(2.0);
      expect(summary.nodeCosts["node-2"]).toBe(3.0);
      expect(summary.budgetRemaining).toBeCloseTo(20.0, 10);
    });

    it("should clamp budgetRemaining to 0", () => {
      const config = makeConfig({
        budget: { perBranchUsd: 100, totalUsd: 1.0, mode: "none" },
      });
      const t = new CostTracker(config);
      t.record("node-1", makeUsage(5.0));
      expect(t.getSummary().budgetRemaining).toBe(0);
    });

    it("should return empty summary when nothing recorded", () => {
      const summary = tracker.getSummary();
      expect(summary.totalCostUsd).toBe(0);
      expect(Object.keys(summary.nodeCosts)).toHaveLength(0);
      expect(summary.budgetRemaining).toBe(25.0);
    });
  });

  describe("reset", () => {
    it("should clear all tracked costs", () => {
      tracker.record("node-1", makeUsage(5.0));
      tracker.record("node-2", makeUsage(3.0));
      tracker.reset();
      expect(tracker.getTotalCost()).toBe(0);
      expect(tracker.getNodeCost("node-1")).toBe(0);
      expect(tracker.getNodeCost("node-2")).toBe(0);
    });

    it("should allow recording again after reset", () => {
      tracker.record("node-1", makeUsage(5.0));
      tracker.reset();
      tracker.record("node-1", makeUsage(1.0));
      expect(tracker.getNodeCost("node-1")).toBe(1.0);
    });
  });
});
