import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "../../../src/providers/registry.js";
import { ClaudeCliProvider } from "../../../src/providers/claude-cli.js";
import { AnthropicApiProvider } from "../../../src/providers/anthropic-api.js";
import { OpenAiApiProvider } from "../../../src/providers/openai-api.js";
import { OllamaProvider } from "../../../src/providers/ollama.js";
import type { LlmceptionConfig, ProviderType } from "../../../src/types.js";

function makeConfig(
  overrides: Partial<LlmceptionConfig> = {},
): LlmceptionConfig {
  return {
    provider: "claude-cli",
    maxDepth: 3,
    maxWidth: 4,
    nodeBudget: 20,
    concurrency: 2,
    budget: { perBranchUsd: 5.0, totalUsd: 25.0, mode: "hard" },
    branchTimeoutMs: 60000,
    model: "sonnet",
    permissionMode: "auto",
    claudeCodePath: "claude",
    providers: {},
    ...overrides,
  };
}

describe("ProviderRegistry", () => {
  describe("create()", () => {
    it("should create a ClaudeCliProvider for 'claude-cli'", () => {
      const config = makeConfig({ provider: "claude-cli" });
      const provider = ProviderRegistry.create(config);
      expect(provider).toBeInstanceOf(ClaudeCliProvider);
      expect(provider.type).toBe("claude-cli");
      expect(provider.name).toBe("Claude Code CLI");
      expect(provider.pricing).toBe("subscription");
      expect(provider.supportsFork).toBe(false);
    });

    it("should create an AnthropicApiProvider for 'anthropic'", () => {
      const config = makeConfig({ provider: "anthropic" });
      const provider = ProviderRegistry.create(config);
      expect(provider).toBeInstanceOf(AnthropicApiProvider);
      expect(provider.type).toBe("anthropic");
      expect(provider.name).toBe("Anthropic API");
      expect(provider.pricing).toBe("metered");
      expect(provider.supportsFork).toBe(false);
    });

    it("should create an OpenAiApiProvider for 'openai'", () => {
      const config = makeConfig({ provider: "openai" });
      const provider = ProviderRegistry.create(config);
      expect(provider).toBeInstanceOf(OpenAiApiProvider);
      expect(provider.type).toBe("openai");
      expect(provider.name).toBe("OpenAI API");
      expect(provider.pricing).toBe("metered");
      expect(provider.supportsFork).toBe(false);
    });

    it("should create an OllamaProvider for 'ollama'", () => {
      const config = makeConfig({ provider: "ollama" });
      const provider = ProviderRegistry.create(config);
      expect(provider).toBeInstanceOf(OllamaProvider);
      expect(provider.type).toBe("ollama");
      expect(provider.name).toBe("Ollama");
      expect(provider.pricing).toBe("free");
      expect(provider.supportsFork).toBe(false);
    });
  });

  describe("getProviderInfo()", () => {
    it("should return correct info for claude-cli", () => {
      const info = ProviderRegistry.getProviderInfo("claude-cli");
      expect(info).toEqual({
        name: "Claude Code CLI",
        pricing: "subscription",
        supportsFork: false,
      });
    });

    it("should return correct info for anthropic", () => {
      const info = ProviderRegistry.getProviderInfo("anthropic");
      expect(info).toEqual({
        name: "Anthropic API",
        pricing: "metered",
        supportsFork: false,
      });
    });

    it("should return correct info for openai", () => {
      const info = ProviderRegistry.getProviderInfo("openai");
      expect(info).toEqual({
        name: "OpenAI API",
        pricing: "metered",
        supportsFork: false,
      });
    });

    it("should return correct info for ollama", () => {
      const info = ProviderRegistry.getProviderInfo("ollama");
      expect(info).toEqual({
        name: "Ollama",
        pricing: "free",
        supportsFork: false,
      });
    });

    it("should throw for unknown provider type", () => {
      expect(() =>
        ProviderRegistry.getProviderInfo("unknown" as ProviderType),
      ).toThrow("Unknown provider type");
    });
  });
});
