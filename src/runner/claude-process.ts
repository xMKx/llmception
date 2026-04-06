import type {
  ExecutionProvider,
  ExecuteOpts,
  ForkOpts,
  StreamEvent,
} from "../types.js";
import { logger } from "../util/logger.js";

export type ProcessStatus = "idle" | "running" | "completed" | "failed" | "aborted";

/**
 * Wraps a single LLM subprocess execution.
 * Tracks status and session ID, delegates to the underlying provider.
 */
export class ClaudeProcess {
  readonly id: string;
  private provider: ExecutionProvider;
  private _status: ProcessStatus = "idle";
  private _sessionId: string | null = null;
  private _aborted = false;

  constructor(id: string, provider: ExecutionProvider) {
    this.id = id;
    this.provider = provider;
  }

  get status(): ProcessStatus {
    return this._status;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  /**
   * Run an execute operation, yielding stream events.
   * Updates internal status and captures session ID from init events.
   */
  async *run(opts: ExecuteOpts): AsyncGenerator<StreamEvent> {
    if (this._aborted) {
      yield { type: "error", message: "Process was aborted before starting" };
      this._status = "aborted";
      return;
    }

    this._status = "running";
    logger.debug(`[Process ${this.id}] Starting execute`);

    try {
      for await (const event of this.provider.execute(opts)) {
        if (this._aborted) {
          this._status = "aborted";
          yield { type: "error", message: "Process aborted" };
          return;
        }

        this.trackEvent(event);
        yield event;
      }

      if (this._status === "running") {
        this._status = "completed";
      }
    } catch (err: unknown) {
      this._status = "failed";
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Process ${this.id}] Execute failed: ${msg}`);
      yield { type: "error", message: msg };
    }
  }

  /**
   * Run a fork operation, yielding stream events.
   */
  async *runFork(opts: ForkOpts): AsyncGenerator<StreamEvent> {
    if (this._aborted) {
      yield { type: "error", message: "Process was aborted before starting" };
      this._status = "aborted";
      return;
    }

    this._status = "running";
    logger.debug(`[Process ${this.id}] Starting fork from ${opts.parentSessionId}`);

    try {
      for await (const event of this.provider.fork(opts)) {
        if (this._aborted) {
          this._status = "aborted";
          yield { type: "error", message: "Process aborted" };
          return;
        }

        this.trackEvent(event);
        yield event;
      }

      if (this._status === "running") {
        this._status = "completed";
      }
    } catch (err: unknown) {
      this._status = "failed";
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Process ${this.id}] Fork failed: ${msg}`);
      yield { type: "error", message: msg };
    }
  }

  /**
   * Abort the running process.
   */
  abort(): void {
    this._aborted = true;
    if (this._status === "running") {
      this._status = "aborted";
    }
    // Attempt to kill the underlying provider process
    const killable = this.provider as { kill?: () => void };
    if (typeof killable.kill === "function") {
      killable.kill();
    }
    logger.debug(`[Process ${this.id}] Aborted`);
  }

  private trackEvent(event: StreamEvent): void {
    if (event.type === "init") {
      this._sessionId = event.sessionId;
    }
    if (event.type === "error") {
      this._status = "failed";
    }
    if (event.type === "result") {
      this._status = "completed";
    }
  }
}
