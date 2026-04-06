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
    console.log("No questions to answer.");
    return;
  }

  // 3. Validate option index
  const optionIndex = parseInt(option, 10);
  if (Number.isNaN(optionIndex) || optionIndex < 1 || optionIndex > firstQ.question.options.length) {
    console.error(
      `Invalid option: ${option}. Must be between 1 and ${firstQ.question.options.length}.`,
    );
    process.exitCode = 1;
    return;
  }

  // 4. Get chosen child node ID
  const chosenIndex = optionIndex - 1;
  const childIds = firstQ.node.childIds;

  if (chosenIndex >= childIds.length) {
    console.error(
      `Option ${optionIndex} does not have a corresponding branch yet.`,
    );
    process.exitCode = 1;
    return;
  }

  const chosenChildId = childIds[chosenIndex];

  // 5. Prune siblings and mark the question node as resolved
  const pruner = new TreePruner(tree);
  const pruned = pruner.pruneByAnswer(firstQ.node.id, chosenChildId);

  // Mark the question node as no longer "questioned" so it won't be returned
  // by getFirstUnresolvedQuestion again. "forking" indicates the user has
  // chosen a path forward.
  firstQ.node.setStatus("forking");

  console.log(
    `Chose option ${optionIndex}: "${firstQ.question.options[chosenIndex].label}"`,
  );
  console.log(`Pruned ${pruned.length} node(s).`);

  // 6. Save updated tree
  await TreeSerializer.save(tree, cwd);

  // 7. Check for next question
  const nextQ = tree.getFirstUnresolvedQuestion();
  if (nextQ) {
    console.log(TreeDisplay.formatQuestion(nextQ.node, nextQ.question, tree));
    console.log('Run "llmception answer <option>" to choose.');
    return;
  }

  // 8. Check if resolved to single implementation
  const completedLeaves = tree.getCompletedLeaves().filter(
    (n) => n.status !== "pruned",
  );

  if (completedLeaves.length === 1) {
    const winner = completedLeaves[0];
    console.log("");
    console.log(
      `Resolved to a single implementation: ${winner.answer?.label ?? "root"}`,
    );
    if (winner.branchName) {
      console.log(`Branch: ${winner.branchName}`);
    }
    console.log('Run "llmception apply" to apply changes to your working tree.');
  } else if (completedLeaves.length === 0) {
    console.log("No completed implementations remaining.");
  } else {
    console.log(
      `${completedLeaves.length} implementations remain. Exploration may still be running.`,
    );
  }
}
