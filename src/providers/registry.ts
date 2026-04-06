import type {
  ExecutionProvider,
  LlmceptionConfig,
  PricingModel,
  ProviderType,
} from "../types.js";
import { ClaudeCliProvider } from "./claude-cli.js";
import { AnthropicApiProvider } from "./anthropic-api.js";
import { OpenAiApiProvider } from "./openai-api.js";
import { OllamaProvider } from "./ollama.js";

interface ProviderInfo {
  name: string;
  pricing: PricingModel;
  supportsFork: boolean;
}

const PROVIDER_INFO: Record<ProviderType, ProviderInfo> = {
  "claude-cli": {
    name: "Claude Code CLI",
    pricing: "subscription",
    supportsFork: true,
  },
  anthropic: {
    name: "Anthropic API",
    pricing: "metered",
    supportsFork: false,
  },
  openai: {
    name: "OpenAI API",
    pricing: "metered",
    supportsFork: false,
  },
  ollama: {
    name: "Ollama",
    pricing: "free",
    supportsFork: false,
  },
};

/**
 * Factory for creating execution providers based on configuration.
 */
export class ProviderRegistry {
  /**
   * Create the appropriate provider instance for the configured provider type.
   */
  static create(config: LlmceptionConfig): ExecutionProvider {
    switch (config.provider) {
      case "claude-cli":
        return new ClaudeCliProvider(config);
      case "anthropic":
        return new AnthropicApiProvider(config);
      case "openai":
        return new OpenAiApiProvider(config);
      case "ollama":
        return new OllamaProvider(config);
      default: {
        const _exhaustive: never = config.provider;
        throw new Error(`Unknown provider type: ${_exhaustive}`);
      }
    }
  }

  /**
   * Get metadata about a provider type without creating an instance.
   */
  static getProviderInfo(type: ProviderType): ProviderInfo {
    const info = PROVIDER_INFO[type];
    if (!info) {
      throw new Error(`Unknown provider type: ${type}`);
    }
    return info;
  }
}
