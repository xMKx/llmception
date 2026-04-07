import chalk from "chalk";
import { TreeSerializer } from "../tree/serializer.js";
import { TreeDisplay } from "../tree/display.js";
import { TreePruner } from "../tree/pruner.js";

export async function answerAction(option: string): Promise<void> {
  const cwd = process.cwd();

  // 1. Load latest tree
  const tree = await TreeSerializer.loadLatest(cwd);
  if (!tree) {
    console.log("No active exploration found.");
    return;
  }

  // 2. Get first unresolved question
  const firstQ = tree.getFirstUnresolvedQuestion();
  if (!firstQ) {
    // Check if there are completed leaves to show helpful guidance
    const leaves = tree.getCompletedLeaves().filter((n) => n.status !== "pruned");
    if (leaves.length === 1) {
      console.log(chalk.green("Already resolved to a single implementation."));
      console.log(chalk.dim('Run "llmception apply" to apply changes.'));
    } else if (leaves.length > 1) {
      console.log(`${leaves.length} implementations exist but no questions to answer.`);
      console.log("Completed branches:");
      for (let i = 0; i < leaves.length; i++) {
        console.log(`  [${i + 1}] ${leaves[i].answer?.label ?? "root"} (${leaves[i].id.slice(0, 8)})`);
      }
      console.log(chalk.dim('\nRun "llmception diff <nodeId>" to compare, or "llmception status --tree" to view.'));
    } else {
      console.log("No questions to answer and no completed implementations.");
    }
    return;
  }

  const options = firstQ.question.options;

  // 3. If no option given or invalid, show the question
  let chosenIndex = -1;
  const asNum = parseInt(option, 10);

  if (!Number.isNaN(asNum) && asNum >= 1 && asNum <= options.length) {
    chosenIndex = asNum - 1;
  } else {
    // Try case-insensitive substring match on labels
    const lower = option.toLowerCase();
    chosenIndex = options.findIndex((o) => o.label.toLowerCase().includes(lower));
  }

  if (chosenIndex === -1) {
    console.log(chalk.yellow(`Could not match "${option}" to any option.`));
    console.log("");
    console.log(TreeDisplay.formatQuestion(firstQ.node, firstQ.question, tree));
    console.log(chalk.bold('Run "llmception answer <number>" to choose.'));
    return;
  }

  // 4. Find the child node for this option
  const childIds = firstQ.node.childIds;
  // Match child by option label (children may not be in same order as options)
  const chosenLabel = options[chosenIndex].label;
  const chosenChildId = childIds.find((cid) => {
    const child = tree.getNode(cid);
    return child && child.answer?.label === chosenLabel;
  });

  if (!chosenChildId) {
    // Fallback: match by index if labels don't align
    if (chosenIndex < childIds.length) {
      const fallbackId = childIds[chosenIndex];
      const pruner = new TreePruner(tree);
      const pruned = pruner.pruneByAnswer(firstQ.node.id, fallbackId);
      const fallbackNode = tree.getNode(fallbackId);
      console.log(chalk.green(`Chose: "${fallbackNode?.answer?.label ?? option}"`));
      console.log(chalk.dim(`Pruned ${pruned.length} node(s).`));
    } else {
      console.error(chalk.red(`Option ${option} does not have a corresponding branch.`));
      process.exitCode = 1;
      return;
    }
  } else {
    // 5. Prune siblings
    const pruner = new TreePruner(tree);
    const pruned = pruner.pruneByAnswer(firstQ.node.id, chosenChildId);
    console.log(chalk.green(`Chose: "${chosenLabel}"`));
    console.log(chalk.dim(`Pruned ${pruned.length} node(s).`));
  }

  // 6. Save updated tree
  await TreeSerializer.save(tree, cwd);

  // 7. Check for next question or resolution
  const nextQ = tree.getFirstUnresolvedQuestion();
  if (nextQ) {
    console.log(TreeDisplay.formatQuestion(nextQ.node, nextQ.question, tree));
    console.log(chalk.bold('Run "llmception answer <number>" to choose.'));
    return;
  }

  // 8. Check if resolved to single implementation
  const completedLeaves = tree.getCompletedLeaves().filter(
    (n) => n.status !== "pruned",
  );

  if (completedLeaves.length === 1) {
    const winner = completedLeaves[0];
    console.log("");
    console.log(chalk.green.bold(`Resolved: ${winner.answer?.label ?? "root"}`));
    console.log(chalk.dim('Run "llmception apply" to apply changes to your working tree.'));
  } else if (completedLeaves.length === 0) {
    console.log("No completed implementations remaining.");
  } else {
    console.log(`${completedLeaves.length} implementations remain.`);
  }
}
