/**
 * Model router: deterministic complexity classification and quality-aware routing.
 * See HLD Section 3.3 and S3.R.2 for architecture.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ModelTier, ModelSelection } from '../types/index.js';
import { MODEL_PRICING, type ModelPricingEntry } from '../cost/pricing.js';
import { getModelQualityStats } from '../persistence/routing-history.js';

/** Min ratings before adjusting priority; boost threshold; penalize threshold. */
const MIN_QUALITY_RATINGS = 5;
const BOOST_THRESHOLD = 0.8;
const PENALIZE_THRESHOLD = 0.4;

/** Keywords that indicate a complex, multi-step, or thorough request. */
const LARGE_TIER_KEYWORDS = [
  'analyze',
  'compare',
  'comprehensive',
  'detailed',
  'write a',
  'create a',
  'thorough',
  'in-depth',
  'exhaustive',
  'step by step',
  'step-by-step',
  'multi-step',
  'explain in detail',
] as const;

/**
 * Base model ordering per tier. First available model wins.
 * Each entry maps to a known MODEL_PRICING key and its provider.
 */
const BASE_TIER_PREFERENCES: Record<ModelTier, Array<{ model: string; provider: string }>> = {
  small: [
    { model: 'claude-haiku-4-5-20251001', provider: 'anthropic' },
    { model: 'gpt-4o-mini', provider: 'openai' },
    { model: 'gemini-2.0-flash', provider: 'gemini' },
    { model: 'deepseek-chat', provider: 'deepseek' },
    { model: 'ollama/llama3.2', provider: 'ollama' },
    { model: 'ollama/qwen2.5', provider: 'ollama' },
  ],
  medium: [
    { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    { model: 'gpt-4o', provider: 'openai' },
    { model: 'gemini-2.0-pro', provider: 'gemini' },
    { model: 'gpt-4.1', provider: 'openai' },
  ],
  large: [
    { model: 'claude-opus-4-6', provider: 'anthropic' },
    { model: 'gpt-4o', provider: 'openai' },
    { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
  ],
};

/** The configured Ollama model name, set at app startup. */
let configuredOllamaModel: string | undefined;

/** The configured Ollama model's parameter size in billions (e.g. 70 for 70B). */
let configuredOllamaModelSizeB: number | undefined;

/** Minimum parameter size (billions) for an Ollama model to be eligible for medium tier. */
const OLLAMA_MEDIUM_TIER_MIN_B = 30;

/**
 * Set the configured Ollama model so the router can include it in tier preferences.
 * Called during app startup when the Ollama provider is initialized.
 *
 * @param model - The Ollama model name from config (e.g. 'phi3', 'mistral')
 * @param parameterSizeB - Optional model size in billions of parameters
 */
export function setConfiguredOllamaModel(model: string | undefined, parameterSizeB?: number): void {
  configuredOllamaModel = model;
  configuredOllamaModelSizeB = parameterSizeB ?? estimateModelSizeFromName(model);
}

/**
 * Estimate model size in billions from the model name or tag.
 * Parses common patterns like 'llama3.2:70b', 'qwen2.5:32b', 'mixtral-8x7b'.
 *
 * @param model - The Ollama model name/tag
 * @returns Estimated size in billions, or undefined if not parseable
 */
export function estimateModelSizeFromName(model: string | undefined): number | undefined {
  if (!model) return undefined;
  const lower = model.toLowerCase();

  // Match patterns like ':70b', ':32b', ':4b', '-70b', '-8b'
  const sizeMatch = lower.match(/[:\-_](\d+(?:\.\d+)?)b\b/);
  if (sizeMatch) {
    return parseFloat(sizeMatch[1]);
  }

  // Match 'NxMb' patterns for mixture-of-experts (e.g., '8x7b' = 56B effective)
  const moeMatch = lower.match(/(\d+)x(\d+(?:\.\d+)?)b/);
  if (moeMatch) {
    return parseInt(moeMatch[1], 10) * parseFloat(moeMatch[2]);
  }

  return undefined;
}

/**
 * Build tier preferences with only the configured Ollama model.
 * Replaces all hardcoded Ollama entries with the single configured model,
 * preventing the router from selecting an Ollama model that isn't installed.
 * If no Ollama model is configured, strips Ollama entries entirely.
 *
 * Ollama tier eligibility:
 * - small: always eligible
 * - medium: eligible if model is >= 30B parameters
 * - large: never eligible (use cloud providers)
 *
 * @param tier - The model tier to get preferences for
 * @returns Array of model/provider pairs for the tier
 */
function getTierPreferences(tier: ModelTier): Array<{ model: string; provider: string }> {
  const base = BASE_TIER_PREFERENCES[tier];

  // Remove all hardcoded Ollama entries from this tier
  const withoutOllama = base.filter((entry) => entry.provider !== 'ollama');

  if (!configuredOllamaModel) {
    return withoutOllama;
  }

  const ollamaModelId = `ollama/${configuredOllamaModel}`;
  const sizeB = configuredOllamaModelSizeB ?? 0;

  if (tier === 'small') {
    return [...withoutOllama, { model: ollamaModelId, provider: 'ollama' }];
  }

  if (tier === 'medium' && sizeB >= OLLAMA_MEDIUM_TIER_MIN_B) {
    return [...withoutOllama, { model: ollamaModelId, provider: 'ollama' }];
  }

  // Large tier: Ollama never eligible
  return withoutOllama;
}

/**
 * Count the number of words in a string.
 * @param text - The text to count words in
 * @returns Word count
 */
function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

/**
 * Check whether the text contains any of the large-tier keywords (case-insensitive).
 * @param text - The text to scan
 * @returns True if a large-tier keyword is found
 */
function containsLargeKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return LARGE_TIER_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * Check whether the text contains indicators of a multi-step request.
 * @param text - The text to scan
 * @returns True if multi-step indicators are found
 */
function isMultiStep(text: string): boolean {
  const lower = text.toLowerCase();

  // Numbered list items (e.g., "1. do this 2. do that")
  const numberedSteps = lower.match(/\d+\.\s/g);
  if (numberedSteps && numberedSteps.length >= 2) {
    return true;
  }

  // Bullet markers
  const bullets = lower.match(/[-*]\s/g);
  if (bullets && bullets.length >= 2) {
    return true;
  }

  // Connectors that suggest chained tasks
  const chainWords = ['then', 'after that', 'next', 'finally', 'also', 'and then'];
  const chainCount = chainWords.filter((word) => lower.includes(word)).length;
  return chainCount >= 2;
}

/**
 * Classify the complexity of a user message into a model tier.
 * Uses deterministic heuristics: small (< 20 words), medium (20-100), large (100+ or keywords).
 * @param messageText - The raw text of the user message
 * @param hasActiveWave - Whether a wave is currently active
 * @returns The recommended ModelTier
 */
export function classifyComplexity(
  messageText: string,
  hasActiveWave: boolean,
): ModelTier {
  const words = wordCount(messageText);
  const hasQuestionMark = messageText.includes('?');
  const hasLargeKeyword = containsLargeKeyword(messageText);
  const hasMultiStep = isMultiStep(messageText);

  // Large tier: explicit complexity keywords, multi-step, or very long
  if (hasLargeKeyword || hasMultiStep || words > 100) {
    return 'large';
  }

  // Simple tier: short, no questions, no complexity signals
  if (words < 20 && !hasQuestionMark) {
    // Active wave does not promote simple messages
    return 'small';
  }

  // Simple messages with a question mark but still very short
  if (words < 20 && hasQuestionMark) {
    // Short questions like "What time is it?" are still simple
    if (hasActiveWave) {
      return 'small';
    }
    return 'small';
  }

  // Medium: 20-100 words without large-tier signals
  return 'medium';
}

/**
 * Select the best available model for a given tier and set of enabled providers.
 * Walks the tier preference list and picks the first model whose provider is enabled.
 * Falls back to the next available provider if the preferred is unavailable.
 *
 * @param tier - The model tier to select for
 * @param enabledProviders - List of provider names that have valid API keys
 * @returns A ModelSelection with provider, model, tier, estimated cost, and reasoning
 * @throws Error if no model is available for the requested tier and enabled providers
 */
export function selectModel(
  tier: ModelTier,
  enabledProviders: string[],
): ModelSelection {
  const preferences = getTierPreferences(tier);

  // Try preferred models for this tier
  for (const pref of preferences) {
    if (enabledProviders.includes(pref.provider)) {
      const pricing = MODEL_PRICING[pref.model] as ModelPricingEntry | undefined;
      const estimatedCostUsd = pricing
        ? (pricing.inputPer1k + pricing.outputPer1k) // cost for ~1k tokens each direction
        : 0;

      return {
        provider: pref.provider,
        model: pref.model,
        tier,
        estimatedCostUsd,
        reasoning: `Selected ${pref.model} as preferred ${tier}-tier model from ${pref.provider}`,
      };
    }
  }

  // Fallback: scan all models in MODEL_PRICING that match the tier
  for (const [modelId, pricing] of Object.entries(MODEL_PRICING)) {
    if (pricing.tier !== tier) {
      continue;
    }
    // Derive provider from model name
    const derivedProvider = deriveProviderFromModel(modelId);
    if (derivedProvider && enabledProviders.includes(derivedProvider)) {
      return {
        provider: derivedProvider,
        model: modelId,
        tier,
        estimatedCostUsd: pricing.inputPer1k + pricing.outputPer1k,
        reasoning: `Fallback: selected ${modelId} (${derivedProvider}) for ${tier} tier`,
      };
    }
  }

  throw new Error(
    `No model available for tier "${tier}" with enabled providers: [${enabledProviders.join(', ')}]`,
  );
}

/**
 * Select the best model for a tier using quality-aware routing from history.
 * Boosts models with avgScore >= 0.8, penalizes those < 0.4 (min 5 ratings).
 * Falls back to heuristic ordering if no quality data exists.
 * @param tier - The model tier to select for
 * @param enabledProviders - Provider names with valid API keys
 * @param db - The better-sqlite3 Database instance
 * @param taskType - Optional task type to scope quality stats
 * @returns A ModelSelection with provider, model, tier, estimated cost, and reasoning
 * @throws Error if no model is available for the requested tier
 */
export function selectModelWithHistory(
  tier: ModelTier,
  enabledProviders: string[],
  db: BetterSqlite3.Database,
  taskType?: string,
): ModelSelection {
  const preferences = getTierPreferences(tier);

  // Filter to only models whose provider is enabled
  const availableModels = preferences.filter(
    (pref) => enabledProviders.includes(pref.provider),
  );

  if (availableModels.length === 0) {
    // Delegate to original selectModel for fallback logic
    return selectModel(tier, enabledProviders);
  }

  // Score each available model based on quality history
  const scoredModels = availableModels.map((pref, originalIndex) => {
    const stats = getModelQualityStats(db, pref.model, taskType);
    let priorityAdjustment = 0;

    if (stats.ratingCount >= MIN_QUALITY_RATINGS) {
      if (stats.avgScore >= BOOST_THRESHOLD) {
        priorityAdjustment = -100; // Boost: lower number = higher priority
      } else if (stats.avgScore < PENALIZE_THRESHOLD) {
        priorityAdjustment = 100; // Penalize: higher number = lower priority
      }
    }

    return {
      ...pref,
      originalIndex,
      avgScore: stats.avgScore,
      ratingCount: stats.ratingCount,
      priority: originalIndex + priorityAdjustment,
    };
  });

  // Sort by adjusted priority (lower = better)
  scoredModels.sort((modelA, modelB) => modelA.priority - modelB.priority);

  const bestModel = scoredModels[0];
  const pricing = MODEL_PRICING[bestModel.model] as ModelPricingEntry | undefined;
  const estimatedCostUsd = pricing
    ? (pricing.inputPer1k + pricing.outputPer1k)
    : 0;

  const qualityNote = bestModel.ratingCount >= MIN_QUALITY_RATINGS
    ? ` (quality avg: ${bestModel.avgScore.toFixed(2)}, ${bestModel.ratingCount} ratings)`
    : ' (no sufficient quality data, using heuristic)';

  return {
    provider: bestModel.provider,
    model: bestModel.model,
    tier,
    estimatedCostUsd,
    reasoning: `Selected ${bestModel.model} for ${tier} tier from ${bestModel.provider}${qualityNote}`,
  };
}

/**
 * Derive the provider name from a model identifier string.
 * @param modelId - The model identifier
 * @returns The provider name, or undefined if unknown
 */
function deriveProviderFromModel(modelId: string): string | undefined {
  if (modelId.startsWith('claude-')) {
    return 'anthropic';
  }
  if (modelId.startsWith('gpt-')) {
    return 'openai';
  }
  if (modelId.startsWith('gemini-')) {
    return 'gemini';
  }
  if (modelId.startsWith('deepseek-')) {
    return 'deepseek';
  }
  if (modelId.startsWith('ollama/')) {
    return 'ollama';
  }
  return undefined;
}
