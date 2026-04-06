import { describe, it, expect, beforeEach } from "vitest";
import { DecisionTree } from "../../../src/tree/tree.js";
import { TreePruner } from "../../../src/tree/pruner.js";
import type { LlmceptionConfig, AnswerOption } from "../../../src/types.js";

function makeConfig(overrides: Partial<LlmceptionConfig> = {}): LlmceptionConfig {
  return {
    provider: "claude-cli",
    maxDepth: 5,
    maxWidth: 3,
    nodeBudget: 50,
    concurrency: 2,
    budget: { perBranchUsd: 1.0, totalUsd: 10.0, mode: "hard" },
    branchTimeoutMs: 60000,
    model: "claude-sonnet-4-20250514",
    permissionMode: "auto",
    claudeCodePath: "/usr/local/bin/claude",
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

describe("TreePruner", () => {
  let tree: DecisionTree;
  let pruner: TreePruner;

  beforeEach(() => {
    tree = new DecisionTree("Build something", makeConfig());
    pruner = new TreePruner(tree);
  });

  describe("pruneSubtree", () => {
    it("should prune a single leaf node", () => {
      const root = tree.createRoot();
      const child = tree.addChild(root.id, makeAnswer("A"));
      const pruned = pruner.pruneSubtree(child.id);
      expect(pruned).toEqual([child.id]);
      expect(child.status).toBe("pruned");
    });

    it("should prune a node and all its descendants", () => {
      const root = tree.createRoot();
      root.setStatus("completed");
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      const gc1 = tree.addChild(c1.id, makeAnswer("B"));
      const gc2 = tree.addChild(c1.id, makeAnswer("C"));
      const ggc1 = tree.addChild(gc1.id, makeAnswer("D"));

      const pruned = pruner.pruneSubtree(c1.id);
      expect(pruned).toHaveLength(4);
      expect(pruned).toContain(c1.id);
      expect(pruned).toContain(gc1.id);
      expect(pruned).toContain(gc2.id);
      expect(pruned).toContain(ggc1.id);

      expect(c1.status).toBe("pruned");
      expect(gc1.status).toBe("pruned");
      expect(gc2.status).toBe("pruned");
      expect(ggc1.status).toBe("pruned");
    });

    it("should not re-prune already pruned nodes", () => {
      const root = tree.createRoot();
      const child = tree.addChild(root.id, makeAnswer("A"));
      child.setStatus("pruned");
      const pruned = pruner.pruneSubtree(child.id);
      expect(pruned).toEqual([]);
    });

    it("should not change completed nodes but still recurse", () => {
      const root = tree.createRoot();
      root.setStatus("completed");
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      c1.setCompleted(["f.ts"], "+1/-0");
      const gc1 = tree.addChild(c1.id, makeAnswer("B"));
      // gc1 is pending

      const pruned = pruner.pruneSubtree(c1.id);
      // c1 is completed so not pruned, but gc1 is pending so it gets pruned
      expect(pruned).toEqual([gc1.id]);
      expect(c1.status).toBe("completed");
      expect(gc1.status).toBe("pruned");
    });

    it("should not change failed nodes but still recurse", () => {
      const root = tree.createRoot();
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      c1.setFailed("timeout");
      const gc1 = tree.addChild(c1.id, makeAnswer("B"));

      const pruned = pruner.pruneSubtree(c1.id);
      expect(pruned).toEqual([gc1.id]);
      expect(c1.status).toBe("failed");
    });

    it("should return empty array for nonexistent node", () => {
      expect(pruner.pruneSubtree("nonexistent")).toEqual([]);
    });

    it("should handle deep subtree pruning cascade", () => {
      const root = tree.createRoot();
      root.setStatus("completed");
      let parent = root;
      const chain: string[] = [];
      for (let i = 0; i < 10; i++) {
        const child = tree.addChild(parent.id, makeAnswer(`L${i}`));
        chain.push(child.id);
        parent = child;
      }

      const pruned = pruner.pruneSubtree(chain[0]);
      expect(pruned).toHaveLength(10);
      for (const id of chain) {
        expect(tree.getNode(id)?.status).toBe("pruned");
      }
    });

    it("should prune running nodes", () => {
      const root = tree.createRoot();
      const child = tree.addChild(root.id, makeAnswer("A"));
      child.setStatus("running");
      const pruned = pruner.pruneSubtree(child.id);
      expect(pruned).toEqual([child.id]);
      expect(child.status).toBe("pruned");
    });

    it("should prune questioned nodes", () => {
      const root = tree.createRoot();
      const child = tree.addChild(root.id, makeAnswer("A"));
      child.setQuestion({
        question: "Which DB?",
        header: "DB",
        options: [makeAnswer("Postgres")],
      });
      const pruned = pruner.pruneSubtree(child.id);
      expect(pruned).toEqual([child.id]);
      expect(child.status).toBe("pruned");
    });
  });

  describe("pruneByAnswer", () => {
    it("should prune all siblings except the chosen child", () => {
      const root = tree.createRoot();
      root.setQuestion({
        question: "Which auth?",
        header: "Auth",
        options: [makeAnswer("OAuth2"), makeAnswer("JWT"), makeAnswer("Basic")],
      });
      const c1 = tree.addChild(root.id, makeAnswer("OAuth2"));
      const c2 = tree.addChild(root.id, makeAnswer("JWT"));
      const c3 = tree.addChild(root.id, makeAnswer("Basic"));

      const pruned = pruner.pruneByAnswer(root.id, c1.id);
      expect(pruned).toHaveLength(2);
      expect(pruned).toContain(c2.id);
      expect(pruned).toContain(c3.id);

      expect(c1.status).toBe("pending");
      expect(c2.status).toBe("pruned");
      expect(c3.status).toBe("pruned");
    });

    it("should prune sibling subtrees recursively", () => {
      const root = tree.createRoot();
      root.setQuestion({
        question: "Q?",
        header: "Q",
        options: [makeAnswer("A"), makeAnswer("B")],
      });
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      const c2 = tree.addChild(root.id, makeAnswer("B"));
      const gc2a = tree.addChild(c2.id, makeAnswer("B1"));
      const gc2b = tree.addChild(c2.id, makeAnswer("B2"));

      const pruned = pruner.pruneByAnswer(root.id, c1.id);
      expect(pruned).toHaveLength(3); // c2, gc2a, gc2b
      expect(pruned).toContain(c2.id);
      expect(pruned).toContain(gc2a.id);
      expect(pruned).toContain(gc2b.id);
    });

    it("should throw for nonexistent question node", () => {
      expect(() => pruner.pruneByAnswer("nonexistent", "child")).toThrow(
        "Node nonexistent not found",
      );
    });

    it("should return empty array when only one child exists", () => {
      const root = tree.createRoot();
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      const pruned = pruner.pruneByAnswer(root.id, c1.id);
      expect(pruned).toEqual([]);
    });

    it("should handle choosing a child that does not exist among children gracefully", () => {
      const root = tree.createRoot();
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      const c2 = tree.addChild(root.id, makeAnswer("B"));

      // Choosing a nonexistent child prunes ALL children
      const pruned = pruner.pruneByAnswer(root.id, "nonexistent-child");
      expect(pruned).toHaveLength(2);
      expect(pruned).toContain(c1.id);
      expect(pruned).toContain(c2.id);
    });
  });

  describe("pruneByBudget", () => {
    it("should return empty array when budget mode is none", () => {
      const noBudgetConfig = makeConfig({
        budget: { perBranchUsd: 1.0, totalUsd: 10.0, mode: "none" },
      });
      const noBudgetTree = new DecisionTree("task", noBudgetConfig);
      const noBudgetPruner = new TreePruner(noBudgetTree);
      noBudgetTree.createRoot();
      const pruned = noBudgetPruner.pruneByBudget();
      expect(pruned).toEqual([]);
    });

    it("should prune pending leaves whose branch cost exceeds per-branch budget", () => {
      const tightConfig = makeConfig({
        budget: { perBranchUsd: 0.05, totalUsd: 10.0, mode: "hard" },
      });
      const tightTree = new DecisionTree("task", tightConfig);
      const tightPruner = new TreePruner(tightTree);

      const root = tightTree.createRoot();
      root.setStatus("completed");
      root.setCost({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.04,
      });

      const c1 = tightTree.addChild(root.id, makeAnswer("A"));
      c1.setCost({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.02,
      });
      // Branch cost: 0.04 + 0.02 = 0.06 > 0.05

      const pruned = tightPruner.pruneByBudget();
      expect(pruned).toContain(c1.id);
      expect(c1.status).toBe("pruned");
    });

    it("should prune all pending leaves when total cost exceeds budget", () => {
      const tightConfig = makeConfig({
        budget: { perBranchUsd: 100.0, totalUsd: 0.01, mode: "hard" },
      });
      const tightTree = new DecisionTree("task", tightConfig);
      const tightPruner = new TreePruner(tightTree);

      const root = tightTree.createRoot();
      root.setStatus("completed");
      root.setCost({
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.02,
      });

      const c1 = tightTree.addChild(root.id, makeAnswer("A"));
      const c2 = tightTree.addChild(root.id, makeAnswer("B"));

      const pruned = tightPruner.pruneByBudget();
      expect(pruned).toContain(c1.id);
      expect(pruned).toContain(c2.id);
    });

    it("should not prune completed or running leaves", () => {
      const tightConfig = makeConfig({
        budget: { perBranchUsd: 100.0, totalUsd: 0.001, mode: "hard" },
      });
      const tightTree = new DecisionTree("task", tightConfig);
      const tightPruner = new TreePruner(tightTree);

      const root = tightTree.createRoot();
      root.setStatus("completed");
      root.setCost({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.01,
      });

      const c1 = tightTree.addChild(root.id, makeAnswer("A"));
      c1.setCompleted(["f.ts"], "+1/-0");
      const c2 = tightTree.addChild(root.id, makeAnswer("B"));
      c2.setStatus("running");
      const c3 = tightTree.addChild(root.id, makeAnswer("C"));

      const pruned = tightPruner.pruneByBudget();
      // Only c3 (pending) should be pruned
      expect(pruned).toContain(c3.id);
      expect(c1.status).toBe("completed");
      expect(c2.status).toBe("running");
    });

    it("should handle tree with no pending leaves", () => {
      const root = tree.createRoot();
      root.setCompleted(["f.ts"], "");
      const pruned = pruner.pruneByBudget();
      expect(pruned).toEqual([]);
    });
  });
});
