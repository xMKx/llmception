import type {
  TreeNodeState,
  InterceptedQuestion,
  NodeStatus,
  TokenUsage,
} from "../types.js";

/**
 * Wraps a TreeNodeState providing convenient mutation methods.
 * All mutations happen in-place on the internal state.
 */
export class TreeNode {
  private state: TreeNodeState;

  constructor(state: TreeNodeState) {
    this.state = state;
  }

  /** Unique node ID */
  get id(): string {
    return this.state.id;
  }

  /** Parent node ID (null for root) */
  get parentId(): string | null {
    return this.state.parentId;
  }

  /** Depth in the tree */
  get depth(): number {
    return this.state.depth;
  }

  /** Current status */
  get status(): NodeStatus {
    return this.state.status;
  }

  /** Child IDs */
  get childIds(): readonly string[] {
    return this.state.childIds;
  }

  /** The question asked at this node, if any */
  get question(): InterceptedQuestion | null {
    return this.state.question;
  }

  /** The answer that led to this node (null for root) */
  get answer(): TreeNodeState["answer"] {
    return this.state.answer;
  }

  /** Decision path from root to this node */
  get decisionPath(): readonly TreeNodeState["decisionPath"][number][] {
    return this.state.decisionPath;
  }

  /** Accumulated cost in USD */
  get costUsd(): number {
    return this.state.costUsd;
  }

  /** Token usage stats */
  get tokenUsage(): TokenUsage {
    return this.state.tokenUsage;
  }

  /** Session ID */
  get sessionId(): string | null {
    return this.state.sessionId;
  }

  /** Git commit hash */
  get commitHash(): string | null {
    return this.state.commitHash;
  }

  /** Git branch name */
  get branchName(): string | null {
    return this.state.branchName;
  }

  /** Worktree path on disk */
  get worktreePath(): string | null {
    return this.state.worktreePath;
  }

  /** Error message if failed */
  get error(): string | null {
    return this.state.error;
  }

  /** Files changed by this node's execution */
  get filesChanged(): readonly string[] {
    return this.state.filesChanged;
  }

  /** Diff stat summary */
  get diffStat(): string | null {
    return this.state.diffStat;
  }

  /** When this node was created */
  get createdAt(): string {
    return this.state.createdAt;
  }

  /** When this node finished */
  get finishedAt(): string | null {
    return this.state.finishedAt;
  }

  /** Add a child node ID to this node */
  addChild(childId: string): void {
    if (!this.state.childIds.includes(childId)) {
      this.state.childIds.push(childId);
    }
  }

  /** Set the intercepted question at this node */
  setQuestion(question: InterceptedQuestion): void {
    this.state.question = question;
    this.state.status = "questioned";
  }

  /** Update this node's status */
  setStatus(status: NodeStatus): void {
    this.state.status = status;
    if (
      status === "completed" ||
      status === "failed" ||
      status === "pruned"
    ) {
      this.state.finishedAt = new Date().toISOString();
    }
  }

  /** Set the LLM session ID */
  setSessionId(sessionId: string): void {
    this.state.sessionId = sessionId;
  }

  /** Set the git commit hash */
  setCommit(hash: string): void {
    this.state.commitHash = hash;
  }

  /** Set the worktree path and branch */
  setWorktree(path: string, branch: string): void {
    this.state.worktreePath = path;
    this.state.branchName = branch;
  }

  /** Mark this node as completed with file changes */
  setCompleted(filesChanged: string[], diffStat: string): void {
    this.state.filesChanged = filesChanged;
    this.state.diffStat = diffStat;
    this.state.status = "completed";
    this.state.finishedAt = new Date().toISOString();
  }

  /** Mark this node as failed with an error */
  setFailed(error: string): void {
    this.state.error = error;
    this.state.status = "failed";
    this.state.finishedAt = new Date().toISOString();
  }

  /** Set cost and token usage */
  setCost(usage: TokenUsage): void {
    this.state.tokenUsage = usage;
    this.state.costUsd = usage.costUsd;
  }

  /** Whether this node has no children */
  isLeaf(): boolean {
    return this.state.childIds.length === 0;
  }

  /** Whether this node has completed execution */
  isComplete(): boolean {
    return this.state.status === "completed";
  }

  /** Returns a deep copy of the internal state */
  toState(): TreeNodeState {
    return structuredClone(this.state);
  }
}
