import chalk from "chalk";
import { TreeSerializer } from "../tree/serializer.js";
import { WorktreeManager } from "../git/worktree.js";

export async function applyAction(): Promise<void> {
  const cwd = process.cwd();

  // 1. Load latest tree
  const tree = await TreeSerializer.loadLatest(cwd);
  if (!tree) {
    console.log("No active exploration found.");
    return;
  }

  // 2. Find the single winning leaf
  const completedLeaves = tree.getCompletedLeaves().filter(
    (n) => n.status !== "pruned",
  );

  if (completedLeaves.length === 0) {
    console.log("No completed implementations found.");
    return;
  }

  if (completedLeaves.length > 1) {
    console.log("Multiple implementations remain. Answer more questions first.");
    console.log("Remaining branches:");
    for (const leaf of completedLeaves) {
      console.log(`  ${leaf.id} - ${leaf.answer?.label ?? "root"}`);
    }
    return;
  }

  const winner = completedLeaves[0];
  const branchName = winner.branchName;
  const worktreePath = winner.worktreePath;

  if (!branchName) {
    // Root node without a branch — changes are already in cwd (or were never made)
    if (worktreePath) {
      console.log(chalk.yellow(`Changes are in worktree: ${worktreePath}`));
      console.log(chalk.dim("Copy the files you need from that directory."));
    } else {
      console.log(chalk.yellow("Winning node has no associated branch or worktree."));
      console.log(chalk.dim("This may happen if the directory was not a git repository when exploration started."));
      console.log(chalk.dim("If Claude Code wrote files, they should be in the current directory."));
    }
    return;
  }

  // 3. Apply the branch
  const worktreeManager = new WorktreeManager(cwd);

  console.log(`Applying branch: ${branchName}`);
  try {
    await worktreeManager.applyBranch(branchName);

    // 4. Print success with diff stat
    const diffStat = await worktreeManager.getDiffStat(branchName);
    if (diffStat.trim()) {
      console.log(diffStat);
    }
    console.log(chalk.green("Changes applied successfully."));
    console.log(chalk.dim('Run "llmception cleanup" to remove worktrees and branches.'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Failed to apply branch: ${msg}`));
    if (worktreePath) {
      console.log("");
      console.log(chalk.dim(`You can manually inspect the changes in: ${worktreePath}`));
    }
    process.exitCode = 1;
  }
}
