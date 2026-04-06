import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execGit } from "../util/exec.js";
import { logger } from "../util/logger.js";

const WORKTREE_DIR = ".llmception-worktrees";
const GITIGNORE_ENTRIES = [".llmception-worktrees/", ".llmception/"];

/**
 * Manages git worktrees for parallel exploration branches.
 */
export class WorktreeManager {
  private repoRoot: string;
  private resolvedRoot: string | null = null;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  /** Resolve symlinks in the repo root (macOS /tmp -> /private/tmp). */
  private async getResolvedRoot(): Promise<string> {
    if (!this.resolvedRoot) {
      this.resolvedRoot = await realpath(this.repoRoot);
    }
    return this.resolvedRoot;
  }

  /** Return the repo root path. */
  getRepoRoot(): string {
    return this.repoRoot;
  }

  /**
   * Create a git worktree for a node.
   * Branch name: llmception/<treeId>/<nodeId>
   * Path: <repoRoot>/.llmception-worktrees/<nodeId>
   */
  async create(
    nodeId: string,
    treeId: string,
    fromCommit?: string,
  ): Promise<{ worktreePath: string; branchName: string }> {
    const worktreePath = join(this.repoRoot, WORKTREE_DIR, nodeId);
    const branchName = `llmception/${treeId}/${nodeId}`;

    // Ensure the worktrees parent directory exists
    await mkdir(join(this.repoRoot, WORKTREE_DIR), { recursive: true });

    const args = ["worktree", "add", "-b", branchName, worktreePath];
    if (fromCommit) {
      args.push(fromCommit);
    }

    logger.debug(`Creating worktree: ${worktreePath} on branch ${branchName}`);
    await execGit(args, this.repoRoot);

    return { worktreePath, branchName };
  }

  /**
   * Remove a worktree and its branch.
   */
  async remove(nodeId: string): Promise<void> {
    const worktreePath = join(this.repoRoot, WORKTREE_DIR, nodeId);

    // Find the branch name before removing the worktree
    let branchName: string | null = null;
    try {
      branchName = await execGit(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        worktreePath,
      );
    } catch {
      // Worktree may already be gone
    }

    // Remove the worktree
    try {
      await execGit(["worktree", "remove", "--force", worktreePath], this.repoRoot);
    } catch {
      // If git worktree remove fails, try manual cleanup
      logger.debug(`Git worktree remove failed for ${worktreePath}, attempting manual cleanup`);
      try {
        await rm(worktreePath, { recursive: true, force: true });
        await execGit(["worktree", "prune"], this.repoRoot);
      } catch {
        // Best effort
      }
    }

    // Delete the branch
    if (branchName && branchName.startsWith("llmception/")) {
      try {
        await execGit(["branch", "-D", branchName], this.repoRoot);
      } catch {
        // Branch may already be deleted
      }
    }
  }

  /**
   * Remove all worktrees matching a tree ID pattern.
   */
  async removeAll(treeId: string): Promise<void> {
    const worktrees = await this.list();
    const prefix = `llmception/${treeId}/`;

    for (const wtPath of worktrees) {
      try {
        // Get the branch for this worktree
        const branch = await execGit(
          ["rev-parse", "--abbrev-ref", "HEAD"],
          wtPath,
        );
        if (branch.startsWith(prefix)) {
          const nodeId = wtPath.split("/").pop()!;
          await this.remove(nodeId);
        }
      } catch {
        // Worktree may already be partially cleaned up
        logger.debug(`Failed to check/remove worktree at ${wtPath}`);
      }
    }
  }

  /**
   * Snapshot the worktree state: stage all changes and commit.
   * Returns the commit hash. If nothing to commit, returns current HEAD.
   */
  async snapshot(worktreePath: string, message: string): Promise<string> {
    // Stage all changes
    await execGit(["add", "-A"], worktreePath);

    // Check if there's anything to commit
    try {
      await execGit(["diff", "--cached", "--quiet"], worktreePath);
      // No changes — return current HEAD
      logger.debug(`No changes to commit in ${worktreePath}`);
    } catch {
      // There are staged changes — commit them
      await execGit(["commit", "-m", message], worktreePath);
    }

    // Return the HEAD commit hash
    return await execGit(["rev-parse", "HEAD"], worktreePath);
  }

  /**
   * Get the diff between main (or HEAD) and a branch.
   */
  async getDiff(branchName: string): Promise<string> {
    const baseBranch = await this.getBaseBranch();
    return await execGit(
      ["diff", `${baseBranch}...${branchName}`],
      this.repoRoot,
    );
  }

  /**
   * Get the diff stat between main (or HEAD) and a branch.
   */
  async getDiffStat(branchName: string): Promise<string> {
    const baseBranch = await this.getBaseBranch();
    return await execGit(
      ["diff", "--stat", `${baseBranch}...${branchName}`],
      this.repoRoot,
    );
  }

  /**
   * Apply changes from a branch to the main worktree using a patch.
   */
  async applyBranch(branchName: string): Promise<void> {
    const baseBranch = await this.getBaseBranch();

    // Use execCommand to get the raw diff (not trimmed, preserving trailing newline)
    const { execCommand } = await import("../util/exec.js");
    const diffResult = await execCommand(
      "git",
      ["diff", `${baseBranch}...${branchName}`],
      { cwd: this.repoRoot },
    );

    const diff = diffResult.stdout;
    if (!diff.trim()) {
      logger.info(`No changes to apply from branch ${branchName}`);
      return;
    }

    const result = await execCommand("git", ["apply", "--3way"], {
      cwd: this.repoRoot,
      input: diff,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to apply branch ${branchName}: ${result.stderr}`);
    }
  }

  /**
   * Ensure .llmception-worktrees/ and .llmception/ are in .gitignore.
   */
  async ensureGitignore(): Promise<void> {
    const gitignorePath = join(this.repoRoot, ".gitignore");
    let content = "";

    try {
      content = await readFile(gitignorePath, "utf-8");
    } catch {
      // File doesn't exist yet
    }

    const lines = content.split("\n");
    const toAdd: string[] = [];

    for (const entry of GITIGNORE_ENTRIES) {
      if (!lines.some((line) => line.trim() === entry)) {
        toAdd.push(entry);
      }
    }

    if (toAdd.length > 0) {
      const suffix = content.endsWith("\n") || content === "" ? "" : "\n";
      const newContent = content + suffix + toAdd.join("\n") + "\n";
      await writeFile(gitignorePath, newContent, "utf-8");
      logger.debug(`Added to .gitignore: ${toAdd.join(", ")}`);
    }
  }

  /**
   * List all llmception worktree paths.
   */
  async list(): Promise<string[]> {
    const output = await execGit(["worktree", "list", "--porcelain"], this.repoRoot);
    if (!output.trim()) return [];

    const paths: string[] = [];
    const resolvedRoot = await this.getResolvedRoot();
    const wtDir = join(resolvedRoot, WORKTREE_DIR);

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        const path = line.slice("worktree ".length);
        if (path.startsWith(wtDir)) {
          paths.push(path);
        }
      }
    }

    return paths;
  }

  /** Determine the base branch (main, master, or HEAD). */
  private async getBaseBranch(): Promise<string> {
    try {
      await execGit(["rev-parse", "--verify", "main"], this.repoRoot);
      return "main";
    } catch {
      try {
        await execGit(["rev-parse", "--verify", "master"], this.repoRoot);
        return "master";
      } catch {
        return "HEAD";
      }
    }
  }
}
