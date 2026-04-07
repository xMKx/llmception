import type { LlmceptionConfig, PricingModel, ProviderType } from "../types.js";
import { loadConfig, mergeConfigs, validateConfig } from "../config/schema.js";
import { Orchestrator } from "../runner/orchestrator.js";
import { TreeDisplay } from "../tree/display.js";
import { ProviderRegistry } from "../providers/registry.js";

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

  // 5. Register progress callback
  orchestrator.onProgress((tree) => {
    const stats = tree.getStats();
    const parts: string[] = [];
    if (stats.runningNodes > 0) parts.push(`${stats.runningNodes} running`);
    if (stats.completedNodes > 0) parts.push(`${stats.completedNodes} done`);
    if (stats.questionedNodes > 0) parts.push(`${stats.questionedNodes} questioned`);
    if (stats.pendingNodes > 0) parts.push(`${stats.pendingNodes} pending`);
    const costLabel = isSubscription
      ? `~$${stats.totalCostUsd.toFixed(2)} equiv.`
      : `$${stats.totalCostUsd.toFixed(4)}`;
    console.error(`[llmception] ${parts.join(", ")} | ${costLabel}`);
  });

  // 6. Explore
  console.error(`Starting exploration: "${task}"`);
  const tree = await orchestrator.explore(task, cwd);

  // 7. Print final status
  console.log(TreeDisplay.formatStatus(tree, pricing));

  const firstQ = tree.getFirstUnresolvedQuestion();
  if (firstQ) {
    console.log(TreeDisplay.formatQuestion(firstQ.node, firstQ.question, tree));
    console.log('Run "llmception answer <option>" to choose.');
  }
}
