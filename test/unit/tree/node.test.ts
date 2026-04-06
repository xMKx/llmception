import { describe, it, expect, beforeEach } from "vitest";
import { TreeNode } from "../../../src/tree/node.js";
import type {
  TreeNodeState,
  InterceptedQuestion,
  TokenUsage,
} from "../../../src/types.js";

function makeNodeState(overrides: Partial<TreeNodeState> = {}): TreeNodeState {
  return {
    id: "node-1",
    parentId: null,
    depth: 0,
    answer: null,
    question: null,
    status: "pending",
    sessionId: null,
    commitHash: null,
    branchName: null,
    worktreePath: null,
    childIds: [],
    costUsd: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    decisionPath: [],
    createdAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    filesChanged: [],
    diffStat: null,
    ...overrides,
  };
}

describe("TreeNode", () => {
  let node: TreeNode;

  beforeEach(() => {
    node = new TreeNode(makeNodeState());
  });

  describe("constructor and getters", () => {
    it("should expose id from state", () => {
      expect(node.id).toBe("node-1");
    });

    it("should expose parentId from state", () => {
      expect(node.parentId).toBeNull();
    });

    it("should expose depth", () => {
      expect(node.depth).toBe(0);
    });

    it("should expose status", () => {
      expect(node.status).toBe("pending");
    });

    it("should expose childIds as empty array", () => {
      expect(node.childIds).toEqual([]);
    });

    it("should expose null question", () => {
      expect(node.question).toBeNull();
    });

    it("should expose null answer for root", () => {
      expect(node.answer).toBeNull();
    });

    it("should expose empty decisionPath", () => {
      expect(node.decisionPath).toEqual([]);
    });

    it("should expose zero costUsd", () => {
      expect(node.costUsd).toBe(0);
    });

    it("should expose zeroed tokenUsage", () => {
      expect(node.tokenUsage.inputTokens).toBe(0);
      expect(node.tokenUsage.outputTokens).toBe(0);
    });

    it("should expose null sessionId", () => {
      expect(node.sessionId).toBeNull();
    });

    it("should expose null commitHash", () => {
      expect(node.commitHash).toBeNull();
    });

    it("should expose null branchName", () => {
      expect(node.branchName).toBeNull();
    });

    it("should expose null worktreePath", () => {
      expect(node.worktreePath).toBeNull();
    });

    it("should expose null error", () => {
      expect(node.error).toBeNull();
    });

    it("should expose empty filesChanged", () => {
      expect(node.filesChanged).toEqual([]);
    });

    it("should expose null diffStat", () => {
      expect(node.diffStat).toBeNull();
    });

    it("should expose createdAt as a valid ISO string", () => {
      expect(new Date(node.createdAt).toISOString()).toBe(node.createdAt);
    });

    it("should expose null finishedAt", () => {
      expect(node.finishedAt).toBeNull();
    });

    it("should create node with answer from state", () => {
      const answer = {
        label: "Option A",
        description: "Use option A",
        answerText: "A",
      };
      const n = new TreeNode(
        makeNodeState({ id: "child-1", parentId: "node-1", depth: 1, answer }),
      );
      expect(n.answer).toEqual(answer);
      expect(n.parentId).toBe("node-1");
      expect(n.depth).toBe(1);
    });
  });

  describe("addChild", () => {
    it("should add a child ID", () => {
      node.addChild("child-1");
      expect(node.childIds).toContain("child-1");
    });

    it("should add multiple children", () => {
      node.addChild("child-1");
      node.addChild("child-2");
      node.addChild("child-3");
      expect(node.childIds).toEqual(["child-1", "child-2", "child-3"]);
    });

    it("should not add duplicate child IDs", () => {
      node.addChild("child-1");
      node.addChild("child-1");
      expect(node.childIds).toEqual(["child-1"]);
    });
  });

  describe("setQuestion", () => {
    it("should set the question and change status to questioned", () => {
      const question: InterceptedQuestion = {
        question: "Which auth to use?",
        header: "Auth choice",
        options: [
          {
            label: "OAuth2",
            description: "Use OAuth2",
            answerText: "Use OAuth2",
          },
        ],
      };
      node.setQuestion(question);
      expect(node.question).toEqual(question);
      expect(node.status).toBe("questioned");
    });
  });

  describe("setStatus", () => {
    it("should update status to running", () => {
      node.setStatus("running");
      expect(node.status).toBe("running");
    });

    it("should set finishedAt when completed", () => {
      node.setStatus("completed");
      expect(node.status).toBe("completed");
      expect(node.finishedAt).not.toBeNull();
    });

    it("should set finishedAt when failed", () => {
      node.setStatus("failed");
      expect(node.status).toBe("failed");
      expect(node.finishedAt).not.toBeNull();
    });

    it("should set finishedAt when pruned", () => {
      node.setStatus("pruned");
      expect(node.status).toBe("pruned");
      expect(node.finishedAt).not.toBeNull();
    });

    it("should not set finishedAt for non-terminal statuses", () => {
      node.setStatus("running");
      expect(node.finishedAt).toBeNull();
      node.setStatus("questioned");
      expect(node.finishedAt).toBeNull();
      node.setStatus("forking");
      expect(node.finishedAt).toBeNull();
    });
  });

  describe("setSessionId", () => {
    it("should set the session ID", () => {
      node.setSessionId("sess-abc");
      expect(node.sessionId).toBe("sess-abc");
    });
  });

  describe("setCommit", () => {
    it("should set the commit hash", () => {
      node.setCommit("abc123def");
      expect(node.commitHash).toBe("abc123def");
    });
  });

  describe("setWorktree", () => {
    it("should set the worktree path and branch", () => {
      node.setWorktree("/tmp/wt/branch-1", "branch-1");
      expect(node.worktreePath).toBe("/tmp/wt/branch-1");
      expect(node.branchName).toBe("branch-1");
    });
  });

  describe("setCompleted", () => {
    it("should mark as completed with file changes", () => {
      node.setCompleted(["src/a.ts", "src/b.ts"], "+100/-5  2 files");
      expect(node.status).toBe("completed");
      expect(node.filesChanged).toEqual(["src/a.ts", "src/b.ts"]);
      expect(node.diffStat).toBe("+100/-5  2 files");
      expect(node.finishedAt).not.toBeNull();
    });

    it("should handle empty file list", () => {
      node.setCompleted([], "+0/-0  0 files");
      expect(node.filesChanged).toEqual([]);
      expect(node.status).toBe("completed");
    });
  });

  describe("setFailed", () => {
    it("should mark as failed with error message", () => {
      node.setFailed("Timeout after 30s");
      expect(node.status).toBe("failed");
      expect(node.error).toBe("Timeout after 30s");
      expect(node.finishedAt).not.toBeNull();
    });
  });

  describe("setCost", () => {
    it("should set token usage and cost", () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
        costUsd: 0.015,
      };
      node.setCost(usage);
      expect(node.tokenUsage).toEqual(usage);
      expect(node.costUsd).toBe(0.015);
    });
  });

  describe("isLeaf", () => {
    it("should return true for node with no children", () => {
      expect(node.isLeaf()).toBe(true);
    });

    it("should return false after adding a child", () => {
      node.addChild("child-1");
      expect(node.isLeaf()).toBe(false);
    });
  });

  describe("isComplete", () => {
    it("should return false for pending node", () => {
      expect(node.isComplete()).toBe(false);
    });

    it("should return true for completed node", () => {
      node.setStatus("completed");
      expect(node.isComplete()).toBe(true);
    });

    it("should return false for failed node", () => {
      node.setFailed("error");
      expect(node.isComplete()).toBe(false);
    });

    it("should return false for running node", () => {
      node.setStatus("running");
      expect(node.isComplete()).toBe(false);
    });
  });

  describe("toState", () => {
    it("should return a deep copy of the state", () => {
      node.setSessionId("sess-1");
      node.addChild("child-1");
      const state = node.toState();

      // Verify values
      expect(state.id).toBe("node-1");
      expect(state.sessionId).toBe("sess-1");
      expect(state.childIds).toEqual(["child-1"]);

      // Verify it's a copy — mutations don't affect the node
      state.sessionId = "mutated";
      state.childIds.push("should-not-appear");
      expect(node.sessionId).toBe("sess-1");
      expect(node.childIds).toEqual(["child-1"]);
    });

    it("should preserve all fields", () => {
      const question: InterceptedQuestion = {
        question: "Which DB?",
        header: "DB choice",
        options: [
          {
            label: "Postgres",
            description: "Relational",
            answerText: "postgres",
          },
        ],
      };
      node.setQuestion(question);
      node.setSessionId("sess-1");
      node.setCommit("abc123");
      node.setWorktree("/tmp/wt", "branch-1");
      node.setCost({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        costUsd: 0.01,
      });

      const state = node.toState();
      expect(state.question).toEqual(question);
      expect(state.status).toBe("questioned");
      expect(state.sessionId).toBe("sess-1");
      expect(state.commitHash).toBe("abc123");
      expect(state.worktreePath).toBe("/tmp/wt");
      expect(state.branchName).toBe("branch-1");
      expect(state.costUsd).toBe(0.01);
    });
  });
});
