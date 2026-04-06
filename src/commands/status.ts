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
    return;
  }

  // 4. Status summary + first unresolved question
  console.log(TreeDisplay.formatStatus(tree));

  const firstQ = tree.getFirstUnresolvedQuestion();
  if (firstQ) {
    console.log(TreeDisplay.formatQuestion(firstQ.node, firstQ.question, tree));
    console.log('Run "llmception answer <option>" to choose.');
  }
}
