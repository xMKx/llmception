import chalk from "chalk";
import { TreeSerializer } from "../tree/serializer.js";
import { TreeDisplay } from "../tree/display.js";

export interface StatusOpts {
  tree?: boolean;
  json?: boolean;
}

export async function statusAction(opts: StatusOpts): Promise<void> {
  const cwd = process.cwd();

  // 1. Load latest tree
  const tree = await TreeSerializer.loadLatest(cwd);

  if (!tree) {
    console.log("No active exploration found.");
    return;
  }

  // 2. JSON output
  if (opts.json) {
    console.log(JSON.stringify(tree.toState(), null, 2));
    return;
  }

  // 3. Full tree visualization
  if (opts.tree) {
    console.log(TreeDisplay.formatTree(tree));

    // Also show the next question if there is one
    const firstQ = tree.getFirstUnresolvedQuestion();
    if (firstQ) {
      console.log(TreeDisplay.formatQuestion(firstQ.node, firstQ.question, tree));
      console.log(chalk.bold('Run "llmception answer <number>" to choose.'));
    }
    return;
  }

  // 4. Status summary
  console.log(TreeDisplay.formatStatus(tree));

  // 5. Show next action
  const firstQ = tree.getFirstUnresolvedQuestion();
  if (firstQ) {
    console.log(TreeDisplay.formatQuestion(firstQ.node, firstQ.question, tree));
    console.log(chalk.bold('Run "llmception answer <number>" to choose.'));
  } else {
    const leaves = tree.getCompletedLeaves().filter((n) => n.status !== "pruned");
    if (leaves.length === 1) {
      console.log("");
      console.log(chalk.green.bold(`Ready to apply: ${leaves[0].answer?.label ?? "root"}`));
      console.log(chalk.dim('Run "llmception apply" to apply changes to your working tree.'));
    } else if (leaves.length > 1) {
      console.log("");
      console.log(chalk.yellow(`${leaves.length} implementations completed — no more questions to narrow down.`));
      console.log("Pick one directly:");
      for (let i = 0; i < leaves.length; i++) {
        console.log(`  [${i + 1}] ${leaves[i].answer?.label ?? "root"}`);
      }
      console.log(chalk.dim('\nRun "llmception diff <nodeId>" to compare branches.'));
    }
  }
}
