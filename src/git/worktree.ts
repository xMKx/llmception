import { join, relative } from "node:path";
import { realpath } from "node:fs/promises";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execGit } from "../util/exec.js";
import { logger } from "../util/logger.js";

const WORKTREE_DIR = ".llmception-worktrees";
const GITIGNORE_ENTRIES = [".llmception-worktrees/", ".llmception/"];

/**
 * Manages git worktrees for parallel exploration branches.
 *
 * Handles the case where the user runs llmception from a subdirectory
 * of a git repo. The worktree dir and .llmception state are placed in
 * the user's cwd, but git operations use the actual repo root.
 */
export class WorktreeManager {
  /** The directory the user ran llmception from */
  private userCwd: string;
  /** The actual git repo root (resolved lazily) */
  private gitRoot: string | null = null;

  constructor(repoRoot: string) {
    this.userCwd = repoRoot;
  }

  /** Get the actual git root (may differ from userCwd if in a subdirectory) */
  private async getGitRoot(): Promise<string> {
    if (!this.gitRoot) {
      try {
        this.gitRoot = await execGit(["rev-parse", "--show-toplevel"], this.userCwd);
      } catch {
        // Not a git repo yet — will be initialized by ensureGitignore
        this.gitRoot = this.userCwd;
      }
    }
    return this.gitRoot;
  }

  /** Get the relative path from git root to user's cwd (empty if same) */
  private async getSubdirPrefix(): Promise<string> {
    const gitRoot = await this.getGitRoot();
    const rel = relative(gitRoot, this.userCwd);
    return rel || "";
  }


  /** Return the user's cwd. */
  getRepoRoot(): string {
    return this.userCwd;
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
    const worktreePath = join(this.userCwd, WORKTREE_DIR, nodeId);
    const branchName = `llmception/${treeId}/${nodeId}`;
    const gitRoot = await this.getGitRoot();

    // Ensure the worktrees parent directory exists
    await mkdir(join(this.userCwd, WORKTREE_DIR), { recursive: true });

    const args = ["worktree", "add", "-b", branchName, worktreePath];
    if (fromCommit) {
      args.push(fromCommit);
    }

    logger.debug(`Creating worktree: ${worktreePath} on branch ${branchName}`);
    await execGit(args, gitRoot);

    return { worktreePath, branchName };
  }

  /**
   * Remove a worktree and its branch.
   */
  async remove(nodeId: string): Promise<void> {
    const worktreePath = join(this.userCwd, WORKTREE_DIR, nodeId);
    const gitRoot = await this.getGitRoot();

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
      await execGit(["worktree", "remove", "--force", worktreePath], gitRoot);
    } catch {
      logger.debug(`Git worktree remove failed for ${worktreePath}, attempting manual cleanup`);
      try {
        await rm(worktreePath, { recursive: true, force: true });
        await execGit(["worktree", "prune"], gitRoot);
      } catch {
        // Best effort
      }
    }

    // Delete the branch
    if (branchName && branchName.startsWith("llmception/")) {
      try {
        await execGit(["branch", "-D", branchName], gitRoot);
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
   * Scoped to the user's subdirectory if applicable.
   */
  async getDiff(branchName: string): Promise<string> {
    const baseBranch = await this.getBaseBranch();
    const gitRoot = await this.getGitRoot();
    const subdirPrefix = await this.getSubdirPrefix();

    const args = ["diff", `${baseBranch}...${branchName}`];
    if (subdirPrefix) {
      args.push("--", subdirPrefix);
    }
    return await execGit(args, gitRoot);
  }

  /**
   * Get the diff stat between main (or HEAD) and a branch.
   * Scoped to the user's subdirectory if applicable.
   */
  async getDiffStat(branchName: string): Promise<string> {
    const baseBranch = await this.getBaseBranch();
    const gitRoot = await this.getGitRoot();
    const subdirPrefix = await this.getSubdirPrefix();

    const args = ["diff", "--stat", `${baseBranch}...${branchName}`];
    if (subdirPrefix) {
      args.push("--", subdirPrefix);
    }
    return await execGit(args, gitRoot);
  }

  /**
   * Apply changes from a branch to the user's cwd.
   * If the user is in a subdirectory of the git repo, only changes under
   * that subdirectory are applied, with paths adjusted to be relative.
   */
  async applyBranch(branchName: string): Promise<void> {
    const baseBranch = await this.getBaseBranch();
    const gitRoot = await this.getGitRoot();
    const subdirPrefix = await this.getSubdirPrefix();

    const { execCommand } = await import("../util/exec.js");

    // Get diff, optionally scoped to the subdirectory
    const diffArgs = ["diff", `${baseBranch}...${branchName}`];
    if (subdirPrefix) {
      diffArgs.push("--", subdirPrefix);
    }

    const diffResult = await execCommand("git", diffArgs, { cwd: gitRoot });
    let diff = diffResult.stdout;

    if (!diff.trim()) {
      logger.info(`No changes to apply from branch ${branchName}`);
      return;
    }

    // If in a subdirectory, strip the prefix from paths so apply works in cwd
    if (subdirPrefix) {
      const prefixWithSlash = subdirPrefix + "/";
      diff = diff
        .replace(new RegExp(`a/${prefixWithSlash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, "g"), "a/")
        .replace(new RegExp(`b/${prefixWithSlash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, "g"), "b/");
    }

    const applyCwd = subdirPrefix ? this.userCwd : gitRoot;
    const result = await execCommand("git", ["apply", "--3way"], {
      cwd: applyCwd,
      input: diff,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to apply branch ${branchName}: ${result.stderr}`);
    }
  }

  /**
   * Ensure the directory is a git repo and .llmception paths are in .gitignore.
   * If not a git repo, initializes one with an initial commit.
   */
  async ensureGitignore(): Promise<void> {
    // Ensure it's a git repo (needed for worktrees)
    try {
      await execGit(["rev-parse", "--git-dir"], this.userCwd);
    } catch {
      logger.info("Not a git repository. Initializing one for worktree support...");
      await execGit(["init"], this.userCwd);
    }

    const gitignorePath = join(this.userCwd, ".gitignore");
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

    // Ensure at least one commit exists (worktrees require a commit)
    try {
      await execGit(["rev-parse", "HEAD"], this.userCwd);
    } catch {
      logger.info("No commits found. Creating initial commit for worktree support...");
      await execGit(["add", ".gitignore"], this.userCwd);
      await execGit(["commit", "-m", "Initial commit (llmception)"], this.userCwd);
    }
  }

  /**
   * List all llmception worktree paths.
   */
  async list(): Promise<string[]> {
    const gitRoot = await this.getGitRoot();
    const output = await execGit(["worktree", "list", "--porcelain"], gitRoot);
    if (!output.trim()) return [];

    const paths: string[] = [];
    const resolvedCwd = await realpath(this.userCwd);
    const wtDir = join(resolvedCwd, WORKTREE_DIR);

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
    const gitRoot = await this.getGitRoot();
    try {
      await execGit(["rev-parse", "--verify", "main"], gitRoot);
      return "main";
    } catch {
      try {
        await execGit(["rev-parse", "--verify", "master"], gitRoot);
        return "master";
      } catch {
        return "HEAD";
      }
    }
  }
}
