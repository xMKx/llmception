import chalk from "chalk";
import { TreeSerializer } from "../tree/serializer.js";
import { ProviderRegistry } from "../providers/registry.js";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

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
  const pricing = ProviderRegistry.getProviderInfo(state.config.provider).pricing;
  const isSubscription = pricing !== "metered";

  // 2. Print totals
  console.log(chalk.bold.underline("Cost & Token Breakdown"));
  console.log("");

  const costLabel = isSubscription
    ? `${chalk.dim(`~$${stats.totalCostUsd.toFixed(2)} equiv.`)} ${chalk.dim("(subscription — no actual charge)")}`
    : chalk.yellow(`$${stats.totalCostUsd.toFixed(4)}`);
  console.log(`  Cost:   ${costLabel}`);
  console.log(`  Tokens: ${chalk.cyan(fmtTokens(stats.totalInputTokens + stats.totalOutputTokens))} total ${chalk.dim(`(${fmtTokens(stats.totalInputTokens)} input, ${fmtTokens(stats.totalOutputTokens)} output)`)}`);

  if (isSubscription) {
    console.log(chalk.dim(`  Budget: N/A (subscription)`));
  } else {
    console.log(`  Budget: $${state.config.budget.totalUsd.toFixed(2)} (${state.config.budget.mode})`);
  }
  console.log("");

  // 3. Per-node cost table
  const nodes = Object.values(state.nodes);
  if (nodes.length === 0) {
    console.log("  No nodes.");
    return;
  }

  // Header
  const idW = 10;
  const labelW = 25;
  const statusW = 14;
  const costW = 12;
  const tokInW = 10;
  const tokOutW = 10;

  console.log(
    "  " +
      "Node".padEnd(idW) +
      "Label".padEnd(labelW) +
      "Status".padEnd(statusW) +
      "Cost".padStart(costW) +
      "Input".padStart(tokInW) +
      "Output".padStart(tokOutW),
  );
  console.log("  " + "-".repeat(idW + labelW + statusW + costW + tokInW + tokOutW));

  // Sort by creation time
  const sorted = nodes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const node of sorted) {
    const shortId = node.id.slice(0, 8);
    const label = node.answer?.label ?? (node.depth === 0 ? "ROOT" : "(no answer)");
    const truncLabel = label.length > labelW - 2 ? label.slice(0, labelW - 3) + "\u2026" : label;

    const cost = node.costUsd > 0
      ? (isSubscription ? `~$${node.costUsd.toFixed(2)}` : `$${node.costUsd.toFixed(4)}`)
      : "$0.00";
    const tokIn = fmtTokens(node.tokenUsage.inputTokens);
    const tokOut = fmtTokens(node.tokenUsage.outputTokens);

    console.log(
      "  " +
        shortId.padEnd(idW) +
        truncLabel.padEnd(labelW) +
        node.status.padEnd(statusW) +
        cost.padStart(costW) +
        tokIn.padStart(tokInW) +
        tokOut.padStart(tokOutW),
    );
  }
}
