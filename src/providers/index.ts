/**
 * Provider manager module.
 * Initializes LLM providers based on configuration and exposes
 * a unified routing interface for model selection.
 * See HLD Section 3.3 for provider architecture.
 */

import type { LLMProvider, ModelSelection, HardwareProfile } from '../types/index.js';
import type { Config } from '../config/index.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { classifyComplexity, selectModel } from './router.js';
import { providerLogger } from '../utils/logger.js';

export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export { GeminiProvider } from './gemini.js';
export { OllamaProvider } from './ollama.js';
export { classifyComplexity, selectModel } from './router.js';

/** Public interface for the provider manager. */
export interface ProviderManager {
  /** Get a provider by name, or undefined if not registered. */
  getProvider(name: string): LLMProvider | undefined;
  /** List the names of all enabled providers. */
  getEnabledProviders(): string[];
  /** Classify and route a message to the best available model. */
  route(messageText: string, hasActiveSkill?: boolean): ModelSelection;
}

/** Minimal provider configuration needed to create a ProviderManager. */
export interface ProviderManagerConfig {
  providers: {
    anthropic?: { apiKey?: string; enabled?: boolean };
    openai?: { apiKey?: string; enabled?: boolean };
    gemini?: { apiKey?: string; enabled?: boolean };
    deepseek?: { apiKey?: string; enabled?: boolean; apiBase?: string };
    ollama?: { enabled?: boolean; baseUrl?: string; model?: string };
  };
}

/**
 * Create a ProviderManager that initializes providers based on
 * which API keys are present and enabled in the config.
 *
 * @param config - Application config (or the minimal ProviderManagerConfig subset)
 * @param hardware - Optional hardware profile for capability checks
 * @returns A ProviderManager instance
 */
export function createProviderManager(
  config: ProviderManagerConfig | Config,
  hardware?: HardwareProfile,
): ProviderManager {
  const providerMap = new Map<string, LLMProvider>();
  const enabledNames: string[] = [];

  const providersCfg = config.providers;

  // Anthropic
  if (providersCfg.anthropic?.enabled && providersCfg.anthropic.apiKey) {
    const provider = new AnthropicProvider({
      apiKey: providersCfg.anthropic.apiKey,
    });
    providerMap.set('anthropic', provider);
    enabledNames.push('anthropic');
  }

  // OpenAI
  if (providersCfg.openai?.enabled && providersCfg.openai.apiKey) {
    const provider = new OpenAIProvider({
      apiKey: providersCfg.openai.apiKey,
    });
    providerMap.set('openai', provider);
    enabledNames.push('openai');
  }

  // Gemini
  if (providersCfg.gemini?.enabled && providersCfg.gemini.apiKey) {
    const provider = new GeminiProvider({
      apiKey: providersCfg.gemini.apiKey,
    });
    providerMap.set('gemini', provider);
    enabledNames.push('gemini');
  }

  // DeepSeek (uses OpenAI-compatible API)
  if (providersCfg.deepseek?.enabled && providersCfg.deepseek.apiKey) {
    const provider = new OpenAIProvider({
      apiKey: providersCfg.deepseek.apiKey,
      baseUrl: providersCfg.deepseek.apiBase ?? 'https://api.deepseek.com',
      providerName: 'deepseek',
    });
    providerMap.set('deepseek', provider);
    enabledNames.push('deepseek');
  }

  // Ollama (local models — no API key required)
  if (providersCfg.ollama?.enabled) {
    const ollamaCfg = providersCfg.ollama;
    const hasEnoughRam = hardware?.features.localModels ?? false;

    if (!hasEnoughRam && hardware) {
      providerLogger.warn(
        { ramGb: hardware.ramGb, requiredGb: 16 },
        'System has less than 16GB RAM for local models, but Ollama is explicitly enabled — proceeding anyway',
      );
    }

    const provider = new OllamaProvider({
      baseUrl: ollamaCfg.baseUrl,
      model: ollamaCfg.model,
    });
    providerMap.set('ollama', provider);
    enabledNames.push('ollama');
  }

  return {
    getProvider(name: string): LLMProvider | undefined {
      return providerMap.get(name);
    },

    getEnabledProviders(): string[] {
      return [...enabledNames];
    },

    route(messageText: string, hasActiveSkill: boolean = false): ModelSelection {
      const tier = classifyComplexity(messageText, hasActiveSkill);
      return selectModel(tier, enabledNames);
    },
  };
}
