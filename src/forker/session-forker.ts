import type { LlmceptionConfig } from "../types.js";

/**
 * Builds CLI argument arrays for spawning Claude Code sessions.
 * Handles initial execution, forking from parent sessions, permission modes, and budget caps.
 */
export class SessionForker {
  private config: LlmceptionConfig;

  constructor(config: LlmceptionConfig) {
    this.config = config;
  }

  /**
   * Build CLI args for initial execution of a prompt.
   */
  buildExecuteArgs(opts: {
    prompt: string;
    cwd: string;
    systemPrompt: string;
    maxBudgetUsd?: number;
    model?: string;
  }): string[] {
    const model = opts.model ?? this.config.model;

    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      opts.systemPrompt,
      "--model",
      model,
      "--max-turns",
      "50",
    ];

    if (opts.maxBudgetUsd !== undefined && this.isMetered()) {
      args.push("--max-budget-usd", String(opts.maxBudgetUsd));
    }

    args.push(...this.getPermissionFlag());
    args.push(opts.prompt);

    return args;
  }

  /**
   * Build CLI args for forking from an existing session.
   */
  buildForkArgs(opts: {
    parentSessionId: string;
    answer: string;
    systemPrompt: string;
    maxBudgetUsd?: number;
    model?: string;
  }): string[] {
    const model = opts.model ?? this.config.model;

    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--resume",
      opts.parentSessionId,
      "--append-system-prompt",
      opts.systemPrompt,
      "--model",
      model,
      "--max-turns",
      "50",
    ];

    if (opts.maxBudgetUsd !== undefined && this.isMetered()) {
      args.push("--max-budget-usd", String(opts.maxBudgetUsd));
    }

    args.push(...this.getPermissionFlag());
    args.push(opts.answer);

    return args;
  }

  /**
   * Return the appropriate permission flags based on config.permissionMode.
   */
  getPermissionFlag(): string[] {
    switch (this.config.permissionMode) {
      case "acceptEdits":
        return ["--allowedTools", "Edit,Write,Read,Glob,Grep,Bash"];
      case "bypassPermissions":
        return ["--dangerously-skip-permissions"];
      case "auto":
      default:
        return [];
    }
  }

  /**
   * Check if the current provider uses metered pricing.
   */
  private isMetered(): boolean {
    // claude-cli is subscription-based; anthropic API is metered
    // For now, treat "anthropic" and "openai" as metered, rest as not
    return (
      this.config.provider === "anthropic" ||
      this.config.provider === "openai"
    );
  }
}
