import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  ExecutionProvider,
  ExecuteOpts,
  ForkOpts,
  StreamEvent,
  PricingModel,
  ProviderType,
  LlmceptionConfig,
} from "../types.js";
import { StreamParser } from "../interceptor/stream-parser.js";
import { SessionForker } from "../forker/session-forker.js";
import { ContextBuilder } from "../forker/context-builder.js";
import { logger } from "../util/logger.js";

/**
 * Provider that executes tasks via the Claude Code CLI.
 * Spawns a child process and parses stream-json output.
 */
export class ClaudeCliProvider implements ExecutionProvider {
  readonly name = "Claude Code CLI";
  readonly type: ProviderType = "claude-cli";
  readonly pricing: PricingModel = "subscription";
  readonly supportsFork = true;

  private config: LlmceptionConfig;
  private sessionForker: SessionForker;
  private activeProcess: ChildProcess | null = null;

  constructor(config: LlmceptionConfig) {
    this.config = config;
    this.sessionForker = new SessionForker(config);
  }

  async *execute(opts: ExecuteOpts): AsyncGenerator<StreamEvent> {
    const systemPrompt = opts.systemPrompt ?? ContextBuilder.buildSystemPrompt();
    const args = this.sessionForker.buildExecuteArgs({
      prompt: opts.prompt,
      cwd: opts.cwd,
      systemPrompt,
      maxBudgetUsd: opts.maxBudgetUsd,
      model: opts.model,
    });

    if (opts.additionalFlags) {
      args.push(...opts.additionalFlags);
    }

    yield* this.spawnAndParse(args, opts.cwd);
  }

  async *fork(opts: ForkOpts): AsyncGenerator<StreamEvent> {
    const systemPrompt = opts.systemPrompt ?? ContextBuilder.buildSystemPrompt();
    const args = this.sessionForker.buildForkArgs({
      parentSessionId: opts.parentSessionId,
      answer: opts.prompt,
      systemPrompt,
      maxBudgetUsd: opts.maxBudgetUsd,
      model: opts.model,
    });

    if (opts.additionalFlags) {
      args.push(...opts.additionalFlags);
    }

    yield* this.spawnAndParse(args, opts.cwd);
  }

  /** Kill the active child process if one is running. */
  kill(): void {
    if (this.activeProcess && !this.activeProcess.killed) {
      this.activeProcess.kill("SIGTERM");
      this.activeProcess = null;
    }
  }

  private async *spawnAndParse(
    args: string[],
    cwd: string,
  ): AsyncGenerator<StreamEvent> {
    const parser = new StreamParser();
    const execPath = this.config.claudeCodePath;

    logger.debug(`Spawning: ${execPath} ${args.join(" ").slice(0, 200)}...`);

    const child = spawn(execPath, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Close stdin immediately — prompt is passed as a positional arg,
    // not via stdin. Leaving stdin open causes Claude Code to wait for input.
    child.stdin?.end();

    this.activeProcess = child;

    // Collect stderr for error reporting
    let stderrBuf = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    // Create a promise that resolves when the process exits
    const exitPromise = new Promise<number>((resolve) => {
      child.on("close", (code) => {
        resolve(code ?? 1);
      });
      child.on("error", (err) => {
        logger.error(`Process spawn error: ${err.message}`);
        resolve(1);
      });
    });

    // Read stdout line-by-line via readline
    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

    const lineIterator = rl[Symbol.asyncIterator]();
    let lineResult = await lineIterator.next();

    while (!lineResult.done) {
      const line = lineResult.value as string;
      const events = parser.parseLine(line);
      for (const event of events) {
        yield event;
      }
      lineResult = await lineIterator.next();
    }

    // Wait for process to exit
    const exitCode = await exitPromise;
    this.activeProcess = null;

    if (exitCode !== 0) {
      const errorMsg = stderrBuf.trim() || `Process exited with code ${exitCode}`;
      logger.warn(`Claude CLI exited with code ${exitCode}: ${errorMsg.slice(0, 200)}`);
      yield { type: "error", message: errorMsg };
    }
  }
}
