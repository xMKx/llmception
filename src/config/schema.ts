import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { LlmceptionConfig } from "../types.js";

/** Sensible default configuration. */
export const DEFAULT_CONFIG: LlmceptionConfig = {
  provider: "claude-cli",
  maxDepth: 3,
  maxWidth: 4,
  nodeBudget: 20,
  concurrency: 3,
  budget: { perBranchUsd: 5.0, totalUsd: 25.0, mode: "hard" },
  branchTimeoutMs: 300_000,
  model: "sonnet",
  permissionMode: "auto",
  claudeCodePath: "claude",
  providers: {},
};

/**
 * Deep merge two configs. Override values replace base values.
 * Nested objects are merged recursively.
 */
export function mergeConfigs(
  base: LlmceptionConfig,
  override: Partial<LlmceptionConfig>,
): LlmceptionConfig {
  const result = { ...base };

  for (const key of Object.keys(override) as Array<keyof LlmceptionConfig>) {
    const val = override[key];
    if (val === undefined) continue;

    if (
      key === "budget" &&
      typeof val === "object" &&
      val !== null &&
      !Array.isArray(val)
    ) {
      result.budget = { ...result.budget, ...(val as Partial<LlmceptionConfig["budget"]>) };
    } else if (
      key === "providers" &&
      typeof val === "object" &&
      val !== null &&
      !Array.isArray(val)
    ) {
      result.providers = { ...result.providers, ...(val as LlmceptionConfig["providers"]) };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = val;
    }
  }

  return result;
}

/**
 * Validate a config and return a list of errors (empty means valid).
 */
export function validateConfig(config: LlmceptionConfig): string[] {
  const errors: string[] = [];

  if (config.maxDepth < 1) {
    errors.push("maxDepth must be >= 1");
  }
  if (config.maxWidth < 2) {
    errors.push("maxWidth must be >= 2");
  }
  if (config.nodeBudget < 2) {
    errors.push("nodeBudget must be >= 2");
  }
  if (config.concurrency < 1) {
    errors.push("concurrency must be >= 1");
  }
  if (config.budget.perBranchUsd < 0) {
    errors.push("budget.perBranchUsd must be >= 0");
  }
  if (config.budget.totalUsd < 0) {
    errors.push("budget.totalUsd must be >= 0");
  }

  return errors;
}

/** Read and parse a JSON file, returning null if it doesn't exist. */
async function readJsonFile(path: string): Promise<Partial<LlmceptionConfig> | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as Partial<LlmceptionConfig>;
  } catch {
    return null;
  }
}

/** Apply environment variable overrides to a config. */
function applyEnvOverrides(config: LlmceptionConfig): LlmceptionConfig {
  const result = { ...config, budget: { ...config.budget }, providers: { ...config.providers } };

  const provider = process.env.LLMCEPTION_PROVIDER;
  if (provider) {
    result.provider = provider as LlmceptionConfig["provider"];
  }

  const maxDepth = process.env.LLMCEPTION_MAX_DEPTH;
  if (maxDepth) {
    const parsed = parseInt(maxDepth, 10);
    if (!Number.isNaN(parsed)) result.maxDepth = parsed;
  }

  const maxWidth = process.env.LLMCEPTION_MAX_WIDTH;
  if (maxWidth) {
    const parsed = parseInt(maxWidth, 10);
    if (!Number.isNaN(parsed)) result.maxWidth = parsed;
  }

  const nodeBudget = process.env.LLMCEPTION_NODE_BUDGET;
  if (nodeBudget) {
    const parsed = parseInt(nodeBudget, 10);
    if (!Number.isNaN(parsed)) result.nodeBudget = parsed;
  }

  const concurrency = process.env.LLMCEPTION_CONCURRENCY;
  if (concurrency) {
    const parsed = parseInt(concurrency, 10);
    if (!Number.isNaN(parsed)) result.concurrency = parsed;
  }

  const model = process.env.LLMCEPTION_MODEL;
  if (model) {
    result.model = model;
  }

  return result;
}

/**
 * Load configuration by deep merging:
 *   DEFAULT_CONFIG <- global config <- project config <- env vars
 */
export async function loadConfig(cwd: string): Promise<LlmceptionConfig> {
  let config = structuredClone(DEFAULT_CONFIG);

  // Global config: ~/.llmception/config.json
  const globalPath = join(homedir(), ".llmception", "config.json");
  const globalOverrides = await readJsonFile(globalPath);
  if (globalOverrides) {
    config = mergeConfigs(config, globalOverrides);
  }

  // Project config: <cwd>/.llmception.json
  const projectPath = join(cwd, ".llmception.json");
  const projectOverrides = await readJsonFile(projectPath);
  if (projectOverrides) {
    config = mergeConfigs(config, projectOverrides);
  }

  // Environment variable overrides
  config = applyEnvOverrides(config);

  return config;
}
