import { v4 as uuidv4 } from "uuid";
import type {
  AnswerOption,
  DecisionTreeState,
  InterceptedQuestion,
  LlmceptionConfig,
  NodeStatus,
  TreeNodeState,
  TreeStats,
} from "../types.js";
import { TreeNode } from "./node.js";

/** Creates a fresh TreeNodeState with default values */
function createNodeState(
  overrides: Partial<TreeNodeState> & Pick<TreeNodeState, "id" | "depth">,
): TreeNodeState {
  return {
    parentId: null,
    answer: null,
    question: null,
    status: "pending" as NodeStatus,
    sessionId: null,
    commitHash: null,
    branchName: null,
    worktreePath: null,
    childIds: [],
    costUsd: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    decisionPath: [],
    createdAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    filesChanged: [],
    diffStat: null,
    ...overrides,
  };
}

/**
 * Decision tree that tracks all explored branches for a given task.
 * Nodes are keyed by UUID and linked via parentId / childIds.
 */
export class DecisionTree {
  private id: string;
  private task: string;
  private config: LlmceptionConfig;
  private nodes: Map<string, TreeNode>;
  private rootId: string | null;
  private totalNodesCreated: number;
  private createdAt: string;
  private updatedAt: string;

  constructor(task: string, config: LlmceptionConfig) {
    this.id = uuidv4();
    this.task = task;
    this.config = config;
    this.nodes = new Map();
    this.rootId = null;
    this.totalNodesCreated = 0;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  /** Create the root node at depth 0 */
  createRoot(): TreeNode {
    if (this.rootId !== null) {
      throw new Error("Root node already exists");
    }
    const id = uuidv4();
    const state = createNodeState({ id, depth: 0 });
    const node = new TreeNode(state);
    this.nodes.set(id, node);
    this.rootId = id;
    this.totalNodesCreated++;
    this.touch();
    return node;
  }

  /** Create a child node beneath `parentId`, recording the chosen answer */
  addChild(parentId: string, answer: AnswerOption): TreeNode {
    const parent = this.nodes.get(parentId);
    if (!parent) {
      throw new Error(`Parent node ${parentId} not found`);
    }

    const id = uuidv4();
    const parentState = parent.toState();

    const decisionPath = [...parentState.decisionPath];
    if (parentState.question) {
      decisionPath.push({
        question: parentState.question.header,
        answer: answer.label,
      });
    }

    const state = createNodeState({
      id,
      parentId,
      depth: parentState.depth + 1,
      answer,
      decisionPath,
    });

    const node = new TreeNode(state);
    parent.addChild(id);
    this.nodes.set(id, node);
    this.totalNodesCreated++;
    this.touch();
    return node;
  }

  /** Retrieve a node by ID */
  getNode(id: string): TreeNode | undefined {
    return this.nodes.get(id);
  }

  /** Get the root node (throws if tree is empty) */
  getRootNode(): TreeNode {
    if (!this.rootId) {
      throw new Error("Tree has no root node");
    }
    const root = this.nodes.get(this.rootId);
    if (!root) {
      throw new Error("Root node not found in tree");
    }
    return root;
  }

  /** All leaf nodes (nodes with no children) */
  getLeaves(): TreeNode[] {
    const leaves: TreeNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.isLeaf()) {
        leaves.push(node);
      }
    }
    return leaves;
  }

  /** Leaf nodes with status "completed" */
  getCompletedLeaves(): TreeNode[] {
    return this.getLeaves().filter((n) => n.isComplete());
  }

  /** Next pending node in BFS order (shallowest first, then insertion order) */
  getNextPending(): TreeNode | undefined {
    if (!this.rootId) return undefined;

    const queue: string[] = [this.rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = this.nodes.get(id);
      if (!node) continue;
      if (node.status === "pending") return node;
      for (const childId of node.childIds) {
        queue.push(childId);
      }
    }
    return undefined;
  }

  /** All nodes with status "questioned" */
  getQuestionedNodes(): TreeNode[] {
    const result: TreeNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.status === "questioned") {
        result.push(node);
      }
    }
    return result;
  }

  /** The shallowest node that has an unresolved question */
  getFirstUnresolvedQuestion():
    | { node: TreeNode; question: InterceptedQuestion }
    | undefined {
    const questioned = this.getQuestionedNodes();
    if (questioned.length === 0) return undefined;

    questioned.sort((a, b) => a.depth - b.depth);
    const node = questioned[0];
    const question = node.question;
    if (!question) return undefined;
    return { node, question };
  }

  /** Aggregate tree statistics */
  getStats(): TreeStats {
    let totalNodes = 0;
    let completedNodes = 0;
    let runningNodes = 0;
    let pendingNodes = 0;
    let failedNodes = 0;
    let prunedNodes = 0;
    let questionedNodes = 0;
    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let maxDepthReached = 0;
    let completedLeaves = 0;

    for (const node of this.nodes.values()) {
      totalNodes++;
      totalCostUsd += node.costUsd;
      totalInputTokens += node.tokenUsage.inputTokens;
      totalOutputTokens += node.tokenUsage.outputTokens;
      if (node.depth > maxDepthReached) {
        maxDepthReached = node.depth;
      }
      switch (node.status) {
        case "completed":
          completedNodes++;
          if (node.isLeaf()) completedLeaves++;
          break;
        case "running":
          runningNodes++;
          break;
        case "pending":
          pendingNodes++;
          break;
        case "failed":
          failedNodes++;
          break;
        case "pruned":
          prunedNodes++;
          break;
        case "questioned":
        case "forking":
          questionedNodes++;
          break;
      }
    }

    return {
      totalNodes,
      completedNodes,
      runningNodes,
      pendingNodes,
      failedNodes,
      prunedNodes,
      questionedNodes,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      maxDepthReached,
      completedLeaves,
    };
  }

  /** Whether the tree can still grow (under node budget) */
  canGrow(): boolean {
    return this.totalNodesCreated < this.config.nodeBudget;
  }

  /** Serialise the entire tree to a plain state object */
  toState(): DecisionTreeState {
    const nodes: Record<string, TreeNodeState> = {};
    let totalCostUsd = 0;
    for (const node of this.nodes.values()) {
      const s = node.toState();
      nodes[s.id] = s;
      totalCostUsd += s.costUsd;
    }

    return {
      id: this.id,
      task: this.task,
      config: structuredClone(this.config),
      nodes,
      rootId: this.rootId ?? "",
      totalCostUsd,
      totalNodesCreated: this.totalNodesCreated,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /** Reconstruct a DecisionTree from serialised state */
  static fromState(state: DecisionTreeState): DecisionTree {
    const tree = new DecisionTree(state.task, state.config);
    tree.id = state.id;
    tree.rootId = state.rootId || null;
    tree.totalNodesCreated = state.totalNodesCreated;
    tree.createdAt = state.createdAt;
    tree.updatedAt = state.updatedAt;

    for (const nodeState of Object.values(state.nodes)) {
      const node = new TreeNode(structuredClone(nodeState));
      tree.nodes.set(node.id, node);
    }

    return tree;
  }

  /** Get the tree ID */
  getId(): string {
    return this.id;
  }

  /** Get the task description */
  getTask(): string {
    return this.task;
  }

  /** Get the config */
  getConfig(): LlmceptionConfig {
    return this.config;
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}
