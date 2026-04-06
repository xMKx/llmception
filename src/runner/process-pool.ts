import type {
  ExecutionProvider,
  ExecuteOpts,
  ForkOpts,
  StreamEvent,
  LlmceptionConfig,
} from "../types.js";
import { ClaudeProcess } from "./claude-process.js";
import { logger } from "../util/logger.js";

interface QueueEntry {
  id: string;
  opts: ExecuteOpts | ForkOpts;
  isFork: boolean;
}

type EventCallback = (id: string, event: StreamEvent) => void;
type CompleteCallback = (id: string) => void;

/**
 * Manages concurrent LLM process execution with a configurable concurrency limit.
 * Processes are queued and executed in FIFO order, respecting the max concurrency.
 */
export class ProcessPool {
  private config: LlmceptionConfig;
  private provider: ExecutionProvider;
  private queue: QueueEntry[] = [];
  private running: Map<string, ClaudeProcess> = new Map();
  private eventCallbacks: EventCallback[] = [];
  private completeCallbacks: CompleteCallback[] = [];
  private stopped = false;
  private draining = false;

  constructor(config: LlmceptionConfig, provider: ExecutionProvider) {
    this.config = config;
    this.provider = provider;
  }

  /**
   * Add a process to the execution queue.
   */
  submit(id: string, opts: ExecuteOpts | ForkOpts, isFork: boolean): void {
    if (this.stopped) {
      logger.warn(`Pool is stopped, rejecting submission ${id}`);
      return;
    }
    this.queue.push({ id, opts, isFork });
    logger.debug(`[Pool] Queued ${id} (fork=${isFork}), pending=${this.queue.length}`);
    this.drain();
  }

  /**
   * Register a callback for stream events from any process.
   */
  onEvent(callback: EventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Register a callback for process completion.
   */
  onComplete(callback: CompleteCallback): void {
    this.completeCallbacks.push(callback);
  }

  /**
   * Begin processing the queue. Called automatically on submit,
   * but can also be called explicitly.
   */
  start(): void {
    this.stopped = false;
    this.drain();
  }

  /**
   * Stop the pool: reject new submissions and abort all running processes.
   */
  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    for (const [id, proc] of this.running) {
      logger.debug(`[Pool] Aborting running process ${id}`);
      proc.abort();
    }
  }

  /**
   * Get the number of currently running processes.
   */
  getRunningCount(): number {
    return this.running.size;
  }

  /**
   * Get the number of processes waiting in the queue.
   */
  getPendingCount(): number {
    return this.queue.length;
  }

  /**
   * Returns a promise that resolves when all queued and running work is done.
   */
  async waitForAll(): Promise<void> {
    while (this.queue.length > 0 || this.running.size > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Try to start processes from the queue up to the concurrency limit.
   */
  private drain(): void {
    if (this.draining) return;
    this.draining = true;

    while (
      !this.stopped &&
      this.queue.length > 0 &&
      this.running.size < this.config.concurrency
    ) {
      const entry = this.queue.shift()!;
      this.startProcess(entry);
    }

    this.draining = false;
  }

  private startProcess(entry: QueueEntry): void {
    const process = new ClaudeProcess(entry.id, this.provider);
    this.running.set(entry.id, process);

    logger.debug(`[Pool] Starting ${entry.id}, running=${this.running.size}`);

    const generator = entry.isFork
      ? process.runFork(entry.opts as ForkOpts)
      : process.run(entry.opts);

    // Run the generator asynchronously
    this.consumeGenerator(entry.id, generator).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Pool] Unexpected error consuming ${entry.id}: ${msg}`);
      this.emitEvent(entry.id, { type: "error", message: msg });
      this.handleComplete(entry.id);
    });
  }

  private async consumeGenerator(
    id: string,
    gen: AsyncGenerator<StreamEvent>,
  ): Promise<void> {
    try {
      for await (const event of gen) {
        this.emitEvent(id, event);
      }
    } finally {
      this.handleComplete(id);
    }
  }

  private emitEvent(id: string, event: StreamEvent): void {
    for (const cb of this.eventCallbacks) {
      try {
        cb(id, event);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[Pool] Event callback error: ${msg}`);
      }
    }
  }

  private handleComplete(id: string): void {
    this.running.delete(id);
    logger.debug(`[Pool] Completed ${id}, running=${this.running.size}, pending=${this.queue.length}`);

    for (const cb of this.completeCallbacks) {
      try {
        cb(id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[Pool] Complete callback error: ${msg}`);
      }
    }

    // Try to start more processes from the queue
    this.drain();
  }
}
