import { rm } from "node:fs/promises";
import { join } from "node:path";
import { TreeSerializer } from "../tree/serializer.js";
import { WorktreeManager } from "../git/worktree.js";

export async function cleanupAction(): Promise<void> {
  const cwd = process.cwd();

  // 1. Load latest tree
  const tree = await TreeSerializer.loadLatest(cwd);

  if (tree) {
    // 2. Remove all worktrees and branches for this tree
    const worktreeManager = new WorktreeManager(cwd);
    console.log(`Removing worktrees for tree ${tree.getId()}...`);
    await worktreeManager.removeAll(tree.getId());
  }

  // 3. Remove .llmception/ state directory
  const stateDir = join(cwd, ".llmception");
  try {
    await rm(stateDir, { recursive: true, force: true });
    console.log("Removed .llmception/ state directory.");
  } catch {
    // Directory may not exist
  }

  console.log("Cleanup complete.");
}
