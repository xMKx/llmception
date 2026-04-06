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

  if (!branchName) {
    console.log("Winning node has no associated branch.");
    return;
  }

  // 3. Apply the branch
  const worktreeManager = new WorktreeManager(cwd);

  console.log(`Applying branch: ${branchName}`);
  await worktreeManager.applyBranch(branchName);

  // 4. Print success with diff stat
  const diffStat = await worktreeManager.getDiffStat(branchName);
  if (diffStat.trim()) {
    console.log(diffStat);
  }
  console.log("Changes applied successfully.");
  console.log('Run "llmception cleanup" to remove worktrees and branches.');
}
