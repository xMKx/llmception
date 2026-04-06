import { TreeSerializer } from "../tree/serializer.js";
import { WorktreeManager } from "../git/worktree.js";

export interface DiffOpts {
  nodeId?: string;
}

export async function diffAction(opts: DiffOpts): Promise<void> {
  const cwd = process.cwd();

  // 1. Load latest tree
  const tree = await TreeSerializer.loadLatest(cwd);
  if (!tree) {
    console.log("No active exploration found.");
    return;
  }

  let branchName: string | null = null;

  if (opts.nodeId) {
    // 2a. Find the specified node
    const node = tree.getNode(opts.nodeId);
    if (!node) {
      console.error(`Node ${opts.nodeId} not found.`);
      process.exitCode = 1;
      return;
    }
    branchName = node.branchName;
  } else {
    // 2b. Find the single completed leaf (winning branch)
    const completedLeaves = tree.getCompletedLeaves().filter(
      (n) => n.status !== "pruned",
    );

    if (completedLeaves.length === 0) {
      console.log("No completed implementations found.");
      return;
    }
    if (completedLeaves.length > 1) {
      console.log(
        "Multiple implementations remain. Specify a node ID or answer more questions first.",
      );
      console.log("Completed branches:");
      for (const leaf of completedLeaves) {
        console.log(`  ${leaf.id} - ${leaf.answer?.label ?? "root"}`);
      }
      return;
    }

    branchName = completedLeaves[0].branchName;
  }

  if (!branchName) {
    console.log("No branch found for this node (it may not have been executed yet).");
    return;
  }

  // 3. Get and print diff
  const worktreeManager = new WorktreeManager(cwd);
  const diff = await worktreeManager.getDiff(branchName);

  if (!diff.trim()) {
    console.log("No changes.");
    return;
  }

  process.stdout.write(diff);
}
