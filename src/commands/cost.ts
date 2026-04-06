import chalk from "chalk";
import { TreeSerializer } from "../tree/serializer.js";

export async function costAction(): Promise<void> {
  const cwd = process.cwd();

  // 1. Load latest tree
  const tree = await TreeSerializer.loadLatest(cwd);
  if (!tree) {
    console.log("No active exploration found.");
    return;
  }

  const state = tree.toState();
  const stats = tree.getStats();

  // 2. Print total cost
  console.log(chalk.bold.underline("Cost Breakdown"));
  console.log("");
  console.log(`  Total cost: ${chalk.yellow(`$${stats.totalCostUsd.toFixed(4)}`)}`);
  console.log(`  Budget:     $${state.config.budget.totalUsd.toFixed(2)} (${state.config.budget.mode})`);
  console.log("");

  // 3. Per-node cost table
  const nodes = Object.values(state.nodes);
  if (nodes.length === 0) {
    console.log("  No nodes.");
    return;
  }

  // Header
  const idWidth = 10;
  const labelWidth = 30;
  const statusWidth = 14;
  const costWidth = 10;

  console.log(
    "  " +
      "Node ID".padEnd(idWidth) +
      "Label".padEnd(labelWidth) +
      "Status".padEnd(statusWidth) +
      "Cost".padStart(costWidth),
  );
  console.log("  " + "-".repeat(idWidth + labelWidth + statusWidth + costWidth));

  // Sort by creation time
  const sorted = nodes.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt),
  );

  for (const node of sorted) {
    const shortId = node.id.slice(0, 8);
    const label =
      node.answer?.label ??
      (node.depth === 0 ? "ROOT" : "(no answer)");
    const truncLabel =
      label.length > labelWidth - 2
        ? label.slice(0, labelWidth - 3) + "\u2026"
        : label;
    const cost =
      node.costUsd > 0
        ? `$${node.costUsd.toFixed(4)}`
        : "$0.00";

    console.log(
      "  " +
        shortId.padEnd(idWidth) +
        truncLabel.padEnd(labelWidth) +
        node.status.padEnd(statusWidth) +
        cost.padStart(costWidth),
    );
  }
}
