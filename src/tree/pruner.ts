import { DecisionTree } from "./tree.js";

/**
 * Handles pruning logic for decision trees.
 * Pruning marks nodes and their subtrees as "pruned" so they are
 * no longer considered for execution but remain in the tree for audit.
 */
export class TreePruner {
  private tree: DecisionTree;

  constructor(tree: DecisionTree) {
    this.tree = tree;
  }

  /**
   * When a user chooses an answer, prune all sibling branches.
   * The chosen child keeps running; all other children of the
   * question node (and their entire subtrees) are pruned.
   *
   * @returns IDs of all pruned nodes
   */
  pruneByAnswer(questionNodeId: string, chosenChildId: string): string[] {
    const parent = this.tree.getNode(questionNodeId);
    if (!parent) {
      throw new Error(`Node ${questionNodeId} not found`);
    }

    const pruned: string[] = [];
    for (const childId of parent.childIds) {
      if (childId !== chosenChildId) {
        // Force-prune: user explicitly chose, so discard siblings even if completed
        pruned.push(...this.pruneSubtree(childId, true));
      }
    }
    return pruned;
  }

  /**
   * Prune pending nodes that would exceed the budget.
   * Walks BFS, marks excess pending nodes as pruned.
   *
   * @returns IDs of all pruned nodes
   */
  pruneByBudget(): string[] {
    const config = this.tree.getConfig();
    const stats = this.tree.getStats();
    const budget = config.budget;
    const pruned: string[] = [];

    if (budget.mode === "none") return pruned;

    // Prune pending nodes whose branch cost exceeds perBranchUsd
    for (const leaf of this.tree.getLeaves()) {
      if (leaf.status !== "pending") continue;

      // Calculate the branch cost by walking up the tree
      let branchCost = 0;
      let current = leaf;
      while (true) {
        branchCost += current.costUsd;
        if (!current.parentId) break;
        const parent = this.tree.getNode(current.parentId);
        if (!parent) break;
        current = parent;
      }

      if (branchCost > budget.perBranchUsd) {
        pruned.push(...this.pruneSubtree(leaf.id));
      }
    }

    // Prune if total cost exceeds totalUsd
    if (stats.totalCostUsd > budget.totalUsd) {
      for (const leaf of this.tree.getLeaves()) {
        if (leaf.status === "pending") {
          pruned.push(...this.pruneSubtree(leaf.id));
        }
      }
    }

    return pruned;
  }

  /**
   * Recursively prune a node and all its descendants.
   * When force is true, prunes even completed/failed nodes (used by pruneByAnswer).
   *
   * @returns IDs of all pruned nodes
   */
  pruneSubtree(nodeId: string, force = false): string[] {
    const node = this.tree.getNode(nodeId);
    if (!node) return [];

    const pruned: string[] = [];

    if (node.status === "pruned") {
      // Already pruned; still recurse to catch children
    } else if (force || (node.status !== "completed" && node.status !== "failed")) {
      node.setStatus("pruned");
      pruned.push(nodeId);
    }

    for (const childId of node.childIds) {
      pruned.push(...this.pruneSubtree(childId, force));
    }

    return pruned;
  }
}
