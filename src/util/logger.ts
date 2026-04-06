type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "[DEBUG]",
  info: "[INFO]",
  warn: "[WARN]",
  error: "[ERROR]",
};

let currentLevel: LogLevel = resolveInitialLevel();

function resolveInitialLevel(): LogLevel {
  const env = process.env.LLMCEPTION_DEBUG;
  if (!env) return "warn";
  if (env === "1") return "debug";
  if (env in LOG_LEVELS) return env as LogLevel;
  return "warn";
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function log(level: LogLevel, msg: string, ...args: unknown[]): void {
  if (!shouldLog(level)) return;
  console.error(LEVEL_LABELS[level], msg, ...args);
}

export const logger = {
  debug(msg: string, ...args: unknown[]): void {
    log("debug", msg, ...args);
  },
  info(msg: string, ...args: unknown[]): void {
    log("info", msg, ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    log("warn", msg, ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    log("error", msg, ...args);
  },
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}
