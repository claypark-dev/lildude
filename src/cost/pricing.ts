/**
 * Model pricing data and cost calculation utilities.
 * Provides per-model pricing, tier classification, and cost estimation
 * without requiring any LLM calls.
 * See HLD Section 6 for cost control architecture.
 */

import type { ModelTier } from '../types/index.js';

/** Per-model pricing configuration */
export interface ModelPricingEntry {
  inputPer1k: number;
  outputPer1k: number;
  cachedInputPer1k: number;
  tier: ModelTier;
  contextWindow: number;
  supportsTools: boolean;
}

/**
 * Canonical pricing table for all supported models.
 * Prices are in USD per 1,000 tokens.
 */
export const MODEL_PRICING: Record<string, ModelPricingEntry> = {
  // Anthropic
  'claude-haiku-4-5-20251001': {
    inputPer1k: 0.001,
    outputPer1k: 0.005,
    cachedInputPer1k: 0.0001,
    tier: 'small',
    contextWindow: 200_000,
    supportsTools: true,
  },
  'claude-sonnet-4-5-20250929': {
    inputPer1k: 0.003,
    outputPer1k: 0.015,
    cachedInputPer1k: 0.0003,
    tier: 'medium',
    contextWindow: 200_000,
    supportsTools: true,
  },
  'claude-opus-4-6': {
    inputPer1k: 0.015,
    outputPer1k: 0.075,
    cachedInputPer1k: 0.0015,
    tier: 'large',
    contextWindow: 200_000,
    supportsTools: true,
  },

  // OpenAI
  'gpt-4o-mini': {
    inputPer1k: 0.00015,
    outputPer1k: 0.0006,
    cachedInputPer1k: 0.000075,
    tier: 'small',
    contextWindow: 128_000,
    supportsTools: true,
  },
  'gpt-4o': {
    inputPer1k: 0.0025,
    outputPer1k: 0.01,
    cachedInputPer1k: 0.00125,
    tier: 'medium',
    contextWindow: 128_000,
    supportsTools: true,
  },
  'gpt-4.1': {
    inputPer1k: 0.002,
    outputPer1k: 0.008,
    cachedInputPer1k: 0.001,
    tier: 'medium',
    contextWindow: 1_000_000,
    supportsTools: true,
  },

  // DeepSeek
  'deepseek-chat': {
    inputPer1k: 0.00014,
    outputPer1k: 0.00028,
    cachedInputPer1k: 0.00007,
    tier: 'small',
    contextWindow: 64_000,
    supportsTools: true,
  },

  // Local (Ollama)
  'ollama/llama3.2': {
    inputPer1k: 0,
    outputPer1k: 0,
    cachedInputPer1k: 0,
    tier: 'small',
    contextWindow: 8192,
    supportsTools: false,
  },
  'ollama/qwen2.5': {
    inputPer1k: 0,
    outputPer1k: 0,
    cachedInputPer1k: 0,
    tier: 'small',
    contextWindow: 32_768,
    supportsTools: true,
  },
};

/**
 * Get pricing for a model by name.
 * @param model - The model identifier string
 * @returns The pricing entry, or undefined if the model is unknown
 */
export function getModelPricing(model: string): ModelPricingEntry | undefined {
  return MODEL_PRICING[model];
}

/**
 * Calculate cost in USD for a given token usage.
 * @param model - The model identifier string
 * @param inputTokens - Number of input tokens consumed
 * @param outputTokens - Number of output tokens generated
 * @param cachedTokens - Number of cached input tokens (optional, default 0)
 * @returns Cost in USD, or 0 if model pricing is unknown
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0,
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return 0;
  }

  const nonCachedInputTokens = Math.max(0, inputTokens - cachedTokens);
  const inputCost = (nonCachedInputTokens / 1000) * pricing.inputPer1k;
  const cachedCost = (cachedTokens / 1000) * pricing.cachedInputPer1k;
  const outputCost = (outputTokens / 1000) * pricing.outputPer1k;

  return inputCost + cachedCost + outputCost;
}

/**
 * List all model identifiers that belong to a given pricing tier.
 * @param tier - The model tier to filter by
 * @returns Array of model identifier strings matching the tier
 */
export function getModelsByTier(tier: ModelTier): string[] {
  return Object.entries(MODEL_PRICING)
    .filter(([, pricing]) => pricing.tier === tier)
    .map(([modelName]) => modelName);
}
