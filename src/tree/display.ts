import chalk from "chalk";
import type { InterceptedQuestion, PricingModel } from "../types.js";
import { TreeNode } from "./node.js";
import { DecisionTree } from "./tree.js";

/** Characters used for drawing tree branches */
const BRANCH = "\u2502   ";
const TEE = "\u251C\u2500\u2500 ";
const LAST = "\u2514\u2500\u2500 ";
const SPACE = "    ";

/** Colour a status label for terminal display */
function colourStatus(status: string): string {
  switch (status) {
    case "completed":
      return chalk.green(status);
    case "running":
      return chalk.blue(status);
    case "pending":
      return chalk.gray(status);
    case "questioned":
      return chalk.yellow(status);
    case "forking":
      return chalk.cyan(status);
    case "failed":
      return chalk.red(status);
    case "pruned":
      return chalk.dim.strikethrough(status);
    case "auto-resolved":
      return chalk.magenta(status);
    default:
      return status;
  }
}

/** Format a cost value for display, with pricing context */
function formatCost(usd: number, pricing?: PricingModel): string {
  if (usd === 0) return chalk.dim("$0.00");
  if (pricing && pricing !== "metered") {
    return chalk.dim(`~$${usd.toFixed(2)} equiv.`);
  }
  return chalk.yellow(`$${usd.toFixed(4)}`);
}

/** Format a token count for display */
function formatTokenCount(input: number, output: number): string {
  const fmt = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };
  const total = input + output;
  return `${chalk.cyan(fmt(total))} total ${chalk.dim(`(${fmt(input)} input, ${fmt(output)} output)`)}`;
}

/** Truncate a string to maxLen characters with ellipsis */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "\u2026";
}

/**
 * Terminal display utilities for decision trees.
 */
export class TreeDisplay {
  /**
   * Render an ASCII tree visualisation.
   * Each node shows: [status] label (cost) with tree lines.
   */
  static formatTree(tree: DecisionTree): string {
    const state = tree.toState();
    if (!state.rootId) return chalk.dim("(empty tree)");

    const lines: string[] = [];
    lines.push(
      chalk.bold(`Decision Tree: ${truncate(state.task, 60)}`),
    );
    lines.push("");

    const renderNode = (nodeId: string, prefix: string, isLast: boolean) => {
      const node = tree.getNode(nodeId);
      if (!node) return;

      const connector = isLast ? LAST : TEE;
      const ns = node.toState();

      let label: string;
      if (ns.answer) {
        label = truncate(ns.answer.label, 40);
      } else if (ns.depth === 0) {
        label = chalk.bold("ROOT");
      } else {
        label = chalk.dim("(no answer)");
      }

      const statusStr = colourStatus(ns.status);
      const costStr = ns.costUsd > 0 ? ` ${formatCost(ns.costUsd)}` : "";
      const diffStr = ns.diffStat ? chalk.dim(` ${ns.diffStat}`) : "";
      const errorStr = ns.error
        ? chalk.red(` err: ${truncate(ns.error, 30)}`)
        : "";
      const questionStr =
        ns.status === "questioned" && ns.question
          ? chalk.yellow(` ? ${truncate(ns.question.header, 30)}`)
          : "";

      lines.push(
        `${prefix}${connector}${label} [${statusStr}]${costStr}${diffStr}${errorStr}${questionStr}`,
      );

      const childPrefix = prefix + (isLast ? SPACE : BRANCH);
      const children = ns.childIds;
      for (let i = 0; i < children.length; i++) {
        renderNode(children[i], childPrefix, i === children.length - 1);
      }
    };

    renderNode(state.rootId, "", true);
    return lines.join("\n");
  }

  /** Render a compact status summary */
  static formatStatus(tree: DecisionTree, pricing?: PricingModel): string {
    const stats = tree.getStats();
    const state = tree.toState();
    const lines: string[] = [];

    lines.push(chalk.bold.underline("Tree Status"));
    lines.push(`  Task: ${truncate(state.task, 60)}`);
    lines.push(`  ID:   ${chalk.dim(state.id)}`);
    lines.push("");
    lines.push(
      `  Nodes: ${stats.totalNodes} total` +
        ` (${chalk.green(String(stats.completedNodes))} done,` +
        ` ${chalk.blue(String(stats.runningNodes))} running,` +
        ` ${chalk.gray(String(stats.pendingNodes))} pending,` +
        ` ${chalk.red(String(stats.failedNodes))} failed,` +
        ` ${chalk.dim(String(stats.prunedNodes))} pruned)`,
    );
    lines.push(
      `  Completed leaves: ${chalk.green(String(stats.completedLeaves))}`,
    );
    lines.push(`  Max depth: ${stats.maxDepthReached}`);

    const tokenSummary = formatTokenCount(stats.totalInputTokens, stats.totalOutputTokens);
    if (pricing && pricing !== "metered") {
      lines.push(`  Cost: ${formatCost(stats.totalCostUsd, pricing)} ${chalk.dim("(subscription — no actual charge)")}`);
    } else {
      lines.push(`  Cost: ${formatCost(stats.totalCostUsd, pricing)}`);
    }
    lines.push(`  Tokens: ${tokenSummary}`);

    if (stats.questionedNodes > 0) {
      lines.push(
        `  ${chalk.yellow(`${stats.questionedNodes} question(s) awaiting answer`)}`,
      );
    }

    return lines.join("\n");
  }

  /**
   * Format a question with numbered options.
   * Each option shows the answer label, description, and downstream stats
   * (how many nodes would be explored if chosen).
   */
  static formatQuestion(
    node: TreeNode,
    question: InterceptedQuestion,
    tree: DecisionTree,
  ): string {
    const lines: string[] = [];

    lines.push("");
    lines.push(
      chalk.bold.yellow(
        `\u2753 Question at depth ${node.depth}:`,
      ),
    );
    lines.push(chalk.bold(`  ${question.header}`));
    lines.push("");
    lines.push(chalk.dim(`  ${question.question}`));
    lines.push("");

    // Find children of this node to show downstream stats
    const childNodes: TreeNode[] = [];
    for (const childId of node.childIds) {
      const child = tree.getNode(childId);
      if (child) childNodes.push(child);
    }

    question.options.forEach((option, index) => {
      const num = chalk.bold.cyan(`  ${index + 1}.`);
      const label = chalk.bold(option.label);

      // Find the matching child node for downstream stats
      const matchingChild = childNodes.find(
        (c) => c.answer?.label === option.label,
      );

      let downstream = "";
      if (matchingChild) {
        const subtreeCount = countSubtree(tree, matchingChild.id);
        const subtreeStatus = getSubtreeStatusSummary(tree, matchingChild.id);
        downstream = chalk.dim(
          ` [${subtreeCount} nodes: ${subtreeStatus}]`,
        );
      }

      lines.push(`${num} ${label}${downstream}`);
      if (option.description) {
        lines.push(chalk.dim(`     ${option.description}`));
      }
    });

    lines.push("");
    return lines.join("\n");
  }
}

/** Count all nodes in a subtree rooted at nodeId (inclusive) */
function countSubtree(tree: DecisionTree, nodeId: string): number {
  const node = tree.getNode(nodeId);
  if (!node) return 0;

  let count = 1;
  for (const childId of node.childIds) {
    count += countSubtree(tree, childId);
  }
  return count;
}

/** Get a compact status summary for a subtree */
function getSubtreeStatusSummary(tree: DecisionTree, nodeId: string): string {
  const counts: Record<string, number> = {};

  const walk = (id: string) => {
    const node = tree.getNode(id);
    if (!node) return;
    const s = node.status;
    counts[s] = (counts[s] ?? 0) + 1;
    for (const childId of node.childIds) {
      walk(childId);
    }
  };

  walk(nodeId);

  const parts: string[] = [];
  if (counts["completed"]) parts.push(`${counts["completed"]} done`);
  if (counts["running"]) parts.push(`${counts["running"]} running`);
  if (counts["pending"]) parts.push(`${counts["pending"]} pending`);
  if (counts["failed"]) parts.push(`${counts["failed"]} failed`);
  if (counts["pruned"]) parts.push(`${counts["pruned"]} pruned`);
  if (counts["questioned"]) parts.push(`${counts["questioned"]} questioned`);
  return parts.join(", ") || "empty";
}
