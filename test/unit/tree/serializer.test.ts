import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DecisionTree } from "../../../src/tree/tree.js";
import { TreeSerializer } from "../../../src/tree/serializer.js";
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

describe("TreeSerializer", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "llmception-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("save and load", () => {
    it("should save a tree and load it back", async () => {
      const tree = new DecisionTree("Build a REST API", makeConfig());
      const root = tree.createRoot();
      tree.addChild(root.id, makeAnswer("OAuth2"));

      await TreeSerializer.save(tree, tmpDir);

      const loaded = await TreeSerializer.load(tree.getId(), tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.getId()).toBe(tree.getId());
      expect(loaded!.getTask()).toBe("Build a REST API");
      expect(loaded!.getRootNode().id).toBe(root.id);
    });

    it("should create .llmception directory if it does not exist", async () => {
      const tree = new DecisionTree("task", makeConfig());
      tree.createRoot();

      await TreeSerializer.save(tree, tmpDir);

      const files = await readdir(join(tmpDir, ".llmception"));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^tree-.*\.json$/);
    });

    it("should preserve full tree structure through save/load", async () => {
      const tree = new DecisionTree("Complex task", makeConfig());
      const root = tree.createRoot();
      root.setQuestion({
        question: "Which framework?",
        header: "Framework",
        options: [makeAnswer("Express"), makeAnswer("Fastify")],
      });
      const c1 = tree.addChild(root.id, makeAnswer("Express"));
      c1.setCompleted(["app.ts"], "+100/-0  1 file");
      c1.setCost({
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.03,
      });
      const c2 = tree.addChild(root.id, makeAnswer("Fastify"));
      c2.setFailed("Timeout");

      await TreeSerializer.save(tree, tmpDir);
      const loaded = await TreeSerializer.load(tree.getId(), tmpDir);

      expect(loaded).not.toBeNull();
      const loadedC1 = loaded!.getNode(c1.id);
      expect(loadedC1!.status).toBe("completed");
      expect(loadedC1!.filesChanged).toEqual(["app.ts"]);
      expect(loadedC1!.costUsd).toBe(0.03);

      const loadedC2 = loaded!.getNode(c2.id);
      expect(loadedC2!.status).toBe("failed");
      expect(loadedC2!.error).toBe("Timeout");
    });

    it("should overwrite existing file on re-save", async () => {
      const tree = new DecisionTree("task", makeConfig());
      tree.createRoot();

      await TreeSerializer.save(tree, tmpDir);

      // Mutate and re-save
      const root = tree.getRootNode();
      root.setStatus("running");
      await TreeSerializer.save(tree, tmpDir);

      const loaded = await TreeSerializer.load(tree.getId(), tmpDir);
      expect(loaded!.getRootNode().status).toBe("running");
    });

    it("should return null for nonexistent tree ID", async () => {
      const loaded = await TreeSerializer.load("nonexistent-id", tmpDir);
      expect(loaded).toBeNull();
    });

    it("should return null when directory does not exist", async () => {
      const loaded = await TreeSerializer.load("any-id", "/tmp/nonexistent-dir-xyz");
      expect(loaded).toBeNull();
    });
  });

  describe("loadLatest", () => {
    it("should load the most recently updated tree", async () => {
      const tree1 = new DecisionTree("First task", makeConfig());
      tree1.createRoot();
      await TreeSerializer.save(tree1, tmpDir);

      // Small delay to ensure different updatedAt
      await new Promise((r) => setTimeout(r, 10));

      const tree2 = new DecisionTree("Second task", makeConfig());
      tree2.createRoot();
      await TreeSerializer.save(tree2, tmpDir);

      const latest = await TreeSerializer.loadLatest(tmpDir);
      expect(latest).not.toBeNull();
      expect(latest!.getTask()).toBe("Second task");
    });

    it("should return null when no trees exist", async () => {
      const latest = await TreeSerializer.loadLatest(tmpDir);
      expect(latest).toBeNull();
    });

    it("should return null when directory does not exist", async () => {
      const latest = await TreeSerializer.loadLatest(
        "/tmp/nonexistent-dir-xyz-123",
      );
      expect(latest).toBeNull();
    });

    it("should handle single tree", async () => {
      const tree = new DecisionTree("Only task", makeConfig());
      tree.createRoot();
      await TreeSerializer.save(tree, tmpDir);

      const latest = await TreeSerializer.loadLatest(tmpDir);
      expect(latest).not.toBeNull();
      expect(latest!.getId()).toBe(tree.getId());
    });
  });

  describe("list", () => {
    it("should list all saved tree IDs", async () => {
      const tree1 = new DecisionTree("Task 1", makeConfig());
      tree1.createRoot();
      await TreeSerializer.save(tree1, tmpDir);

      const tree2 = new DecisionTree("Task 2", makeConfig());
      tree2.createRoot();
      await TreeSerializer.save(tree2, tmpDir);

      const ids = await TreeSerializer.list(tmpDir);
      expect(ids).toHaveLength(2);
      expect(ids).toContain(tree1.getId());
      expect(ids).toContain(tree2.getId());
    });

    it("should return empty array when no trees", async () => {
      const ids = await TreeSerializer.list(tmpDir);
      expect(ids).toEqual([]);
    });

    it("should return empty array for nonexistent directory", async () => {
      const ids = await TreeSerializer.list("/tmp/nonexistent-dir-xyz-456");
      expect(ids).toEqual([]);
    });
  });

  describe("remove", () => {
    it("should remove a saved tree", async () => {
      const tree = new DecisionTree("task", makeConfig());
      tree.createRoot();
      await TreeSerializer.save(tree, tmpDir);

      const idsBefore = await TreeSerializer.list(tmpDir);
      expect(idsBefore).toHaveLength(1);

      await TreeSerializer.remove(tree.getId(), tmpDir);

      const idsAfter = await TreeSerializer.list(tmpDir);
      expect(idsAfter).toHaveLength(0);
    });

    it("should not throw for nonexistent tree ID", async () => {
      await expect(
        TreeSerializer.remove("nonexistent", tmpDir),
      ).resolves.not.toThrow();
    });

    it("should only remove the specified tree", async () => {
      const tree1 = new DecisionTree("Task 1", makeConfig());
      tree1.createRoot();
      await TreeSerializer.save(tree1, tmpDir);

      const tree2 = new DecisionTree("Task 2", makeConfig());
      tree2.createRoot();
      await TreeSerializer.save(tree2, tmpDir);

      await TreeSerializer.remove(tree1.getId(), tmpDir);

      const ids = await TreeSerializer.list(tmpDir);
      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe(tree2.getId());

      // Verify tree2 is still loadable
      const loaded = await TreeSerializer.load(tree2.getId(), tmpDir);
      expect(loaded).not.toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle tree with many nodes", async () => {
      const tree = new DecisionTree("Wide task", makeConfig({ nodeBudget: 100 }));
      const root = tree.createRoot();
      for (let i = 0; i < 20; i++) {
        tree.addChild(root.id, makeAnswer(`Option${i}`));
      }

      await TreeSerializer.save(tree, tmpDir);
      const loaded = await TreeSerializer.load(tree.getId(), tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.getRootNode().childIds).toHaveLength(20);
    });

    it("should handle tree with deep nesting", async () => {
      const tree = new DecisionTree("Deep task", makeConfig());
      let parent = tree.createRoot();
      for (let i = 0; i < 10; i++) {
        parent.setQuestion({
          question: `Q${i}`,
          header: `Q${i}`,
          options: [makeAnswer(`A${i}`)],
        });
        parent = tree.addChild(parent.id, makeAnswer(`A${i}`));
      }

      await TreeSerializer.save(tree, tmpDir);
      const loaded = await TreeSerializer.load(tree.getId(), tmpDir);
      expect(loaded).not.toBeNull();

      // Walk from root to deepest
      let node = loaded!.getRootNode();
      let depth = 0;
      while (node.childIds.length > 0) {
        node = loaded!.getNode(node.childIds[0])!;
        depth++;
      }
      expect(depth).toBe(10);
    });

    it("should handle empty tree (no root)", async () => {
      const tree = new DecisionTree("Empty task", makeConfig());
      await TreeSerializer.save(tree, tmpDir);
      const loaded = await TreeSerializer.load(tree.getId(), tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.getLeaves()).toEqual([]);
    });
  });
});
