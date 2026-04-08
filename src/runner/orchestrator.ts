import type {
  LlmceptionConfig,
  StreamEvent,
  InterceptedQuestion,
  AnswerOption,
  ExecuteOpts,
  ForkOpts,
  TokenUsage,
} from "../types.js";
import { DecisionTree } from "../tree/tree.js";
import { TreeNode } from "../tree/node.js";
import { TreeSerializer } from "../tree/serializer.js";
import { WorktreeManager } from "../git/worktree.js";
import { CostTracker } from "../cost/tracker.js";
import { ContextBuilder } from "../forker/context-builder.js";
import { OptionExtractor } from "../interceptor/option-extractor.js";
import { ProviderRegistry } from "../providers/registry.js";
import { ProcessPool } from "./process-pool.js";
import { logger } from "../util/logger.js";

type ProgressCallback = (tree: DecisionTree) => void;

/** Detailed activity event for UI display */
export interface ActivityEvent {
  type: "node_started" | "node_completed" | "node_failed" | "question_detected" | "forking" | "auto_resolving" | "tool_use";
  nodeId: string;
  label: string;
  detail?: string;
}

type ActivityCallback = (event: ActivityEvent) => void;

/**
 * The core orchestrator that drives the entire decision-tree exploration.
 *
 * Flow:
 * 1. Creates a root node and starts execution with the task prompt
 * 2. When a question is detected (ask_user event):
 *    - Records the question on the current node
 *    - Snapshots git state
 *    - Creates child nodes for each answer option
 *    - Submits fork/execute jobs for each child to the ProcessPool
 * 3. When depth >= maxDepth, auto-resolves with the first option
 * 4. Continues until all nodes are terminal (completed/failed/pruned)
 */
export class Orchestrator {
  private config: LlmceptionConfig;
  private tree!: DecisionTree;
  private worktreeManager!: WorktreeManager;
  private costTracker!: CostTracker;
  private pool!: ProcessPool;
  private progressCallbacks: ProgressCallback[] = [];
  private activityCallbacks: ActivityCallback[] = [];

  /** Maps processId -> nodeId for event routing */
  private processNodeMap: Map<string, string> = new Map();
  /** Maps nodeId -> accumulated text for the node */
  private nodeText: Map<string, string> = new Map();
  /** Track which nodes have pending work remaining */
  private pendingNodes: Set<string> = new Set();
  /** Nodes currently in retry-delay (waiting for setTimeout to fire) */
  private retryingNodes: Set<string> = new Set();
  /** Resolve function for the main exploration promise */
  private resolveExplore: (() => void) | null = null;

  constructor(config: LlmceptionConfig) {
    this.config = config;
  }

  /**
   * Register a callback that fires on significant tree state changes.
   */
  onProgress(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback);
  }

  /**
   * Register a callback for detailed activity events (tool use, questions, forks).
   */
  onActivity(callback: ActivityCallback): void {
    this.activityCallbacks.push(callback);
  }

  /**
   * Get the current tree (for external access during exploration).
   */
  getTree(): DecisionTree | undefined {
    return this.tree;
  }

  /**
   * Gracefully stop exploration: kills running processes, saves tree state.
   */
  async stop(cwd: string): Promise<void> {
    if (this.pool) {
      this.pool.stop();
    }
    // Clear pending/retrying state so timers don't revive nodes after stop
    this.pendingNodes.clear();
    this.retryingNodes.clear();
    if (this.tree) {
      await TreeSerializer.save(this.tree, cwd);
    }
  }

  /**
   * Main entry point: explore all decision branches for a given task.
   *
   * Creates the decision tree, starts root execution, and returns the
   * fully explored tree once all nodes have reached a terminal state.
   */
  async explore(task: string, cwd: string): Promise<DecisionTree> {
    // Initialize infrastructure
    this.tree = new DecisionTree(task, this.config);
    this.worktreeManager = new WorktreeManager(cwd);
    this.costTracker = new CostTracker(this.config);
    const provider = ProviderRegistry.create(this.config);
    this.pool = new ProcessPool(this.config, provider);

    // Ensure .llmception directories are gitignored
    await this.worktreeManager.ensureGitignore();

    // Wire up pool event handlers
    this.pool.onEvent((processId, event) => {
      this.handleEvent(processId, event);
    });
    this.pool.onComplete((processId) => {
      this.handleProcessComplete(processId);
    });

    // Create and start root node in its own worktree
    const root = this.tree.createRoot();
    root.setStatus("running");

    // Root gets its own worktree so changes are tracked and `apply` works
    try {
      const { worktreePath, branchName } = await this.worktreeManager.create(
        root.id,
        this.tree.toState().id,
      );
      root.setWorktree(worktreePath, branchName);
    } catch (err: unknown) {
      // If worktree creation fails (e.g. not a git repo), run in cwd directly
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Could not create worktree for root, running in cwd: ${msg}`);
    }

    this.emitActivity({
      type: "node_started",
      nodeId: root.id,
      label: "ROOT",
      detail: task,
    });
    this.emitProgress();

    const rootProcessId = `proc-${root.id}`;
    this.processNodeMap.set(rootProcessId, root.id);
    this.nodeText.set(root.id, "");
    this.pendingNodes.add(root.id);

    const systemPrompt = ContextBuilder.buildSystemPrompt();
    const rootCwd = root.worktreePath ?? cwd;
    const executeOpts: ExecuteOpts = {
      prompt: task,
      cwd: rootCwd,
      systemPrompt,
      model: this.config.model,
    };

    this.pool.submit(rootProcessId, executeOpts, false);

    // Wait until all nodes are done
    await new Promise<void>((resolve) => {
      this.resolveExplore = resolve;
      // Check immediately in case there's nothing to do
      this.checkDone();
    });

    // Persist tree state
    await TreeSerializer.save(this.tree, cwd);

    return this.tree;
  }

  /**
   * Handle a stream event from a pool process.
   */
  private handleEvent(processId: string, event: StreamEvent): void {
    const nodeId = this.processNodeMap.get(processId);
    if (!nodeId) {
      logger.warn(`Event from unknown process ${processId}`);
      return;
    }

    const node = this.tree.getNode(nodeId);
    if (!node) {
      logger.warn(`Node ${nodeId} not found in tree`);
      return;
    }

    switch (event.type) {
      case "init":
        this.handleInit(node, event.sessionId);
        break;

      case "text":
        this.handleText(nodeId, event.text);
        break;

      case "tool_use":
        logger.debug(`[Node ${nodeId}] Tool use: ${event.name}`);
        this.emitActivity({
          type: "tool_use",
          nodeId,
          label: this.getNodeLabel(node),
          detail: event.name,
        });
        break;

      case "ask_user":
        this.handleAskUser(node, event.question);
        break;

      case "result":
        this.handleResult(node, event);
        break;

      case "error":
        this.handleError(node, event.message);
        break;
    }
  }

  private handleInit(node: TreeNode, sessionId: string): void {
    node.setSessionId(sessionId);
    logger.debug(`[Node ${node.id}] Session initialized: ${sessionId}`);
  }

  private handleText(nodeId: string, text: string): void {
    const current = this.nodeText.get(nodeId) ?? "";
    this.nodeText.set(nodeId, current + text);
  }

  private handleAskUser(node: TreeNode, question: InterceptedQuestion): void {
    logger.info(`[Node ${node.id}] Question detected: ${question.header}`);
    this.emitActivity({
      type: "question_detected",
      nodeId: node.id,
      label: this.getNodeLabel(node),
      detail: `${question.header} (${question.options.length} options)`,
    });

    // Normalize options (cap at maxWidth)
    const normalizedOptions = OptionExtractor.normalize(
      question.options,
      this.config.maxWidth,
    );
    const normalizedQuestion: InterceptedQuestion = {
      ...question,
      options: normalizedOptions,
    };

    node.setQuestion(normalizedQuestion);
    this.emitProgress();

    // Decide whether to fork or auto-resolve
    if (node.depth < this.config.maxDepth && this.tree.canGrow()) {
      void this.forkNode(node, normalizedQuestion);
    } else {
      void this.autoResolve(node, normalizedQuestion);
    }
  }

  private handleResult(
    node: TreeNode,
    event: { costUsd: number; sessionId: string; tokenUsage: TokenUsage },
  ): void {
    node.setCost(event.tokenUsage);
    this.costTracker.record(node.id, event.tokenUsage);

    // Only mark completed if we haven't already set it to "questioned"
    if (node.status === "running") {
      node.setCompleted([], "");
      const totalTokens = event.tokenUsage.inputTokens + event.tokenUsage.outputTokens;
      const tokenStr = totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : String(totalTokens);
      logger.info(`[Node ${node.id}] Completed (${tokenStr} tokens, $${event.costUsd.toFixed(4)})`);
      this.emitActivity({
        type: "node_completed",
        nodeId: node.id,
        label: this.getNodeLabel(node),
        detail: `${tokenStr} tokens`,
      });

      // Commit all changes in the node's worktree so they're available for apply
      if (node.worktreePath) {
        void this.commitWorktreeChanges(node);
      }
    }

    this.pendingNodes.delete(node.id);
    this.emitProgress();
    this.checkDone();
  }

  /** Commit all changes in a completed node's worktree */
  private async commitWorktreeChanges(node: TreeNode): Promise<void> {
    if (!node.worktreePath) return;
    try {
      const commitHash = await this.worktreeManager.snapshot(
        node.worktreePath,
        `llmception: ${this.getNodeLabel(node)} implementation`,
      );
      node.setCommit(commitHash);
      logger.debug(`[Node ${node.id}] Committed changes: ${commitHash}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[Node ${node.id}] Could not commit worktree changes: ${msg}`);
    }
  }

  private handleError(node: TreeNode, message: string): void {
    const maxRetries = this.config.maxRetries ?? 3;
    const attempt = node.retryCount;

    if (attempt < maxRetries) {
      // Retry with exponential backoff: 2s, 4s, 8s
      const delayMs = Math.min(2000 * Math.pow(2, attempt), 30_000);
      logger.warn(
        `[Node ${node.id}] Error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms: ${message.slice(0, 200)}`,
      );
      this.emitActivity({
        type: "node_failed",
        nodeId: node.id,
        label: this.getNodeLabel(node),
        detail: `Retry ${attempt + 1}/${maxRetries} in ${(delayMs / 1000).toFixed(0)}s: ${message.slice(0, 100)}`,
      });

      node.resetForRetry();
      this.retryingNodes.add(node.id);

      setTimeout(() => {
        this.retryingNodes.delete(node.id);
        // If the pool was stopped while we were waiting, give up
        if (!this.pendingNodes.has(node.id)) {
          node.setFailed(message);
          this.emitProgress();
          this.checkDone();
          return;
        }
        this.retryNode(node);
      }, delayMs);

      return;
    }

    // Exhausted retries — mark as permanently failed
    logger.error(`[Node ${node.id}] Error (all ${maxRetries} retries exhausted): ${message}`);
    this.emitActivity({
      type: "node_failed",
      nodeId: node.id,
      label: this.getNodeLabel(node),
      detail: `Failed after ${maxRetries} retries: ${message.slice(0, 100)}`,
    });
    node.setFailed(message);
    this.pendingNodes.delete(node.id);
    this.emitProgress();
    this.checkDone();
  }

  /**
   * Resubmit a failed node to the pool for another attempt.
   */
  private retryNode(node: TreeNode): void {
    const processId = `proc-${node.id}-retry${node.retryCount}`;
    this.processNodeMap.set(processId, node.id);
    this.nodeText.set(node.id, "");

    const systemPrompt = ContextBuilder.buildSystemPrompt();
    const cwd = node.worktreePath ?? this.worktreeManager.getRepoRoot();

    // Rebuild the same opts that were used to originally start this node
    if (node.depth === 0) {
      // Root node — fresh execute
      const executeOpts: ExecuteOpts = {
        prompt: this.tree.getTask(),
        cwd,
        systemPrompt,
        model: this.config.model,
      };
      this.pool.submit(processId, executeOpts, false);
    } else {
      // Child node — rebuild context from decision path
      const task = this.tree.getTask();
      const fullPrompt = ContextBuilder.buildFullPrompt(
        task,
        [...node.decisionPath],
      );

      const executeOpts: ExecuteOpts = {
        prompt: fullPrompt,
        cwd,
        systemPrompt,
        model: this.config.model,
      };
      this.pool.submit(processId, executeOpts, false);
    }

    this.emitProgress();
  }

  /**
   * Fork a questioned node into child branches, one per answer option.
   * Each child gets its own worktree branched from the parent's current state.
   */
  private async forkNode(node: TreeNode, question: InterceptedQuestion): Promise<void> {
    node.setStatus("forking");
    this.pendingNodes.delete(node.id);
    this.emitActivity({
      type: "forking",
      nodeId: node.id,
      label: this.getNodeLabel(node),
      detail: `${question.options.length} branches: ${question.options.map(o => o.label).join(", ")}`,
    });

    const options = question.options;
    if (options.length === 0) {
      logger.warn(`[Node ${node.id}] Question has no options, marking completed`);
      node.setCompleted([], "");
      this.emitProgress();
      this.checkDone();
      return;
    }

    // Snapshot parent state so each child branches from the same point
    const parentWorktree = node.worktreePath ?? this.worktreeManager.getRepoRoot();
    let snapshotCommit: string | undefined;
    try {
      snapshotCommit = await this.worktreeManager.snapshot(
        parentWorktree,
        `llmception: snapshot before fork at "${question.header}"`,
      );
      node.setCommit(snapshotCommit);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Could not snapshot parent state: ${msg}`);
    }

    const provider = ProviderRegistry.create(this.config);
    const systemPrompt = ContextBuilder.buildSystemPrompt();
    const treeId = this.tree.toState().id;

    for (const option of options) {
      if (!this.tree.canGrow()) {
        logger.info(`[Node ${node.id}] Node budget exhausted, stopping fork`);
        break;
      }

      const child = this.tree.addChild(node.id, option);
      child.setStatus("running");
      this.pendingNodes.add(child.id);
      this.nodeText.set(child.id, "");

      // Create a worktree for this child
      try {
        const { worktreePath, branchName } = await this.worktreeManager.create(
          child.id,
          treeId,
          snapshotCommit,
        );
        child.setWorktree(worktreePath, branchName);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Could not create worktree for child ${child.id}: ${msg}`);
      }

      const childProcessId = `proc-${child.id}`;
      this.processNodeMap.set(childProcessId, child.id);

      // Build the prompt/opts for the child
      const childOpts = this.buildChildOpts(
        node,
        child,
        option,
        question,
        systemPrompt,
      );

      // Determine if this is a fork (native resume) or a fresh execute
      const isFork = provider.supportsFork && node.sessionId !== null;

      this.pool.submit(childProcessId, childOpts, isFork);
    }

    this.emitProgress();
    this.checkDone();
  }

  /**
   * Auto-resolve a question by picking the first option and continuing.
   * Used when depth >= maxDepth.
   */
  private async autoResolve(node: TreeNode, question: InterceptedQuestion): Promise<void> {
    logger.info(`[Node ${node.id}] Auto-resolving at depth ${node.depth}`);
    this.emitActivity({
      type: "auto_resolving",
      nodeId: node.id,
      label: this.getNodeLabel(node),
      detail: `depth ${node.depth} >= maxDepth, picking "${question.options[0]?.label ?? "first"}"`,
    });

    const options = question.options;
    if (options.length === 0) {
      node.setCompleted([], "");
      this.pendingNodes.delete(node.id);
      this.emitProgress();
      this.checkDone();
      return;
    }

    const chosenOption = options[0];

    if (!this.tree.canGrow()) {
      node.setStatus("auto-resolved");
      this.pendingNodes.delete(node.id);
      this.emitProgress();
      this.checkDone();
      return;
    }

    // Create a single child with the auto-resolved answer
    const child = this.tree.addChild(node.id, chosenOption);
    child.setStatus("running");
    node.setStatus("auto-resolved");
    this.pendingNodes.delete(node.id);
    this.pendingNodes.add(child.id);
    this.nodeText.set(child.id, "");

    // Create worktree for the child
    const treeId = this.tree.toState().id;
    try {
      const parentWorktree = node.worktreePath ?? this.worktreeManager.getRepoRoot();
      const snapshotCommit = await this.worktreeManager.snapshot(
        parentWorktree,
        `llmception: snapshot before auto-resolve at "${question.header}"`,
      );
      const { worktreePath, branchName } = await this.worktreeManager.create(
        child.id,
        treeId,
        snapshotCommit,
      );
      child.setWorktree(worktreePath, branchName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Could not create worktree for auto-resolved child: ${msg}`);
    }

    const childProcessId = `proc-${child.id}`;
    this.processNodeMap.set(childProcessId, child.id);

    const provider = ProviderRegistry.create(this.config);
    const systemPrompt = ContextBuilder.buildSystemPrompt();

    const childOpts = this.buildChildOpts(
      node,
      child,
      chosenOption,
      question,
      systemPrompt,
    );

    const isFork = provider.supportsFork && node.sessionId !== null;
    this.pool.submit(childProcessId, childOpts, isFork);

    this.emitProgress();
  }

  /**
   * Build execution options for a child node.
   */
  private buildChildOpts(
    parent: TreeNode,
    child: TreeNode,
    option: AnswerOption,
    question: InterceptedQuestion,
    systemPrompt: string,
  ): ExecuteOpts | ForkOpts {
    const answerPrompt = ContextBuilder.buildAnswerPrompt(question, option);
    const cwd = child.worktreePath ?? parent.worktreePath ?? this.worktreeManager.getRepoRoot();

    const provider = ProviderRegistry.create(this.config);

    if (provider.supportsFork && parent.sessionId) {
      // Use native session forking
      const forkOpts: ForkOpts = {
        prompt: answerPrompt,
        cwd,
        systemPrompt,
        model: this.config.model,
        parentSessionId: parent.sessionId,
      };
      return forkOpts;
    }

    // Fresh execution with full context replay
    const task = this.tree.getTask();
    const fullPrompt = ContextBuilder.buildFullPrompt(
      task,
      [...child.decisionPath],
    );

    const executeOpts: ExecuteOpts = {
      prompt: fullPrompt,
      cwd,
      systemPrompt,
      model: this.config.model,
    };
    return executeOpts;
  }

  /**
   * Called when a pool process finishes (whether by completion or error).
   */
  private handleProcessComplete(processId: string): void {
    const nodeId = this.processNodeMap.get(processId);
    if (!nodeId) return;

    // Skip if this node is already waiting for a retry timer
    if (this.retryingNodes.has(nodeId)) return;

    // If the node is still marked as running (no result/error event came),
    // treat it as a retryable failure
    const node = this.tree.getNode(nodeId);
    if (node && node.status === "running") {
      this.handleError(node, "Process ended without result");
      return;
    }

    this.checkDone();
  }

  /**
   * Check if exploration is complete (no pending nodes or running processes).
   */
  private checkDone(): void {
    if (
      this.pendingNodes.size === 0 &&
      this.retryingNodes.size === 0 &&
      this.pool.getRunningCount() === 0 &&
      this.pool.getPendingCount() === 0
    ) {
      if (this.resolveExplore) {
        const resolve = this.resolveExplore;
        this.resolveExplore = null;
        resolve();
      }
    }
  }

  private getNodeLabel(node: TreeNode): string {
    if (node.depth === 0) return "ROOT";
    if (node.answer) return node.answer.label;
    return `node-${node.id.slice(0, 8)}`;
  }

  private emitProgress(): void {
    for (const cb of this.progressCallbacks) {
      try {
        cb(this.tree);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Progress callback error: ${msg}`);
      }
    }
  }

  private emitActivity(event: ActivityEvent): void {
    for (const cb of this.activityCallbacks) {
      try {
        cb(event);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Activity callback error: ${msg}`);
      }
    }
  }
}
