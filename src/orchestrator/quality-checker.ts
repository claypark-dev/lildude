/**
 * Standalone post-task quality checker.
 * Called after the agent loop completes a task to optionally rate the
 * output quality of small-tier model completions using a medium-tier model.
 * See S4.T.3 — Agent Hierarchy (Multi-Agent Rating).
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { LLMProvider, ModelSelection } from '../types/index.js';
import type { QualityCheckResult } from './quality-rater-helpers.js';
import { createQualityRater } from './quality-rater.js';
import { orchestratorLogger } from '../utils/logger.js';

/**
 * Run a post-task quality check on the agent's response.
 * Only rates small-tier model outputs. Creates a quality rater,
 * evaluates the response, and stores the feedback in routing history.
 *
 * @param db - The database connection for persisting quality feedback.
 * @param taskId - The unique identifier of the completed task.
 * @param userMessage - The original user message that triggered the task.
 * @param assistantResponse - The assistant's response text to evaluate.
 * @param modelSelection - The model selection used for the task.
 * @param raterProvider - A medium-tier LLM provider for performing the rating.
 * @param taskSpentUsd - Amount already spent on this task in USD.
 * @param taskBudgetUsd - Maximum budget allocated to this task in USD.
 * @returns A QualityCheckResult indicating whether rating occurred and the outcome.
 */
export async function runPostTaskQualityCheck(
  db: BetterSqlite3.Database,
  taskId: string,
  userMessage: string,
  assistantResponse: string,
  modelSelection: ModelSelection,
  raterProvider: LLMProvider,
  taskSpentUsd: number,
  taskBudgetUsd: number,
): Promise<QualityCheckResult> {
  try {
    // Only rate small-tier outputs
    if (modelSelection.tier !== 'small') {
      return { rated: false, shouldRetry: false };
    }

    // Calculate remaining budget for the rating call
    const remainingBudget = Math.max(0, taskBudgetUsd - taskSpentUsd);
    if (remainingBudget <= 0) {
      orchestratorLogger.debug(
        { taskId },
        'Skipping quality check — no remaining budget',
      );
      return { rated: false, shouldRetry: false };
    }

    const rater = createQualityRater({
      db,
      provider: raterProvider,
      costBudgetUsd: remainingBudget,
    });

    // Confirm we should rate this tier/model
    if (!rater.shouldRate(modelSelection.tier, modelSelection.model)) {
      return { rated: false, shouldRetry: false };
    }

    // Perform the rating
    const rating = await rater.rateOutput({
      taskId,
      userMessage,
      assistantResponse,
      model: modelSelection.model,
      tier: modelSelection.tier,
    });

    const retry = rater.shouldRetry(rating, 0);

    return {
      rated: true,
      score: rating.score,
      shouldRetry: retry,
      feedback: rating.feedback,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    orchestratorLogger.error(
      { taskId, error: errorMessage },
      'Post-task quality check failed',
    );
    return { rated: false, shouldRetry: false };
  }
}
