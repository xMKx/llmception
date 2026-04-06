import type { LlmceptionConfig, TokenUsage } from "../types.js";
import { logger } from "../util/logger.js";

/** Thrown when a hard budget limit is exceeded. */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/**
 * Tracks costs per node and enforces budget limits.
 */
export class CostTracker {
  private config: LlmceptionConfig;
  private nodeCosts: Map<string, number> = new Map();

  constructor(config: LlmceptionConfig) {
    this.config = config;
  }

  /**
   * Record token usage for a node.
   * Enforces budget based on the configured mode.
   */
  record(nodeId: string, usage: TokenUsage): void {
    const current = this.nodeCosts.get(nodeId) ?? 0;
    const newNodeCost = current + usage.costUsd;
    this.nodeCosts.set(nodeId, newNodeCost);

    const totalCost = this.getTotalCost();
    const mode = this.config.budget.mode;

    if (mode === "none") return;

    // Check per-branch budget
    if (newNodeCost > this.config.budget.perBranchUsd) {
      const msg = `Node ${nodeId} exceeded per-branch budget: $${newNodeCost.toFixed(4)} > $${this.config.budget.perBranchUsd.toFixed(2)}`;
      if (mode === "hard") throw new BudgetExceededError(msg);
      if (mode === "warn") logger.warn(msg);
    }

    // Check total budget
    if (totalCost > this.config.budget.totalUsd) {
      const msg = `Total budget exceeded: $${totalCost.toFixed(4)} > $${this.config.budget.totalUsd.toFixed(2)}`;
      if (mode === "hard") throw new BudgetExceededError(msg);
      if (mode === "warn") logger.warn(msg);
    }
  }

  /** Get the accumulated cost for a specific node. */
  getNodeCost(nodeId: string): number {
    return this.nodeCosts.get(nodeId) ?? 0;
  }

  /** Get the total cost across all nodes. */
  getTotalCost(): number {
    let total = 0;
    this.nodeCosts.forEach((cost) => {
      total += cost;
    });
    return total;
  }

  /** Check if adding an additional amount stays within the total budget. */
  isWithinBudget(additionalUsd: number = 0): boolean {
    return this.getTotalCost() + additionalUsd <= this.config.budget.totalUsd;
  }

  /** Check if adding an additional amount keeps a node within the per-branch budget. */
  isNodeWithinBudget(nodeId: string, additionalUsd: number = 0): boolean {
    return this.getNodeCost(nodeId) + additionalUsd <= this.config.budget.perBranchUsd;
  }

  /** Get a summary of all tracked costs. */
  getSummary(): {
    totalCostUsd: number;
    nodeCosts: Record<string, number>;
    budgetRemaining: number;
  } {
    const totalCostUsd = this.getTotalCost();
    const nodeCosts: Record<string, number> = {};
    this.nodeCosts.forEach((cost, id) => {
      nodeCosts[id] = cost;
    });
    return {
      totalCostUsd,
      nodeCosts,
      budgetRemaining: Math.max(0, this.config.budget.totalUsd - totalCostUsd),
    };
  }

  /** Reset all tracked costs. */
  reset(): void {
    this.nodeCosts.clear();
  }
}
