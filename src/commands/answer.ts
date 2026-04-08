import { createInterface } from "node:readline";
import chalk from "chalk";
import { TreeSerializer } from "../tree/serializer.js";
import { TreeDisplay } from "../tree/display.js";
import { TreePruner } from "../tree/pruner.js";
import type { DecisionTree } from "../tree/tree.js";
import type { InterceptedQuestion } from "../types.js";
import type { TreeNode } from "../tree/node.js";

/** Prompt the user for input on stdin */
function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Resolve an answer string (number or label) to a child index */
function resolveAnswer(
  option: string,
  questionNode: TreeNode,
  question: InterceptedQuestion,
  tree: DecisionTree,
): string | null {
  const options = question.options;
  const childIds = questionNode.childIds;

  // Try as 1-based index
  const asNum = parseInt(option, 10);
  if (!Number.isNaN(asNum) && asNum >= 1 && asNum <= options.length) {
    const chosenLabel = options[asNum - 1].label;
    return childIds.find((cid) => {
      const child = tree.getNode(cid);
      return child && child.answer?.label === chosenLabel;
    }) ?? childIds[asNum - 1] ?? null;
  }

  // Try case-insensitive substring match on labels
  const lower = option.toLowerCase();
  const matchIdx = options.findIndex((o) => o.label.toLowerCase().includes(lower));
  if (matchIdx !== -1) {
    const chosenLabel = options[matchIdx].label;
    return childIds.find((cid) => {
      const child = tree.getNode(cid);
      return child && child.answer?.label === chosenLabel;
    }) ?? childIds[matchIdx] ?? null;
  }

  return null;
}

export async function answerAction(option?: string): Promise<void> {
  const cwd = process.cwd();

  // 1. Load latest tree
  const tree = await TreeSerializer.loadLatest(cwd);
  if (!tree) {
    console.log("No active exploration found.");
    return;
  }

  // Loop: answer questions until resolved or user quits
  let currentOption = option;

  while (true) {
    // 2. Get first unresolved question
    const firstQ = tree.getFirstUnresolvedQuestion();
    if (!firstQ) {
      const leaves = tree.getCompletedLeaves().filter((n) => n.status !== "pruned");
      if (leaves.length === 1) {
        console.log(chalk.green.bold(`Resolved: ${leaves[0].answer?.label ?? "root"}`));
        console.log(chalk.dim('Run "llmception apply" to apply changes to your working tree.'));
      } else if (leaves.length > 1) {
        console.log(`${leaves.length} implementations exist but no more questions to narrow down.`);
      } else {
        console.log("No questions to answer and no completed implementations.");
      }
      break;
    }

    // 3. Show the question
    console.log(TreeDisplay.formatQuestion(firstQ.node, firstQ.question, tree));

    // 4. Get the answer (from arg or interactive)
    let answerStr: string;
    if (currentOption !== undefined) {
      answerStr = currentOption;
      currentOption = undefined; // Only use the CLI arg for the first question
    } else {
      // Interactive: ask for input
      answerStr = await prompt(chalk.bold("  Your choice: "));
      if (!answerStr || answerStr.toLowerCase() === "q" || answerStr.toLowerCase() === "quit") {
        console.log(chalk.dim("Exiting. Progress saved."));
        await TreeSerializer.save(tree, cwd);
        break;
      }
    }

    // 5. Resolve the answer
    const chosenChildId = resolveAnswer(answerStr, firstQ.node, firstQ.question, tree);

    if (!chosenChildId) {
      console.log(chalk.yellow(`  Could not match "${answerStr}". Try a number (1-${firstQ.question.options.length}) or a label keyword.`));
      console.log("");
      continue;
    }

    // 6. Check if chosen branch has any completed work before pruning
    const chosenChild = tree.getNode(chosenChildId);
    const chosenLabel = chosenChild?.answer?.label ?? answerStr;

    if (chosenChild) {
      const hasCompletedLeaf = hasCompletedDescendant(chosenChild, tree);
      if (!hasCompletedLeaf && !chosenChild.isComplete()) {
        // All nodes in this branch failed — warn the user
        const failedCount = countFailedDescendants(chosenChild, tree);
        console.log(chalk.yellow(
          `  Warning: "${chosenLabel}" has no completed implementations (${failedCount} failed node${failedCount !== 1 ? "s" : ""}).`,
        ));
        console.log(chalk.yellow(
          `  Choosing this will leave you with no results to apply.`,
        ));

        const confirm = await prompt(chalk.bold("  Continue anyway? (y/n): "));
        if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
          console.log(chalk.dim("  Skipped. Pick a different option or re-explore."));
          console.log("");
          continue;
        }
      }
    }

    // Prune siblings
    const pruner = new TreePruner(tree);
    const pruned = pruner.pruneByAnswer(firstQ.node.id, chosenChildId);
    console.log(chalk.green(`  Chose: "${chosenLabel}" (pruned ${pruned.length} branch${pruned.length !== 1 ? "es" : ""})`));
    console.log("");

    // 7. Save after each answer
    await TreeSerializer.save(tree, cwd);
  }
}

/** Check if a node or any of its descendants has completed */
function hasCompletedDescendant(node: TreeNode, tree: DecisionTree): boolean {
  if (node.isComplete()) return true;
  for (const childId of node.childIds) {
    const child = tree.getNode(childId);
    if (child && hasCompletedDescendant(child, tree)) return true;
  }
  return false;
}

/** Count failed nodes in a subtree */
function countFailedDescendants(node: TreeNode, tree: DecisionTree): number {
  let count = node.status === "failed" ? 1 : 0;
  for (const childId of node.childIds) {
    const child = tree.getNode(childId);
    if (child) count += countFailedDescendants(child, tree);
  }
  return count;
}
