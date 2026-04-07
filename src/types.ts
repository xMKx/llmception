/** Status of a tree node's LLM execution */
export type NodeStatus =
  | "pending"
  | "running"
  | "questioned"
  | "forking"
  | "completed"
  | "failed"
  | "pruned"
  | "auto-resolved";

/** A single answer option extracted from a question */
export interface AnswerOption {
  /** Short label (e.g. "OAuth2 with Google") */
  label: string;
  /** Longer description of tradeoffs */
  description: string;
  /** The verbatim text to inject into the child session as the answer */
  answerText: string;
}

/** A question intercepted at a decision point */
export interface InterceptedQuestion {
  /** The full question text */
  question: string;
  /** Short header/title for display */
  header: string;
  /** Available answer options (N-ary, capped at maxWidth) */
  options: AnswerOption[];
  /** Raw tool call input, if available */
  rawToolInput?: unknown;
}

/** Provider pricing model */
export type PricingModel = "subscription" | "metered" | "free";

/** Provider type identifier */
export type ProviderType = "claude-cli" | "anthropic" | "openai" | "ollama";

/** Token usage from an LLM call */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/** Budget enforcement mode */
export type BudgetMode = "none" | "warn" | "hard";

/** Budget configuration */
export interface BudgetConfig {
  perBranchUsd: number;
  totalUsd: number;
  mode: BudgetMode;
}

/** Provider-specific configuration */
export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/** Full llmception configuration */
export interface LlmceptionConfig {
  /** Active provider */
  provider: ProviderType;
  /** Max tree depth before auto-resolving */
  maxDepth: number;
  /** Max answer options per question */
  maxWidth: number;
  /** Max total nodes in the tree */
  nodeBudget: number;
  /** Max concurrent LLM processes */
  concurrency: number;
  /** Budget configuration */
  budget: BudgetConfig;
  /** Timeout per branch in milliseconds */
  branchTimeoutMs: number;
  /** Model to use for execution */
  model: string;
  /** Permission mode for Claude Code CLI */
  permissionMode: "auto" | "acceptEdits" | "bypassPermissions";
  /** Path to Claude Code executable */
  claudeCodePath: string;
  /** Provider-specific configs */
  providers: Partial<Record<ProviderType, ProviderConfig>>;
}

/** Persistent state of a single tree node */
export interface TreeNodeState {
  /** Unique node ID */
  id: string;
  /** Parent node ID (null for root) */
  parentId: string | null;
  /** Depth in the tree (0 for root) */
  depth: number;
  /** The answer that led to this node (null for root) */
  answer: AnswerOption | null;
  /** The question asked AT this node (null if leaf/not yet questioned) */
  question: InterceptedQuestion | null;
  /** Current status */
  status: NodeStatus;
  /** LLM session ID (for providers that support forking) */
  sessionId: string | null;
  /** Git commit hash at this node's state */
  commitHash: string | null;
  /** Git branch name for this node's worktree */
  branchName: string | null;
  /** Worktree path on disk */
  worktreePath: string | null;
  /** Child node IDs */
  childIds: string[];
  /** Accumulated cost in USD */
  costUsd: number;
  /** Token usage */
  tokenUsage: TokenUsage;
  /** The full chain of decisions from root to this node */
  decisionPath: DecisionStep[];
  /** Timestamp when this node was created */
  createdAt: string;
  /** Timestamp when this node completed/failed */
  finishedAt: string | null;
  /** Error message if failed */
  error: string | null;
  /** Files changed by this node's execution */
  filesChanged: string[];
  /** Diff stat summary (e.g. "+342/-0  8 files") */
  diffStat: string | null;
}

/** A single step in the decision path */
export interface DecisionStep {
  question: string;
  answer: string;
}

/** The full decision tree state (serializable) */
export interface DecisionTreeState {
  /** Tree ID */
  id: string;
  /** Original task prompt */
  task: string;
  /** Configuration used */
  config: LlmceptionConfig;
  /** All nodes keyed by ID */
  nodes: Record<string, TreeNodeState>;
  /** Root node ID */
  rootId: string;
  /** Total accumulated cost */
  totalCostUsd: number;
  /** Total nodes created (including pruned) */
  totalNodesCreated: number;
  /** Timestamp */
  createdAt: string;
  /** Last update */
  updatedAt: string;
}

/** Events emitted from the stream parser */
export type StreamEvent =
  | { type: "init"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown; toolUseId: string }
  | { type: "tool_result"; toolUseId: string; content: string }
  | { type: "ask_user"; question: InterceptedQuestion }
  | { type: "result"; costUsd: number; sessionId: string; tokenUsage: TokenUsage }
  | { type: "error"; message: string };

/** Options for executing a prompt via a provider */
export interface ExecuteOpts {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  model?: string;
  maxBudgetUsd?: number;
  additionalFlags?: string[];
}

/** Options for forking an existing session */
export interface ForkOpts extends ExecuteOpts {
  parentSessionId: string;
}

/** Execution provider interface */
export interface ExecutionProvider {
  readonly name: string;
  readonly type: ProviderType;
  readonly pricing: PricingModel;
  readonly supportsFork: boolean;

  execute(opts: ExecuteOpts): AsyncGenerator<StreamEvent>;
  fork(opts: ForkOpts): AsyncGenerator<StreamEvent>;
}

/** Stats for display */
export interface TreeStats {
  totalNodes: number;
  completedNodes: number;
  runningNodes: number;
  pendingNodes: number;
  failedNodes: number;
  prunedNodes: number;
  questionedNodes: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  maxDepthReached: number;
  completedLeaves: number;
}
