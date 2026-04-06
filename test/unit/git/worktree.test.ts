import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { WorktreeManager } from "../../../src/git/worktree.js";

const execFileAsync = promisify(execFileCb);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trimEnd();
}

async function createTestRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "llmception-wt-test-"));
  // Resolve symlinks (macOS /tmp -> /private/tmp) so paths match git output
  const resolved = await realpath(dir);
  await git(["init", "-b", "main"], resolved);
  await git(["config", "user.email", "test@test.com"], resolved);
  await git(["config", "user.name", "Test"], resolved);
  // Create an initial commit so we have a HEAD
  await writeFile(join(resolved, "README.md"), "# Test\n");
  await git(["add", "-A"], resolved);
  await git(["commit", "-m", "Initial commit"], resolved);
  return resolved;
}

describe("WorktreeManager", () => {
  let repoDir: string;
  let manager: WorktreeManager;

  beforeEach(async () => {
    repoDir = await createTestRepo();
    manager = new WorktreeManager(repoDir);
  });

  afterEach(async () => {
    // Clean up all worktrees before removing the directory
    try {
      const worktrees = await manager.list();
      for (const wt of worktrees) {
        try {
          await git(["worktree", "remove", "--force", wt], repoDir);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch {
      // Ignore
    }
    await rm(repoDir, { recursive: true, force: true });
  });

  describe("getRepoRoot", () => {
    it("should return the repo root path", () => {
      expect(manager.getRepoRoot()).toBe(repoDir);
    });
  });

  describe("create and remove lifecycle", () => {
    it("should create a worktree at the expected path", async () => {
      const { worktreePath, branchName } = await manager.create("node-1", "tree-a");
      expect(worktreePath).toBe(join(repoDir, ".llmception-worktrees", "node-1"));
      expect(branchName).toBe("llmception/tree-a/node-1");

      // Verify the worktree exists by checking git status in it
      const status = await git(["status", "--porcelain"], worktreePath);
      expect(status).toBeDefined();
    });

    it("should create a worktree from a specific commit", async () => {
      // Get the current HEAD commit
      const headCommit = await git(["rev-parse", "HEAD"], repoDir);

      // Make another commit on main
      await writeFile(join(repoDir, "extra.txt"), "extra");
      await git(["add", "-A"], repoDir);
      await git(["commit", "-m", "Extra commit"], repoDir);

      // Create worktree from the first commit
      const { worktreePath } = await manager.create("node-2", "tree-b", headCommit);
      const wtHead = await git(["rev-parse", "HEAD"], worktreePath);
      expect(wtHead).toBe(headCommit);
    });

    it("should remove a worktree and its branch", async () => {
      const { branchName } = await manager.create("node-del", "tree-c");

      // Verify branch exists
      const branches = await git(["branch"], repoDir);
      expect(branches).toContain("llmception/tree-c/node-del");

      await manager.remove("node-del");

      // Verify worktree is gone
      const list = await manager.list();
      expect(list).not.toContain(join(repoDir, ".llmception-worktrees", "node-del"));

      // Verify branch is gone
      const branchesAfter = await git(["branch"], repoDir);
      expect(branchesAfter).not.toContain(branchName);
    });
  });

  describe("list", () => {
    it("should return an empty array when no worktrees exist", async () => {
      const list = await manager.list();
      expect(list).toEqual([]);
    });

    it("should list created worktrees", async () => {
      await manager.create("node-a", "tree-x");
      await manager.create("node-b", "tree-x");

      const list = await manager.list();
      expect(list).toHaveLength(2);
      expect(list).toContain(join(repoDir, ".llmception-worktrees", "node-a"));
      expect(list).toContain(join(repoDir, ".llmception-worktrees", "node-b"));
    });
  });

  describe("removeAll", () => {
    it("should remove all worktrees matching a tree ID", async () => {
      await manager.create("node-1", "tree-rm");
      await manager.create("node-2", "tree-rm");
      await manager.create("node-3", "tree-keep");

      await manager.removeAll("tree-rm");

      const list = await manager.list();
      // Only the tree-keep worktree should remain
      expect(list).toHaveLength(1);
      expect(list[0]).toContain("node-3");
    });
  });

  describe("snapshot", () => {
    it("should commit changes and return a commit hash", async () => {
      const { worktreePath } = await manager.create("node-snap", "tree-s");
      await writeFile(join(worktreePath, "new-file.txt"), "hello\n");

      const hash = await manager.snapshot(worktreePath, "snapshot test");
      expect(hash).toMatch(/^[0-9a-f]{40}$/);

      // Verify the commit message
      const log = await git(["log", "-1", "--format=%s"], worktreePath);
      expect(log).toBe("snapshot test");
    });

    it("should return current HEAD when nothing to commit", async () => {
      const { worktreePath } = await manager.create("node-snap2", "tree-s2");
      const headBefore = await git(["rev-parse", "HEAD"], worktreePath);

      const hash = await manager.snapshot(worktreePath, "no changes");
      expect(hash).toBe(headBefore);
    });
  });

  describe("getDiff and getDiffStat", () => {
    it("should return the diff between main and a branch", async () => {
      const { worktreePath, branchName } = await manager.create("node-diff", "tree-d");
      await writeFile(join(worktreePath, "diff-file.txt"), "line 1\n");
      await manager.snapshot(worktreePath, "add diff-file");

      const diff = await manager.getDiff(branchName);
      expect(diff).toContain("diff-file.txt");
      expect(diff).toContain("line 1");
    });

    it("should return stat summary for the diff", async () => {
      const { worktreePath, branchName } = await manager.create("node-stat", "tree-st");
      await writeFile(join(worktreePath, "stat-file.txt"), "content\n");
      await manager.snapshot(worktreePath, "add stat-file");

      const stat = await manager.getDiffStat(branchName);
      expect(stat).toContain("stat-file.txt");
      expect(stat).toMatch(/\d+ insertion/);
    });

    it("should return empty diff when no changes", async () => {
      const { branchName } = await manager.create("node-nodiff", "tree-nd");
      const diff = await manager.getDiff(branchName);
      expect(diff).toBe("");
    });
  });

  describe("applyBranch", () => {
    it("should apply changes from a branch to the main worktree", async () => {
      const { worktreePath, branchName } = await manager.create("node-apply", "tree-ap");
      await writeFile(join(worktreePath, "applied.txt"), "applied content\n");
      await manager.snapshot(worktreePath, "add applied.txt");

      await manager.applyBranch(branchName);

      // Verify the file now exists in the main worktree
      const content = await readFile(join(repoDir, "applied.txt"), "utf-8");
      expect(content).toBe("applied content\n");
    });

    it("should be a no-op when there is no diff", async () => {
      const { branchName } = await manager.create("node-noapply", "tree-na");
      // Should not throw
      await manager.applyBranch(branchName);
    });
  });

  describe("ensureGitignore", () => {
    it("should create .gitignore with entries if it does not exist", async () => {
      // Remove any existing .gitignore
      try {
        await rm(join(repoDir, ".gitignore"), { force: true });
      } catch {
        // May not exist
      }

      await manager.ensureGitignore();

      const content = await readFile(join(repoDir, ".gitignore"), "utf-8");
      expect(content).toContain(".llmception-worktrees/");
      expect(content).toContain(".llmception/");
    });

    it("should not duplicate entries if already present", async () => {
      await manager.ensureGitignore();
      await manager.ensureGitignore();

      const content = await readFile(join(repoDir, ".gitignore"), "utf-8");
      const worktreeMatches = content.split(".llmception-worktrees/").length - 1;
      expect(worktreeMatches).toBe(1);
    });

    it("should append to an existing .gitignore", async () => {
      await writeFile(join(repoDir, ".gitignore"), "node_modules/\n");
      await manager.ensureGitignore();

      const content = await readFile(join(repoDir, ".gitignore"), "utf-8");
      expect(content).toContain("node_modules/");
      expect(content).toContain(".llmception-worktrees/");
      expect(content).toContain(".llmception/");
    });
  });
});
