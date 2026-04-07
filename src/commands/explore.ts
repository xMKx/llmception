import type { LlmceptionConfig, PricingModel, ProviderType } from "../types.js";
import { loadConfig, mergeConfigs, validateConfig } from "../config/schema.js";
import { Orchestrator } from "../runner/orchestrator.js";
import type { ActivityEvent } from "../runner/orchestrator.js";
import { TreeDisplay } from "../tree/display.js";
import { TreeSerializer } from "../tree/serializer.js";
import { ProviderRegistry } from "../providers/registry.js";
import chalk from "chalk";

export interface ExploreOpts {
  depth?: string;
  width?: string;
  budget?: string;
  model?: string;
  provider?: string;
  concurrency?: string;
  nodeBudget?: string;
}

/**
 * Build CLI overrides from option strings into a partial config.
 */
export function buildOverrides(opts: ExploreOpts): Partial<LlmceptionConfig> {
  const overrides: Partial<LlmceptionConfig> = {};

  if (opts.depth !== undefined) {
    const n = parseInt(opts.depth, 10);
    if (!Number.isNaN(n)) overrides.maxDepth = n;
  }
  if (opts.width !== undefined) {
    const n = parseInt(opts.width, 10);
    if (!Number.isNaN(n)) overrides.maxWidth = n;
  }
  if (opts.budget !== undefined) {
    const n = parseFloat(opts.budget);
    if (!Number.isNaN(n)) {
      overrides.budget = { totalUsd: n, perBranchUsd: n, mode: "hard" };
    }
  }
  if (opts.model !== undefined) {
    overrides.model = opts.model;
  }
  if (opts.provider !== undefined) {
    overrides.provider = opts.provider as ProviderType;
  }
  if (opts.concurrency !== undefined) {
    const n = parseInt(opts.concurrency, 10);
    if (!Number.isNaN(n)) overrides.concurrency = n;
  }
  if (opts.nodeBudget !== undefined) {
    const n = parseInt(opts.nodeBudget, 10);
    if (!Number.isNaN(n)) overrides.nodeBudget = n;
  }

  return overrides;
}

function formatElapsed(startMs: number): string {
  const sec = Math.floor((Date.now() - startMs) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m${rem}s`;
}

function formatCostLabel(costUsd: number, isSubscription: boolean): string {
  if (isSubscription) {
    return chalk.dim(`~$${costUsd.toFixed(2)} equiv.`);
  }
  return chalk.yellow(`$${costUsd.toFixed(4)}`);
}

function formatActivityLine(event: ActivityEvent, isSubscription: boolean): string {
  const prefix = chalk.dim(`  [${event.label}]`);

  switch (event.type) {
    case "node_started":
      return `${chalk.blue("START")} ${prefix} ${chalk.dim(event.detail ?? "")}`;
    case "node_completed": {
      const cost = event.detail ?? "";
      const costStr = isSubscription ? chalk.dim(`~${cost} equiv.`) : chalk.green(cost);
      return `${chalk.green("DONE")}  ${prefix} ${costStr}`;
    }
    case "node_failed":
      return `${chalk.red("FAIL")}  ${prefix} ${chalk.red(event.detail ?? "")}`;
    case "question_detected":
      return `${chalk.yellow("ASK")}   ${prefix} ${chalk.yellow(event.detail ?? "")}`;
    case "forking":
      return `${chalk.cyan("FORK")}  ${prefix} ${chalk.cyan(event.detail ?? "")}`;
    case "auto_resolving":
      return `${chalk.magenta("AUTO")}  ${prefix} ${chalk.dim(event.detail ?? "")}`;
    case "tool_use":
      return `${chalk.dim("TOOL")}  ${prefix} ${chalk.dim(event.detail ?? "")}`;
  }
}

export async function exploreAction(task: string, opts: ExploreOpts): Promise<void> {
  const cwd = process.cwd();

  // 1. Load config
  let config = await loadConfig(cwd);

  // 2. Apply CLI overrides
  const overrides = buildOverrides(opts);
  config = mergeConfigs(config, overrides);

  // 3. Validate
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error("Configuration errors:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
    return;
  }

  // 4. Create orchestrator
  const orchestrator = new Orchestrator(config);
  const pricing: PricingModel = ProviderRegistry.getProviderInfo(config.provider).pricing;
  const isSubscription = pricing !== "metered";
  const startTime = Date.now();

  // 5. Print header
  console.error("");
  console.error(chalk.bold(`llmception`) + chalk.dim(` — exploring "${task}"`));
  console.error(chalk.dim(`  Provider: ${config.provider} | Model: ${config.model} | Depth: ${config.maxDepth} | Width: ${config.maxWidth} | Budget: ${config.nodeBudget} nodes`));
  if (isSubscription) {
    console.error(chalk.dim(`  Pricing: subscription (no per-query charge, costs shown are API equivalents)`));
  }
  console.error(chalk.dim(`  Press Ctrl+C to stop exploration (progress is saved)`));
  console.error("");

  // 6. Register activity callback for detailed events
  let lastProgressLine = "";
  let lastOutputTime = Date.now();
  const toolUseThrottle = new Map<string, number>();

  const printLine = (line: string) => {
    console.error(line);
    lastOutputTime = Date.now();
  };

  orchestrator.onActivity((event: ActivityEvent) => {
    // Throttle tool_use events: max 1 per node per 3 seconds
    if (event.type === "tool_use") {
      const now = Date.now();
      const last = toolUseThrottle.get(event.nodeId) ?? 0;
      if (now - last < 3000) return;
      toolUseThrottle.set(event.nodeId, now);
    }

    printLine(formatActivityLine(event, isSubscription));
  });

  // 7. Register progress callback for summary bar
  orchestrator.onProgress((tree) => {
    const stats = tree.getStats();
    const parts: string[] = [];
    if (stats.runningNodes > 0) parts.push(chalk.blue(`${stats.runningNodes} running`));
    if (stats.completedNodes > 0) parts.push(chalk.green(`${stats.completedNodes} done`));
    if (stats.questionedNodes > 0) parts.push(chalk.yellow(`${stats.questionedNodes} questioned`));
    if (stats.pendingNodes > 0) parts.push(chalk.dim(`${stats.pendingNodes} pending`));
    if (stats.failedNodes > 0) parts.push(chalk.red(`${stats.failedNodes} failed`));

    const costStr = formatCostLabel(stats.totalCostUsd, isSubscription);
    const elapsed = formatElapsed(startTime);
    const newLine = `${chalk.dim("---")} ${parts.join(chalk.dim(" | "))} ${chalk.dim("| cost:")} ${costStr} ${chalk.dim(`| ${elapsed}`)}`;

    // Only print if changed (avoid spamming identical lines)
    if (newLine !== lastProgressLine) {
      lastProgressLine = newLine;
      printLine(newLine);
    }
  });

  // 7b. Heartbeat: print a "still working" line if no output for 30s
  const heartbeat = setInterval(() => {
    const silentMs = Date.now() - lastOutputTime;
    if (silentMs >= 30_000) {
      const tree = orchestrator.getTree();
      const stats = tree?.getStats();
      const running = stats?.runningNodes ?? 0;
      const elapsed = formatElapsed(startTime);
      const runningLabel = running > 0
        ? `${running} node${running > 1 ? "s" : ""} working`
        : "working";
      printLine(chalk.dim(`        ... ${runningLabel} (${elapsed} elapsed) — Ctrl+C to stop`));
    }
  }, 30_000);

  // 8. Handle Ctrl+C gracefully
  let interrupted = false;
  const handleSigint = async () => {
    if (interrupted) {
      console.error(chalk.red("\nForce quit. Worktrees may need manual cleanup: llmception cleanup"));
      process.exit(1);
    }
    interrupted = true;
    clearInterval(heartbeat);
    console.error("");
    console.error(chalk.yellow("Stopping exploration (saving progress)..."));
    console.error(chalk.dim("  Press Ctrl+C again to force quit"));
    console.error("");

    await orchestrator.stop(cwd);

    const tree = orchestrator.getTree();
    if (tree) {
      await TreeSerializer.save(tree, cwd);
      console.error(TreeDisplay.formatStatus(tree, pricing));
      console.error("");
      console.error(chalk.dim("Exploration paused. Your options:"));
      console.error(chalk.dim("  llmception status      — review what was explored"));
      console.error(chalk.dim("  llmception status --tree — see the full decision tree"));
      console.error(chalk.dim("  llmception answer <n>  — answer questions from completed branches"));
      console.error(chalk.dim("  llmception cleanup     — discard all worktrees and branches"));
    }

    process.exit(0);
  };

  process.on("SIGINT", () => {
    void handleSigint();
  });

  // 9. Explore
  try {
    const tree = await orchestrator.explore(task, cwd);

    // Cleanup handlers
    clearInterval(heartbeat);
    process.removeAllListeners("SIGINT");

    // 10. Print final status
    const elapsed = formatElapsed(startTime);
    console.error("");
    console.error(chalk.green.bold(`Exploration complete`) + chalk.dim(` (${elapsed})`));
    console.error("");
    console.log(TreeDisplay.formatStatus(tree, pricing));

    const firstQ = tree.getFirstUnresolvedQuestion();
    if (firstQ) {
      console.log(TreeDisplay.formatQuestion(firstQ.node, firstQ.question, tree));
      console.log(chalk.bold('Run "llmception answer <option>" to choose.'));
    } else {
      const leaves = tree.getCompletedLeaves();
      if (leaves.length === 1) {
        console.log("");
        console.log(chalk.green.bold("Single implementation ready!"));
        console.log(chalk.dim('Run "llmception apply" to apply changes to your working tree.'));
      } else if (leaves.length > 1) {
        console.log("");
        console.log(chalk.yellow(`${leaves.length} implementations completed.`));
        console.log(chalk.dim('Run "llmception status --tree" to review, then "llmception answer <n>" to pick.'));
      }
    }
  } catch (err: unknown) {
    clearInterval(heartbeat);
    process.removeAllListeners("SIGINT");
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Exploration failed: ${msg}`));

    const tree = orchestrator.getTree();
    if (tree) {
      await TreeSerializer.save(tree, cwd);
      console.error(chalk.dim("Partial progress saved. Run 'llmception status' to review."));
    }

    process.exitCode = 1;
  }
}
