import { execGit } from "../util/exec.js";

/**
 * Git snapshot operations for capturing worktree state at decision points.
 */
export class Snapshot {
  /**
   * Stage all changes and commit in the given worktree.
   * Returns the commit hash. If nothing to commit, returns current HEAD.
   */
  static async take(worktreePath: string, message: string): Promise<string> {
    // Stage all changes including untracked files
    await execGit(["add", "-A"], worktreePath);

    // Check if there are staged changes
    try {
      await execGit(["diff", "--cached", "--quiet"], worktreePath);
      // No changes staged — return current HEAD
    } catch {
      // There are staged changes — commit them
      await execGit(["commit", "-m", message], worktreePath);
    }

    return Snapshot.getCurrentHead(worktreePath);
  }

  /**
   * Return the current HEAD commit hash for the given directory.
   */
  static async getCurrentHead(cwd: string): Promise<string> {
    return execGit(["rev-parse", "HEAD"], cwd);
  }
}
