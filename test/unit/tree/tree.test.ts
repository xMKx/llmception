import { describe, it, expect, beforeEach } from "vitest";
import { DecisionTree } from "../../../src/tree/tree.js";
import type {
  LlmceptionConfig,
  AnswerOption,
  InterceptedQuestion,
} from "../../../src/types.js";

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

function makeQuestion(header: string, optionLabels: string[]): InterceptedQuestion {
  return {
    question: `Full question about ${header}`,
    header,
    options: optionLabels.map((l) => makeAnswer(l)),
  };
}

describe("DecisionTree", () => {
  let tree: DecisionTree;
  let config: LlmceptionConfig;

  beforeEach(() => {
    config = makeConfig();
    tree = new DecisionTree("Build a REST API", config);
  });

  describe("constructor", () => {
    it("should create a tree with a UUID id", () => {
      expect(tree.getId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("should store the task", () => {
      expect(tree.getTask()).toBe("Build a REST API");
    });

    it("should store the config", () => {
      expect(tree.getConfig()).toEqual(config);
    });
  });

  describe("createRoot", () => {
    it("should create a root node at depth 0", () => {
      const root = tree.createRoot();
      expect(root.depth).toBe(0);
      expect(root.parentId).toBeNull();
      expect(root.status).toBe("pending");
    });

    it("should be retrievable via getRootNode", () => {
      const root = tree.createRoot();
      expect(tree.getRootNode().id).toBe(root.id);
    });

    it("should throw if called twice", () => {
      tree.createRoot();
      expect(() => tree.createRoot()).toThrow("Root node already exists");
    });
  });

  describe("getRootNode", () => {
    it("should throw if tree has no root", () => {
      expect(() => tree.getRootNode()).toThrow("Tree has no root node");
    });
  });

  describe("addChild", () => {
    it("should create a child at depth 1", () => {
      const root = tree.createRoot();
      const answer = makeAnswer("OAuth2");
      const child = tree.addChild(root.id, answer);
      expect(child.depth).toBe(1);
      expect(child.parentId).toBe(root.id);
      expect(child.answer).toEqual(answer);
    });

    it("should add child ID to parent's childIds", () => {
      const root = tree.createRoot();
      const child = tree.addChild(root.id, makeAnswer("A"));
      expect(root.childIds).toContain(child.id);
    });

    it("should inherit decision path from parent", () => {
      const root = tree.createRoot();
      root.setQuestion(makeQuestion("Auth method", ["OAuth2", "JWT"]));
      const child = tree.addChild(root.id, makeAnswer("OAuth2"));
      expect(child.decisionPath).toEqual([
        { question: "Auth method", answer: "OAuth2" },
      ]);
    });

    it("should build up decision path through multiple levels", () => {
      const root = tree.createRoot();
      root.setQuestion(makeQuestion("Auth", ["OAuth2", "JWT"]));
      const child1 = tree.addChild(root.id, makeAnswer("OAuth2"));
      child1.setQuestion(makeQuestion("DB", ["Postgres", "MySQL"]));
      const child2 = tree.addChild(child1.id, makeAnswer("Postgres"));

      expect(child2.decisionPath).toEqual([
        { question: "Auth", answer: "OAuth2" },
        { question: "DB", answer: "Postgres" },
      ]);
    });

    it("should throw if parent not found", () => {
      expect(() => tree.addChild("nonexistent", makeAnswer("A"))).toThrow(
        "Parent node nonexistent not found",
      );
    });

    it("should not add decision step if parent has no question", () => {
      const root = tree.createRoot();
      const child = tree.addChild(root.id, makeAnswer("A"));
      expect(child.decisionPath).toEqual([]);
    });
  });

  describe("getNode", () => {
    it("should return the node if it exists", () => {
      const root = tree.createRoot();
      expect(tree.getNode(root.id)).toBe(root);
    });

    it("should return undefined for nonexistent ID", () => {
      expect(tree.getNode("nonexistent")).toBeUndefined();
    });
  });

  describe("getLeaves", () => {
    it("should return root as only leaf in fresh tree", () => {
      const root = tree.createRoot();
      const leaves = tree.getLeaves();
      expect(leaves).toHaveLength(1);
      expect(leaves[0].id).toBe(root.id);
    });

    it("should return children as leaves after branching", () => {
      const root = tree.createRoot();
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      const c2 = tree.addChild(root.id, makeAnswer("B"));
      const leaves = tree.getLeaves();
      expect(leaves).toHaveLength(2);
      const ids = leaves.map((l) => l.id);
      expect(ids).toContain(c1.id);
      expect(ids).toContain(c2.id);
    });

    it("should return empty array for empty tree", () => {
      expect(tree.getLeaves()).toEqual([]);
    });
  });

  describe("getCompletedLeaves", () => {
    it("should return only completed leaf nodes", () => {
      const root = tree.createRoot();
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      const c2 = tree.addChild(root.id, makeAnswer("B"));
      c1.setCompleted(["file.ts"], "+10/-0  1 file");
      c2.setFailed("timeout");

      const completed = tree.getCompletedLeaves();
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(c1.id);
    });

    it("should return empty array when no completed leaves", () => {
      tree.createRoot();
      expect(tree.getCompletedLeaves()).toEqual([]);
    });
  });

  describe("getNextPending", () => {
    it("should return root if pending", () => {
      const root = tree.createRoot();
      expect(tree.getNextPending()?.id).toBe(root.id);
    });

    it("should return undefined for empty tree", () => {
      expect(tree.getNextPending()).toBeUndefined();
    });

    it("should skip non-pending nodes", () => {
      const root = tree.createRoot();
      root.setStatus("running");
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      const c2 = tree.addChild(root.id, makeAnswer("B"));
      c1.setStatus("running");

      expect(tree.getNextPending()?.id).toBe(c2.id);
    });

    it("should return shallowest pending node (BFS)", () => {
      const root = tree.createRoot();
      root.setStatus("completed");
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      c1.setStatus("completed");
      const c2 = tree.addChild(root.id, makeAnswer("B"));
      // c2 is pending at depth 1
      const gc1 = tree.addChild(c1.id, makeAnswer("C"));
      // gc1 is pending at depth 2

      // BFS should find c2 (depth 1) before gc1 (depth 2)
      expect(tree.getNextPending()?.id).toBe(c2.id);
      void gc1; // avoid unused warning
    });

    it("should return undefined when all nodes are terminal", () => {
      const root = tree.createRoot();
      root.setCompleted([], "");
      expect(tree.getNextPending()).toBeUndefined();
    });
  });

  describe("getQuestionedNodes", () => {
    it("should return empty array when none questioned", () => {
      tree.createRoot();
      expect(tree.getQuestionedNodes()).toEqual([]);
    });

    it("should return nodes with questioned status", () => {
      const root = tree.createRoot();
      root.setQuestion(makeQuestion("Auth", ["OAuth2", "JWT"]));
      const questioned = tree.getQuestionedNodes();
      expect(questioned).toHaveLength(1);
      expect(questioned[0].id).toBe(root.id);
    });
  });

  describe("getFirstUnresolvedQuestion", () => {
    it("should return undefined when no questions", () => {
      tree.createRoot();
      expect(tree.getFirstUnresolvedQuestion()).toBeUndefined();
    });

    it("should return the shallowest questioned node", () => {
      const root = tree.createRoot();
      root.setStatus("completed");
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      const c2 = tree.addChild(root.id, makeAnswer("B"));
      c1.setQuestion(makeQuestion("DB", ["Postgres", "MySQL"]));
      c2.setQuestion(makeQuestion("Cache", ["Redis", "Memcached"]));

      const result = tree.getFirstUnresolvedQuestion();
      expect(result).toBeDefined();
      // Both at depth 1, should return one of them
      expect(result!.node.depth).toBe(1);
      expect(result!.question).toBeDefined();
    });

    it("should prefer shallower node", () => {
      const root = tree.createRoot();
      root.setStatus("completed");
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      c1.setStatus("completed");
      const gc1 = tree.addChild(c1.id, makeAnswer("B"));
      gc1.setQuestion(makeQuestion("Deep Q", ["X", "Y"]));
      const c2 = tree.addChild(root.id, makeAnswer("C"));
      c2.setQuestion(makeQuestion("Shallow Q", ["P", "Q"]));

      const result = tree.getFirstUnresolvedQuestion();
      expect(result!.node.depth).toBe(1);
      expect(result!.question.header).toBe("Shallow Q");
    });
  });

  describe("getStats", () => {
    it("should return zeroed stats for empty tree", () => {
      const stats = tree.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.completedNodes).toBe(0);
      expect(stats.totalCostUsd).toBe(0);
    });

    it("should count nodes by status", () => {
      const root = tree.createRoot();
      root.setStatus("completed");
      root.setCost({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.01,
      });

      const c1 = tree.addChild(root.id, makeAnswer("A"));
      c1.setStatus("running");

      const c2 = tree.addChild(root.id, makeAnswer("B"));
      c2.setFailed("error");

      const c3 = tree.addChild(root.id, makeAnswer("C"));
      c3.setStatus("pruned");

      const stats = tree.getStats();
      expect(stats.totalNodes).toBe(4);
      expect(stats.completedNodes).toBe(1);
      expect(stats.runningNodes).toBe(1);
      expect(stats.pendingNodes).toBe(0);
      expect(stats.failedNodes).toBe(1);
      expect(stats.prunedNodes).toBe(1);
      expect(stats.totalCostUsd).toBe(0.01);
      expect(stats.maxDepthReached).toBe(1);
    });

    it("should count completed leaves separately", () => {
      const root = tree.createRoot();
      root.setCompleted([], "");
      // root is completed but not a leaf after adding children
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      c1.setCompleted(["f.ts"], "+1/-0");
      tree.addChild(root.id, makeAnswer("B"));

      const stats = tree.getStats();
      expect(stats.completedLeaves).toBe(1);
    });

    it("should count questioned and forking nodes together", () => {
      const root = tree.createRoot();
      root.setQuestion(makeQuestion("Q", ["A", "B"]));
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      c1.setStatus("forking");

      const stats = tree.getStats();
      expect(stats.questionedNodes).toBe(2);
    });
  });

  describe("canGrow", () => {
    it("should return true when under budget", () => {
      tree.createRoot();
      expect(tree.canGrow()).toBe(true);
    });

    it("should return false when at node budget", () => {
      const smallConfig = makeConfig({ nodeBudget: 2 });
      const smallTree = new DecisionTree("task", smallConfig);
      const root = smallTree.createRoot();
      smallTree.addChild(root.id, makeAnswer("A"));
      expect(smallTree.canGrow()).toBe(false);
    });

    it("should count pruned nodes toward budget", () => {
      const smallConfig = makeConfig({ nodeBudget: 3 });
      const smallTree = new DecisionTree("task", smallConfig);
      const root = smallTree.createRoot();
      const c1 = smallTree.addChild(root.id, makeAnswer("A"));
      c1.setStatus("pruned");
      smallTree.addChild(root.id, makeAnswer("B"));
      // 3 nodes created (root + 2 children), budget is 3
      expect(smallTree.canGrow()).toBe(false);
    });
  });

  describe("toState / fromState", () => {
    it("should round-trip through serialization", () => {
      const root = tree.createRoot();
      root.setQuestion(makeQuestion("Auth", ["OAuth2", "JWT"]));
      const c1 = tree.addChild(root.id, makeAnswer("OAuth2"));
      c1.setCompleted(["auth.ts"], "+50/-0  1 file");
      const c2 = tree.addChild(root.id, makeAnswer("JWT"));
      c2.setStatus("running");

      const state = tree.toState();
      const restored = DecisionTree.fromState(state);

      expect(restored.getId()).toBe(tree.getId());
      expect(restored.getTask()).toBe("Build a REST API");

      const restoredRoot = restored.getRootNode();
      expect(restoredRoot.id).toBe(root.id);
      expect(restoredRoot.question?.header).toBe("Auth");
      expect(restoredRoot.childIds).toHaveLength(2);

      const restoredC1 = restored.getNode(c1.id);
      expect(restoredC1).toBeDefined();
      expect(restoredC1!.status).toBe("completed");
      expect(restoredC1!.filesChanged).toEqual(["auth.ts"]);

      const restoredC2 = restored.getNode(c2.id);
      expect(restoredC2).toBeDefined();
      expect(restoredC2!.status).toBe("running");
    });

    it("should preserve tree timestamps", () => {
      tree.createRoot();
      const state = tree.toState();
      const restored = DecisionTree.fromState(state);
      const restoredState = restored.toState();
      expect(restoredState.createdAt).toBe(state.createdAt);
      expect(restoredState.updatedAt).toBe(state.updatedAt);
    });

    it("should preserve totalNodesCreated", () => {
      const root = tree.createRoot();
      tree.addChild(root.id, makeAnswer("A"));
      tree.addChild(root.id, makeAnswer("B"));

      const state = tree.toState();
      expect(state.totalNodesCreated).toBe(3);

      const restored = DecisionTree.fromState(state);
      const restoredState = restored.toState();
      expect(restoredState.totalNodesCreated).toBe(3);
    });

    it("should produce independent nodes (deep copy)", () => {
      const root = tree.createRoot();
      const state = tree.toState();
      const restored = DecisionTree.fromState(state);

      // Mutating original should not affect restored
      root.setStatus("running");
      expect(restored.getRootNode().status).toBe("pending");
    });

    it("should handle empty tree state", () => {
      const state = tree.toState();
      expect(state.rootId).toBe("");
      expect(Object.keys(state.nodes)).toHaveLength(0);

      const restored = DecisionTree.fromState(state);
      expect(restored.getLeaves()).toEqual([]);
    });

    it("should preserve totalCostUsd in state", () => {
      const root = tree.createRoot();
      root.setCost({
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.05,
      });
      const state = tree.toState();
      expect(state.totalCostUsd).toBe(0.05);
    });

    it("should restore deep decision paths", () => {
      const root = tree.createRoot();
      root.setQuestion(makeQuestion("Q1", ["A", "B"]));
      const c1 = tree.addChild(root.id, makeAnswer("A"));
      c1.setQuestion(makeQuestion("Q2", ["C", "D"]));
      const gc1 = tree.addChild(c1.id, makeAnswer("C"));
      gc1.setQuestion(makeQuestion("Q3", ["E", "F"]));
      const ggc1 = tree.addChild(gc1.id, makeAnswer("E"));

      const state = tree.toState();
      const restored = DecisionTree.fromState(state);
      const restoredGgc = restored.getNode(ggc1.id);
      expect(restoredGgc!.decisionPath).toEqual([
        { question: "Q1", answer: "A" },
        { question: "Q2", answer: "C" },
        { question: "Q3", answer: "E" },
      ]);
    });
  });

  describe("deep tree structure", () => {
    it("should handle a tree of depth 10", () => {
      let parent = tree.createRoot();
      for (let i = 0; i < 10; i++) {
        parent.setQuestion(
          makeQuestion(`Q${i}`, [`A${i}`, `B${i}`]),
        );
        parent = tree.addChild(parent.id, makeAnswer(`A${i}`));
      }
      expect(parent.depth).toBe(10);
      expect(parent.decisionPath).toHaveLength(10);
    });
  });

  describe("wide tree structure", () => {
    it("should handle many children at one level", () => {
      const root = tree.createRoot();
      const children = [];
      for (let i = 0; i < 20; i++) {
        children.push(tree.addChild(root.id, makeAnswer(`Option${i}`)));
      }
      expect(root.childIds).toHaveLength(20);
      expect(tree.getLeaves()).toHaveLength(20);
    });
  });
});
