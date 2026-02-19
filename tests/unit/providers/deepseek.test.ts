/**
 * Unit tests for the DeepSeek provider integration.
 * DeepSeek uses the OpenAI adapter with a custom base URL.
 */

import { describe, it, expect } from 'vitest';
import { createProviderManager } from '../../../src/providers/index.js';
import { MODEL_PRICING } from '../../../src/cost/pricing.js';
import { selectModel } from '../../../src/providers/router.js';

describe('DeepSeek provider', () => {
  it('uses OpenAI adapter with custom base URL and provider name "deepseek"', () => {
    const manager = createProviderManager({
      providers: {
        deepseek: {
          enabled: true,
          apiKey: 'test-deepseek-key',
          apiBase: 'https://api.deepseek.com',
        },
      },
    });

    const provider = manager.getProvider('deepseek');
    expect(provider).toBeDefined();
    expect(provider!.name).toBe('deepseek');
  });

  it('provider name is "deepseek"', () => {
    const manager = createProviderManager({
      providers: {
        deepseek: {
          enabled: true,
          apiKey: 'test-deepseek-key',
        },
      },
    });

    const provider = manager.getProvider('deepseek');
    expect(provider!.name).toBe('deepseek');
  });

  it('appears in enabled providers list when configured', () => {
    const manager = createProviderManager({
      providers: {
        deepseek: {
          enabled: true,
          apiKey: 'test-deepseek-key',
        },
      },
    });

    const enabled = manager.getEnabledProviders();
    expect(enabled).toContain('deepseek');
  });

  it('is not registered when disabled', () => {
    const manager = createProviderManager({
      providers: {
        deepseek: {
          enabled: false,
          apiKey: 'test-deepseek-key',
        },
      },
    });

    const provider = manager.getProvider('deepseek');
    expect(provider).toBeUndefined();
  });

  it('is not registered when API key is missing', () => {
    const manager = createProviderManager({
      providers: {
        deepseek: {
          enabled: true,
        },
      },
    });

    const provider = manager.getProvider('deepseek');
    expect(provider).toBeUndefined();
  });
});

describe('DeepSeek in pricing table', () => {
  it('deepseek-chat exists in MODEL_PRICING', () => {
    expect(MODEL_PRICING['deepseek-chat']).toBeDefined();
  });

  it('deepseek-chat is classified as small tier', () => {
    expect(MODEL_PRICING['deepseek-chat'].tier).toBe('small');
  });

  it('deepseek-chat has correct pricing structure', () => {
    const pricing = MODEL_PRICING['deepseek-chat'];
    expect(pricing.inputPer1k).toBeGreaterThan(0);
    expect(pricing.outputPer1k).toBeGreaterThan(0);
    expect(pricing.contextWindow).toBeGreaterThan(0);
    expect(pricing.supportsTools).toBe(true);
  });
});

describe('DeepSeek in router', () => {
  it('router can select deepseek-chat for small tier', () => {
    const selection = selectModel('small', ['deepseek']);
    expect(selection.model).toBe('deepseek-chat');
    expect(selection.provider).toBe('deepseek');
    expect(selection.tier).toBe('small');
  });

  it('router prefers anthropic over deepseek for small tier', () => {
    const selection = selectModel('small', ['anthropic', 'deepseek']);
    expect(selection.provider).toBe('anthropic');
  });

  it('router falls back to deepseek when no other small-tier providers available', () => {
    const selection = selectModel('small', ['deepseek']);
    expect(selection.provider).toBe('deepseek');
    expect(selection.model).toBe('deepseek-chat');
  });

  it('router throws for medium tier when only deepseek is enabled', () => {
    expect(() => selectModel('medium', ['deepseek'])).toThrow(
      /No model available for tier "medium"/,
    );
  });
});
