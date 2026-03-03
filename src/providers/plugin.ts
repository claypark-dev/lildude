/**
 * Provider plugin loader.
 * Allows registering custom LLM providers via configuration,
 * extending the built-in set (Anthropic, OpenAI, Gemini, Ollama).
 *
 * Custom providers are specified as OpenAI-compatible endpoints
 * and are loaded at startup.
 */

import type { LLMProvider, ModelSelection } from '../types/index.js';
import { OpenAIProvider } from './openai.js';
import { createModuleLogger } from '../utils/logger.js';

const pluginLogger = createModuleLogger('provider-plugin');

/** Configuration for a custom provider plugin. */
export interface ProviderPluginConfig {
  /** Unique provider name (e.g., 'together', 'groq', 'fireworks'). */
  name: string;
  /** API base URL for the OpenAI-compatible endpoint. */
  apiBase: string;
  /** API key for authentication. */
  apiKey: string;
  /** Default model to use. */
  defaultModel: string;
  /** Whether this provider is enabled. */
  enabled?: boolean;
}

/** Result of loading provider plugins. */
export interface PluginLoadResult {
  loaded: string[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Load custom LLM provider plugins from configuration.
 * Each plugin is created as an OpenAI-compatible provider.
 *
 * @param plugins - Array of provider plugin configurations.
 * @returns Map of provider name to LLMProvider instance, plus load results.
 */
export function loadProviderPlugins(
  plugins: ProviderPluginConfig[],
): { providers: Map<string, LLMProvider>; result: PluginLoadResult } {
  const providers = new Map<string, LLMProvider>();
  const result: PluginLoadResult = { loaded: [], failed: [] };

  for (const plugin of plugins) {
    if (plugin.enabled === false) {
      pluginLogger.debug({ name: plugin.name }, 'Provider plugin disabled, skipping');
      continue;
    }

    try {
      if (!plugin.name || !plugin.apiBase || !plugin.apiKey) {
        throw new Error('name, apiBase, and apiKey are required');
      }

      const provider = new OpenAIProvider({
        apiKey: plugin.apiKey,
        baseUrl: plugin.apiBase,
        providerName: plugin.name,
      });

      providers.set(plugin.name, provider);
      result.loaded.push(plugin.name);

      pluginLogger.info(
        { name: plugin.name, apiBase: plugin.apiBase, defaultModel: plugin.defaultModel },
        'Custom provider plugin loaded',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ name: plugin.name, error: message });
      pluginLogger.warn(
        { name: plugin.name, error: message },
        'Failed to load provider plugin',
      );
    }
  }

  return { providers, result };
}

/**
 * Create a model selection for a custom provider plugin.
 *
 * @param providerName - The provider plugin name.
 * @param model - The model to select.
 * @returns A ModelSelection object.
 */
export function createPluginModelSelection(
  providerName: string,
  model: string,
): ModelSelection {
  return {
    model,
    provider: providerName,
    tier: 'medium',
    estimatedCostUsd: 0,
    reasoning: `Custom provider plugin: ${providerName}`,
  };
}
