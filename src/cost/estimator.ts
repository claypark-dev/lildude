/**
 * Heuristic task cost estimation without LLM calls.
 * Uses pre-defined heuristics per task type to predict cost
 * before any tokens are spent.
 * See HLD Section 6 for cost control architecture.
 */

import type { CostEstimate } from '../types/index.js';
import { BudgetExceededError } from '../errors.js';
import { calculateCost, getModelPricing } from './pricing.js';

/** Average token usage heuristics per task type */
interface TaskHeuristic {
  avgRoundTrips: number;
  avgInputTokens: number;
  avgOutputTokens: number;
}

/**
 * Pre-defined heuristics for common task types.
 * Based on observed averages across typical usage patterns.
 */
const HEURISTICS: Record<string, TaskHeuristic> = {
  simple_chat: { avgRoundTrips: 1, avgInputTokens: 800, avgOutputTokens: 300 },
  skill_execution: { avgRoundTrips: 2, avgInputTokens: 600, avgOutputTokens: 200 },
  browser_task: { avgRoundTrips: 4, avgInputTokens: 1500, avgOutputTokens: 500 },
  complex_analysis: { avgRoundTrips: 3, avgInputTokens: 3000, avgOutputTokens: 2000 },
  summarization: { avgRoundTrips: 1, avgInputTokens: 2000, avgOutputTokens: 500 },
};

/** Default task type used when the provided type is unknown */
const DEFAULT_TASK_TYPE = 'simple_chat';

/**
 * Kill conditions for detecting and stopping runaway tasks.
 * Any task exceeding these thresholds should be terminated.
 */
export const KILL_CONDITIONS = {
  maxRoundTrips: 20,
  maxTokensPerTask: 100_000,
  maxDurationMs: 30 * 60_000,
  maxConsecutiveErrors: 5,
} as const;

/**
 * Estimate the cost of a task without spending any tokens.
 * Uses heuristic averages for the given task type and model pricing.
 * Falls back to simple_chat heuristics for unknown task types.
 * @param taskType - The type of task to estimate (e.g., 'simple_chat', 'browser_task')
 * @param model - The model identifier to use for pricing
 * @returns A CostEstimate with breakdown of expected token usage
 * @throws BudgetExceededError if the model is unknown and has no pricing data
 */
export function estimateTaskCost(taskType: string, model: string): CostEstimate {
  const pricing = getModelPricing(model);
  if (!pricing) {
    throw new BudgetExceededError(
      `Unknown model "${model}" has no pricing data. Cannot estimate cost.`,
    );
  }

  const heuristic = HEURISTICS[taskType] ?? HEURISTICS[DEFAULT_TASK_TYPE];

  const totalInputTokens = heuristic.avgInputTokens * heuristic.avgRoundTrips;
  const totalOutputTokens = heuristic.avgOutputTokens * heuristic.avgRoundTrips;
  const estimatedCostUsd = calculateCost(model, totalInputTokens, totalOutputTokens);

  return {
    estimatedCostUsd,
    breakdown: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      roundTrips: heuristic.avgRoundTrips,
      model,
    },
  };
}
