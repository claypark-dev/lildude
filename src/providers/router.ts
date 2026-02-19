/**
 * Model router with deterministic complexity classification.
 * Routes user messages to the appropriate model tier without using LLM calls.
 * See HLD Section 3.3 for routing architecture.
 */

import type { ModelTier, ModelSelection } from '../types/index.js';
import { MODEL_PRICING, type ModelPricingEntry } from '../cost/pricing.js';

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
 * Preferred model ordering per tier. First available model wins.
 * Each entry maps to a known MODEL_PRICING key and its provider.
 */
const TIER_PREFERENCES: Record<ModelTier, Array<{ model: string; provider: string }>> = {
  small: [
    { model: 'claude-haiku-4-5-20251001', provider: 'anthropic' },
    { model: 'gpt-4o-mini', provider: 'openai' },
    { model: 'deepseek-chat', provider: 'deepseek' },
  ],
  medium: [
    { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    { model: 'gpt-4o', provider: 'openai' },
    { model: 'gpt-4.1', provider: 'openai' },
  ],
  large: [
    { model: 'claude-opus-4-6', provider: 'anthropic' },
    { model: 'gpt-4o', provider: 'openai' },
    { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
  ],
};

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
 * Uses deterministic heuristics — no LLM call needed.
 *
 * Heuristics:
 * - Simple (small): < 20 words, no question marks, no multi-step keywords
 * - Medium: 20-100 words, single question, moderate complexity
 * - Complex (large): > 100 words, or contains analysis/comparison keywords,
 *   or multi-step structure detected
 * - If hasActiveSkill is true and message would otherwise be simple, keep it small
 *   because skills manage their own complexity
 *
 * @param messageText - The raw text of the user message
 * @param hasActiveSkill - Whether a skill is currently active
 * @returns The recommended ModelTier
 */
export function classifyComplexity(
  messageText: string,
  hasActiveSkill: boolean,
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
    // Active skill does not promote simple messages
    return 'small';
  }

  // Simple messages with a question mark but still very short
  if (words < 20 && hasQuestionMark) {
    // Short questions like "What time is it?" are still simple
    if (hasActiveSkill) {
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
  const preferences = TIER_PREFERENCES[tier];

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
  if (modelId.startsWith('deepseek-')) {
    return 'deepseek';
  }
  if (modelId.startsWith('ollama/')) {
    return 'ollama';
  }
  return undefined;
}
