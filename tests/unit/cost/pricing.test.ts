import { describe, it, expect } from 'vitest';
import {
  MODEL_PRICING,
  getModelPricing,
  calculateCost,
  getModelsByTier,
} from '../../../src/cost/pricing.js';

describe('MODEL_PRICING', () => {
  const expectedModels = [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-6',
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4.1',
    'deepseek-chat',
    'ollama/llama3.2',
    'ollama/qwen2.5',
  ];

  it('has entries for all expected models', () => {
    for (const model of expectedModels) {
      expect(MODEL_PRICING[model]).toBeDefined();
    }
  });

  it('each entry has required pricing fields', () => {
    for (const [, entry] of Object.entries(MODEL_PRICING)) {
      expect(entry.inputPer1k).toBeTypeOf('number');
      expect(entry.outputPer1k).toBeTypeOf('number');
      expect(entry.cachedInputPer1k).toBeTypeOf('number');
      expect(entry.tier).toMatch(/^(small|medium|large)$/);
      expect(entry.contextWindow).toBeGreaterThan(0);
      expect(entry.supportsTools).toBeTypeOf('boolean');
      // Verify cached input price is never more than regular input price
      expect(entry.cachedInputPer1k).toBeLessThanOrEqual(entry.inputPer1k);
    }
  });
});

describe('calculateCost', () => {
  it('returns correct cost for known model (claude-haiku)', () => {
    // 1000 input tokens * 0.001/1k + 1000 output tokens * 0.005/1k = 0.001 + 0.005 = 0.006
    const cost = calculateCost('claude-haiku-4-5-20251001', 1000, 1000);
    expect(cost).toBeCloseTo(0.006, 6);
  });

  it('returns correct cost for gpt-4o', () => {
    // 2000 input * 0.0025/1k + 500 output * 0.01/1k = 0.005 + 0.005 = 0.01
    const cost = calculateCost('gpt-4o', 2000, 500);
    expect(cost).toBeCloseTo(0.01, 6);
  });

  it('handles cached tokens correctly', () => {
    // 1000 total input, 400 cached
    // Non-cached: 600 input * 0.003/1k = 0.0018
    // Cached: 400 * 0.0003/1k = 0.00012
    // Output: 200 * 0.015/1k = 0.003
    // Total: 0.0018 + 0.00012 + 0.003 = 0.00492
    const cost = calculateCost('claude-sonnet-4-5-20250929', 1000, 200, 400);
    expect(cost).toBeCloseTo(0.00492, 6);
  });

  it('returns 0 for Ollama models (free local inference)', () => {
    const costLlama = calculateCost('ollama/llama3.2', 5000, 2000);
    expect(costLlama).toBe(0);

    const costQwen = calculateCost('ollama/qwen2.5', 10000, 5000);
    expect(costQwen).toBe(0);
  });

  it('returns 0 for unknown model', () => {
    const cost = calculateCost('nonexistent-model', 1000, 500);
    expect(cost).toBe(0);
  });

  it('handles zero tokens', () => {
    const cost = calculateCost('gpt-4o', 0, 0);
    expect(cost).toBe(0);
  });

  it('does not produce negative cost when cached tokens exceed input tokens', () => {
    // Edge case: cachedTokens > inputTokens should clamp non-cached to 0
    const cost = calculateCost('claude-sonnet-4-5-20250929', 100, 200, 500);
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});

describe('getModelPricing', () => {
  it('returns pricing for a known model', () => {
    const pricing = getModelPricing('gpt-4o-mini');
    expect(pricing).toBeDefined();
    expect(pricing?.tier).toBe('small');
  });

  it('returns undefined for an unknown model', () => {
    const pricing = getModelPricing('nonexistent-model-xyz');
    expect(pricing).toBeUndefined();
  });
});

describe('getModelsByTier', () => {
  it('returns small tier models', () => {
    const smallModels = getModelsByTier('small');
    expect(smallModels).toContain('claude-haiku-4-5-20251001');
    expect(smallModels).toContain('gpt-4o-mini');
    expect(smallModels).toContain('deepseek-chat');
    expect(smallModels).toContain('ollama/llama3.2');
    expect(smallModels).toContain('ollama/qwen2.5');
  });

  it('returns medium tier models', () => {
    const mediumModels = getModelsByTier('medium');
    expect(mediumModels).toContain('claude-sonnet-4-5-20250929');
    expect(mediumModels).toContain('gpt-4o');
    expect(mediumModels).toContain('gpt-4.1');
  });

  it('returns large tier models', () => {
    const largeModels = getModelsByTier('large');
    expect(largeModels).toContain('claude-opus-4-6');
    expect(largeModels).toHaveLength(1);
  });

  it('does not mix tiers', () => {
    const smallModels = getModelsByTier('small');
    expect(smallModels).not.toContain('claude-opus-4-6');
    expect(smallModels).not.toContain('gpt-4o');
  });
});
