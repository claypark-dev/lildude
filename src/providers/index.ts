/**
 * Provider manager module.
 * Initializes LLM providers based on configuration and exposes
 * a unified routing interface for model selection.
 * See HLD Section 3.3 for provider architecture.
 */

import type { LLMProvider, ModelSelection } from '../types/index.js';
import type { Config } from '../config/index.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { classifyComplexity, selectModel } from './router.js';

export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
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
    deepseek?: { apiKey?: string; enabled?: boolean; apiBase?: string };
    ollama?: { enabled?: boolean; baseUrl?: string };
  };
}

/**
 * Create a ProviderManager that initializes providers based on
 * which API keys are present and enabled in the config.
 *
 * @param config - Application config (or the minimal ProviderManagerConfig subset)
 * @returns A ProviderManager instance
 */
export function createProviderManager(config: ProviderManagerConfig | Config): ProviderManager {
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

  // DeepSeek (uses OpenAI-compatible API)
  if (providersCfg.deepseek?.enabled && providersCfg.deepseek.apiKey) {
    const deepseekCfg = providersCfg.deepseek;
    const provider = new OpenAIProvider({
      apiKey: deepseekCfg.apiKey,
      baseUrl: deepseekCfg.apiBase ?? 'https://api.deepseek.com',
      providerName: 'deepseek',
    });
    providerMap.set('deepseek', provider);
    enabledNames.push('deepseek');
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
