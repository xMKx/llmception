import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_CONFIG,
  validateConfig,
  mergeConfigs,
  loadConfig,
} from "../../../src/config/schema.js";
import type { LlmceptionConfig } from "../../../src/types.js";

describe("DEFAULT_CONFIG", () => {
  it("should have claude-cli as provider", () => {
    expect(DEFAULT_CONFIG.provider).toBe("claude-cli");
  });

  it("should have maxDepth of 3", () => {
    expect(DEFAULT_CONFIG.maxDepth).toBe(3);
  });

  it("should have maxWidth of 4", () => {
    expect(DEFAULT_CONFIG.maxWidth).toBe(4);
  });

  it("should have nodeBudget of 20", () => {
    expect(DEFAULT_CONFIG.nodeBudget).toBe(20);
  });

  it("should have concurrency of 3", () => {
    expect(DEFAULT_CONFIG.concurrency).toBe(3);
  });

  it("should have hard budget mode", () => {
    expect(DEFAULT_CONFIG.budget.mode).toBe("hard");
  });

  it("should have perBranchUsd of 5", () => {
    expect(DEFAULT_CONFIG.budget.perBranchUsd).toBe(5.0);
  });

  it("should have totalUsd of 25", () => {
    expect(DEFAULT_CONFIG.budget.totalUsd).toBe(25.0);
  });

  it("should have branchTimeoutMs of 300000", () => {
    expect(DEFAULT_CONFIG.branchTimeoutMs).toBe(300_000);
  });

  it("should have model as sonnet", () => {
    expect(DEFAULT_CONFIG.model).toBe("sonnet");
  });

  it("should have permissionMode as auto", () => {
    expect(DEFAULT_CONFIG.permissionMode).toBe("auto");
  });

  it("should have claudeCodePath as claude", () => {
    expect(DEFAULT_CONFIG.claudeCodePath).toBe("claude");
  });

  it("should have empty providers", () => {
    expect(DEFAULT_CONFIG.providers).toEqual({});
  });
});

describe("validateConfig", () => {
  it("should return empty array for valid config", () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
  });

  it("should catch maxDepth < 1", () => {
    const config = { ...DEFAULT_CONFIG, maxDepth: 0 };
    const errors = validateConfig(config);
    expect(errors).toContain("maxDepth must be >= 1");
  });

  it("should catch maxWidth < 2", () => {
    const config = { ...DEFAULT_CONFIG, maxWidth: 1 };
    const errors = validateConfig(config);
    expect(errors).toContain("maxWidth must be >= 2");
  });

  it("should catch nodeBudget < 2", () => {
    const config = { ...DEFAULT_CONFIG, nodeBudget: -1 };
    const errors = validateConfig(config);
    expect(errors).toContain("nodeBudget must be >= 2");
  });

  it("should catch concurrency < 1", () => {
    const config = { ...DEFAULT_CONFIG, concurrency: 0 };
    const errors = validateConfig(config);
    expect(errors).toContain("concurrency must be >= 1");
  });

  it("should catch negative perBranchUsd", () => {
    const config = {
      ...DEFAULT_CONFIG,
      budget: { ...DEFAULT_CONFIG.budget, perBranchUsd: -1 },
    };
    const errors = validateConfig(config);
    expect(errors).toContain("budget.perBranchUsd must be >= 0");
  });

  it("should catch negative totalUsd", () => {
    const config = {
      ...DEFAULT_CONFIG,
      budget: { ...DEFAULT_CONFIG.budget, totalUsd: -5 },
    };
    const errors = validateConfig(config);
    expect(errors).toContain("budget.totalUsd must be >= 0");
  });

  it("should return multiple errors at once", () => {
    const config = {
      ...DEFAULT_CONFIG,
      maxDepth: 0,
      maxWidth: 1,
      nodeBudget: 0,
    };
    const errors = validateConfig(config);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("mergeConfigs", () => {
  it("should override top-level scalar fields", () => {
    const result = mergeConfigs(DEFAULT_CONFIG, { maxDepth: 10 });
    expect(result.maxDepth).toBe(10);
    // Other fields unchanged
    expect(result.maxWidth).toBe(DEFAULT_CONFIG.maxWidth);
  });

  it("should deep merge budget object", () => {
    const result = mergeConfigs(DEFAULT_CONFIG, {
      budget: { perBranchUsd: 10 } as LlmceptionConfig["budget"],
    });
    expect(result.budget.perBranchUsd).toBe(10);
    // Other budget fields preserved
    expect(result.budget.totalUsd).toBe(DEFAULT_CONFIG.budget.totalUsd);
    expect(result.budget.mode).toBe(DEFAULT_CONFIG.budget.mode);
  });

  it("should deep merge providers object", () => {
    const result = mergeConfigs(DEFAULT_CONFIG, {
      providers: { anthropic: { apiKey: "sk-test" } },
    });
    expect(result.providers.anthropic?.apiKey).toBe("sk-test");
  });

  it("should not mutate the base config", () => {
    const base = structuredClone(DEFAULT_CONFIG);
    mergeConfigs(base, { maxDepth: 99 });
    expect(base.maxDepth).toBe(DEFAULT_CONFIG.maxDepth);
  });

  it("should skip undefined override values", () => {
    const result = mergeConfigs(DEFAULT_CONFIG, { maxDepth: undefined });
    expect(result.maxDepth).toBe(DEFAULT_CONFIG.maxDepth);
  });
});

describe("loadConfig", () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const envVars = [
    "LLMCEPTION_PROVIDER",
    "LLMCEPTION_MAX_DEPTH",
    "LLMCEPTION_MAX_WIDTH",
    "LLMCEPTION_NODE_BUDGET",
    "LLMCEPTION_CONCURRENCY",
    "LLMCEPTION_MODEL",
  ];

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `llmception-config-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    // Save and clear env vars
    for (const key of envVars) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    // Restore env vars
    for (const key of envVars) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should return defaults when no config files exist", async () => {
    const config = await loadConfig(tmpDir);
    expect(config.provider).toBe(DEFAULT_CONFIG.provider);
    expect(config.maxDepth).toBe(DEFAULT_CONFIG.maxDepth);
    expect(config.maxWidth).toBe(DEFAULT_CONFIG.maxWidth);
    expect(config.nodeBudget).toBe(DEFAULT_CONFIG.nodeBudget);
  });

  it("should load project config from .llmception.json", async () => {
    await writeFile(
      join(tmpDir, ".llmception.json"),
      JSON.stringify({ maxDepth: 7, model: "opus" }),
    );
    const config = await loadConfig(tmpDir);
    expect(config.maxDepth).toBe(7);
    expect(config.model).toBe("opus");
    // Other fields remain default
    expect(config.maxWidth).toBe(DEFAULT_CONFIG.maxWidth);
  });

  it("should override with LLMCEPTION_MAX_DEPTH env var", async () => {
    process.env.LLMCEPTION_MAX_DEPTH = "12";
    const config = await loadConfig(tmpDir);
    expect(config.maxDepth).toBe(12);
  });

  it("should override with LLMCEPTION_MAX_WIDTH env var", async () => {
    process.env.LLMCEPTION_MAX_WIDTH = "6";
    const config = await loadConfig(tmpDir);
    expect(config.maxWidth).toBe(6);
  });

  it("should override with LLMCEPTION_NODE_BUDGET env var", async () => {
    process.env.LLMCEPTION_NODE_BUDGET = "50";
    const config = await loadConfig(tmpDir);
    expect(config.nodeBudget).toBe(50);
  });

  it("should override with LLMCEPTION_CONCURRENCY env var", async () => {
    process.env.LLMCEPTION_CONCURRENCY = "8";
    const config = await loadConfig(tmpDir);
    expect(config.concurrency).toBe(8);
  });

  it("should override with LLMCEPTION_MODEL env var", async () => {
    process.env.LLMCEPTION_MODEL = "haiku";
    const config = await loadConfig(tmpDir);
    expect(config.model).toBe("haiku");
  });

  it("should override with LLMCEPTION_PROVIDER env var", async () => {
    process.env.LLMCEPTION_PROVIDER = "openai";
    const config = await loadConfig(tmpDir);
    expect(config.provider).toBe("openai");
  });

  it("should give env vars priority over project config", async () => {
    await writeFile(
      join(tmpDir, ".llmception.json"),
      JSON.stringify({ maxDepth: 7 }),
    );
    process.env.LLMCEPTION_MAX_DEPTH = "15";
    const config = await loadConfig(tmpDir);
    expect(config.maxDepth).toBe(15);
  });

  it("should deep merge budget from project config", async () => {
    await writeFile(
      join(tmpDir, ".llmception.json"),
      JSON.stringify({ budget: { perBranchUsd: 10 } }),
    );
    const config = await loadConfig(tmpDir);
    expect(config.budget.perBranchUsd).toBe(10);
    expect(config.budget.totalUsd).toBe(DEFAULT_CONFIG.budget.totalUsd);
    expect(config.budget.mode).toBe(DEFAULT_CONFIG.budget.mode);
  });
});
