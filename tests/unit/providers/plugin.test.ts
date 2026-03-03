import { describe, it, expect } from 'vitest';
import {
  loadProviderPlugins,
  createPluginModelSelection,
  type ProviderPluginConfig,
} from '../../../src/providers/plugin.js';

describe('provider plugin', () => {
  describe('loadProviderPlugins', () => {
    it('loads a valid plugin configuration', () => {
      const plugins: ProviderPluginConfig[] = [
        {
          name: 'together',
          apiBase: 'https://api.together.xyz/v1',
          apiKey: 'test-key',
          defaultModel: 'meta-llama/Llama-3-8b-chat-hf',
        },
      ];

      const { providers, result } = loadProviderPlugins(plugins);
      expect(providers.size).toBe(1);
      expect(providers.has('together')).toBe(true);
      expect(result.loaded).toEqual(['together']);
      expect(result.failed).toHaveLength(0);
    });

    it('skips disabled plugins', () => {
      const plugins: ProviderPluginConfig[] = [
        {
          name: 'groq',
          apiBase: 'https://api.groq.com/openai/v1',
          apiKey: 'test-key',
          defaultModel: 'llama3-70b',
          enabled: false,
        },
      ];

      const { providers, result } = loadProviderPlugins(plugins);
      expect(providers.size).toBe(0);
      expect(result.loaded).toHaveLength(0);
    });

    it('records failures for invalid configs', () => {
      const plugins: ProviderPluginConfig[] = [
        {
          name: '',
          apiBase: '',
          apiKey: '',
          defaultModel: 'test',
        },
      ];

      const { providers, result } = loadProviderPlugins(plugins);
      expect(providers.size).toBe(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].name).toBe('');
    });

    it('loads multiple plugins', () => {
      const plugins: ProviderPluginConfig[] = [
        { name: 'together', apiBase: 'https://api.together.xyz/v1', apiKey: 'key1', defaultModel: 'model1' },
        { name: 'fireworks', apiBase: 'https://api.fireworks.ai/inference/v1', apiKey: 'key2', defaultModel: 'model2' },
      ];

      const { providers, result } = loadProviderPlugins(plugins);
      expect(providers.size).toBe(2);
      expect(result.loaded).toEqual(['together', 'fireworks']);
    });

    it('handles empty plugins array', () => {
      const { providers, result } = loadProviderPlugins([]);
      expect(providers.size).toBe(0);
      expect(result.loaded).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('createPluginModelSelection', () => {
    it('creates a valid model selection', () => {
      const selection = createPluginModelSelection('together', 'llama-3-8b');
      expect(selection.provider).toBe('together');
      expect(selection.model).toBe('llama-3-8b');
      expect(selection.tier).toBe('medium');
      expect(selection.estimatedCostUsd).toBe(0);
      expect(selection.reasoning).toContain('together');
    });
  });
});
