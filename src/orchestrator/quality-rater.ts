/**
 * Quality rating engine for multi-agent hierarchy.
 * After a task executed by a small/local model completes, a medium model
 * rates the output quality. If quality is below threshold, the system can
 * automatically retry with a better model. Ratings are stored to improve
 * future routing decisions via quality-aware routing history.
 * See S4.T.3 — Agent Hierarchy (Multi-Agent Rating).
 */

import type { QualityRaterDeps, QualityRater, RateInput, RatingResult } from './quality-rater-helpers.js';
import type { ModelTier } from '../types/index.js';
import {
  RETRY_THRESHOLD,
  MAX_RETRIES,
  RATING_MAX_TOKENS,
  buildRatingPrompt,
  parseRatingResponse,
} from './quality-rater-helpers.js';
import { canAfford } from '../cost/budget.js';
import { calculateCost } from '../cost/pricing.js';
import { recordQualityFeedback } from '../persistence/routing-history.js';
import { orchestratorLogger } from '../utils/logger.js';

/**
 * Create a quality rater configured with the given dependencies.
 * The rater evaluates small-tier model outputs using a medium-tier model
 * and stores quality feedback for future routing improvements.
 *
 * @param deps - Injected dependencies including db, provider, and budget.
 * @returns A QualityRater instance with shouldRate, rateOutput, and shouldRetry methods.
 */
export function createQualityRater(deps: QualityRaterDeps): QualityRater {
  let totalSpentUsd = 0;

  return {
    /**
     * Determine whether a given model tier should have its output rated.
     * Only small-tier outputs are rated; medium and large are assumed sufficient.
     * @param tier - The model tier of the completion.
     * @param _model - The model identifier (unused, reserved for future per-model rules).
     * @returns True if the tier is 'small'.
     */
    shouldRate(tier: ModelTier, _model: string): boolean {
      return tier === 'small';
    },

    /**
     * Rate the quality of an assistant response by sending it to a medium-tier model.
     * Checks budget affordability before making the LLM call. Parses the response
     * as JSON and stores the quality feedback in routing history.
     *
     * @param input - The rating input with task context and response text.
     * @returns A RatingResult with score, feedback, cost, and token usage.
     */
    async rateOutput(input: RateInput): Promise<RatingResult> {
      try {
        // Estimate cost of the rating call
        const promptText = buildRatingPrompt(input.userMessage, input.assistantResponse);
        const estimatedInputTokens = deps.provider.countTokens(promptText);
        const estimatedCost = calculateCost('claude-sonnet-4-5-20250929', estimatedInputTokens, RATING_MAX_TOKENS);

        // Budget check: skip rating if can't afford
        if (!canAfford(totalSpentUsd, deps.costBudgetUsd, estimatedCost)) {
          orchestratorLogger.info(
            { taskId: input.taskId, estimatedCost, budget: deps.costBudgetUsd },
            'Skipping quality rating — budget too tight',
          );
          return {
            score: 0.5,
            feedback: 'Rating skipped due to budget constraints',
            ratingModel: 'none',
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
          };
        }

        // Make the rating LLM call
        const response = await deps.provider.chat(
          [{ role: 'user', content: promptText }],
          {
            model: 'claude-sonnet-4-5-20250929',
            maxTokens: RATING_MAX_TOKENS,
            temperature: 0,
          },
        );

        // Calculate actual cost
        const actualCost = calculateCost(
          'claude-sonnet-4-5-20250929',
          response.usage.inputTokens,
          response.usage.outputTokens,
          response.usage.cacheReadTokens ?? 0,
        );
        totalSpentUsd += actualCost;

        // Extract text from response
        const responseText = response.content
          .filter((block) => block.type === 'text' && block.text)
          .map((block) => block.text ?? '')
          .join('');

        // Parse the rating
        const { score, feedback } = parseRatingResponse(responseText);

        // Store in routing history
        recordQualityFeedback(deps.db, input.taskId, score, feedback);

        orchestratorLogger.info(
          { taskId: input.taskId, score, feedback, costUsd: actualCost },
          'Quality rating completed',
        );

        return {
          score,
          feedback,
          ratingModel: response.model,
          costUsd: actualCost,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        orchestratorLogger.error(
          { taskId: input.taskId, error: errorMessage },
          'Quality rating failed',
        );
        return {
          score: 0.5,
          feedback: `Rating failed: ${errorMessage}`,
          ratingModel: 'none',
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
    },

    /**
     * Determine whether a task should be retried based on its quality rating.
     * Returns true only if the score is below the retry threshold and the
     * maximum number of retries has not been reached.
     *
     * @param rating - The rating result to evaluate.
     * @param retryCount - Number of retries already attempted for this task.
     * @returns True if the task should be retried with a higher-tier model.
     */
    shouldRetry(rating: RatingResult, retryCount: number): boolean {
      return rating.score < RETRY_THRESHOLD && retryCount < MAX_RETRIES;
    },
  };
}
