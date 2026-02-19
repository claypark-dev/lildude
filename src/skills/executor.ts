/**
 * Deterministic-first skill execution engine.
 * Routes matched skills through either a deterministic path (1 LLM call for
 * parameter extraction) or a full planning path (skill.plan + skill.execute).
 * Always checks canAfford() before every LLM call and tracks token usage.
 * See HLD Section 4.2 for skill execution architecture.
 */

import type {
  Skill,
  SkillPlan,
} from '../types/index.js';
import type BetterSqlite3 from 'better-sqlite3';
import type { LLMProvider } from '../types/index.js';
import { calculateCost } from '../cost/pricing.js';
import { selectModel } from '../providers/router.js';
import { createModuleLogger } from '../utils/logger.js';
import { BudgetExceededError } from '../errors.js';
import {
  callLLMForParamExtraction,
  parseExtractedParams,
  runValidationIfPresent,
  assertCanAfford,
  buildFailureResult,
} from './executor-helpers.js';

const executorLogger = createModuleLogger('skill-executor');

/** Result of a skill execution, including cost and token tracking. */
export interface SkillExecutionResult {
  success: boolean;
  output: string;
  tokensUsed: { input: number; output: number };
  costUsd: number;
  llmCallCount: number;
  wasDeterministic: boolean;
}

/** Dependencies injected into the skill executor. */
export interface SkillExecutorDeps {
  db: BetterSqlite3.Database;
  provider: LLMProvider;
  taskBudgetUsd: number;
  taskSpentUsd: number;
  enabledProviders: string[];
}

/**
 * Execute a matched skill, choosing the deterministic or full-planning path
 * based on the skill manifest's `deterministic` flag.
 *
 * Deterministic path: 1 LLM call (SMALL model) to extract parameters,
 * then direct skill.execute() with no further LLM involvement.
 *
 * Non-deterministic path: MEDIUM model calls skill.plan(), then skill.execute(),
 * with full LLM-guided planning.
 *
 * @param skill - The matched Skill to execute.
 * @param userMessage - The raw user message to extract parameters from.
 * @param deps - Injected dependencies (db, provider, budget, etc.).
 * @returns A SkillExecutionResult with output, cost, and token tracking.
 */
export async function executeSkill(
  skill: Skill,
  userMessage: string,
  deps: SkillExecutorDeps,
): Promise<SkillExecutionResult> {
  const skillName = skill.manifest.name;
  const isDeterministic = skill.manifest.deterministic;

  executorLogger.info(
    { skillName, isDeterministic },
    'Starting skill execution',
  );

  try {
    if (isDeterministic) {
      return await executeDeterministic(skill, userMessage, deps);
    }
    return await executeNonDeterministic(skill, userMessage, deps);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    executorLogger.error(
      { skillName, error: errorMessage },
      'Skill execution failed',
    );

    if (error instanceof BudgetExceededError) {
      return buildFailureResult(
        `Budget exceeded while executing skill "${skillName}": ${errorMessage}`,
        isDeterministic,
      );
    }

    return buildFailureResult(
      `Skill "${skillName}" execution failed: ${errorMessage}`,
      isDeterministic,
    );
  }
}

/**
 * Execute a deterministic skill: extract params with a SMALL model,
 * then call skill.execute() directly without further LLM involvement.
 *
 * @param skill - The deterministic skill to execute.
 * @param userMessage - The raw user message.
 * @param deps - Injected dependencies.
 * @returns A SkillExecutionResult.
 */
async function executeDeterministic(
  skill: Skill,
  userMessage: string,
  deps: SkillExecutorDeps,
): Promise<SkillExecutionResult> {
  const skillName = skill.manifest.name;

  // Step 1: Select SMALL model for parameter extraction
  const modelSelection = selectModel('small', deps.enabledProviders);

  // Step 2: Budget check before LLM call
  const estimatedCost = calculateCost(modelSelection.model, 500, 200);
  assertCanAfford(deps, estimatedCost);

  // Step 3: Extract parameters with a single LLM call
  const extractionResponse = await callLLMForParamExtraction(
    deps.provider,
    modelSelection.model,
    skill,
    userMessage,
  );

  const extractionCost = calculateCost(
    modelSelection.model,
    extractionResponse.usage.inputTokens,
    extractionResponse.usage.outputTokens,
    extractionResponse.usage.cacheReadTokens ?? 0,
  );

  const totalInputTokens = extractionResponse.usage.inputTokens;
  const totalOutputTokens = extractionResponse.usage.outputTokens;

  // Step 4: Parse extracted parameters from LLM response
  const extractedParams = parseExtractedParams(extractionResponse);

  executorLogger.debug(
    { skillName, extractedParams },
    'Parameters extracted for deterministic skill',
  );

  // Step 5: Build a SkillPlan with the extracted params
  const plan: SkillPlan = {
    steps: skill.manifest.tools.map((tool) => ({
      type: 'api_call' as const,
      description: tool.description,
      params: extractedParams,
    })),
    estimatedCostUsd: extractionCost,
    isDeterministic: true,
    extractedParams,
  };

  // Step 6: Execute the skill directly (no LLM call)
  const toolResult = await skill.execute(plan);

  // Step 7: Optionally validate the result
  const validationResult = await runValidationIfPresent(skill, toolResult);

  const outputText = validationResult.valid
    ? toolResult.output
    : `${toolResult.output}\n[Validation feedback: ${validationResult.feedback ?? 'unknown issue'}]`;

  executorLogger.info(
    { skillName, success: toolResult.success, llmCalls: 1 },
    'Deterministic skill execution complete',
  );

  return {
    success: toolResult.success && validationResult.valid,
    output: outputText,
    tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
    costUsd: extractionCost,
    llmCallCount: 1,
    wasDeterministic: true,
  };
}

/**
 * Execute a non-deterministic skill: use MEDIUM model for full planning
 * via skill.plan(), then execute with skill.execute().
 *
 * @param skill - The non-deterministic skill to execute.
 * @param userMessage - The raw user message.
 * @param deps - Injected dependencies.
 * @returns A SkillExecutionResult.
 */
async function executeNonDeterministic(
  skill: Skill,
  userMessage: string,
  deps: SkillExecutorDeps,
): Promise<SkillExecutionResult> {
  const skillName = skill.manifest.name;

  // Step 1: Select MEDIUM model for planning
  const modelSelection = selectModel('medium', deps.enabledProviders);

  // Step 2: Budget check before planning LLM call
  const estimatedPlanCost = calculateCost(modelSelection.model, 1000, 500);
  assertCanAfford(deps, estimatedPlanCost);

  // Step 3: Call skill.plan() to generate a SkillPlan (uses LLM internally)
  const plan = await skill.plan(userMessage, {});

  executorLogger.debug(
    { skillName, stepCount: plan.steps.length, isDeterministic: plan.isDeterministic },
    'Non-deterministic skill plan generated',
  );

  // Step 4: Budget check before execution
  assertCanAfford(deps, plan.estimatedCostUsd);

  // Step 5: Execute the plan
  const toolResult = await skill.execute(plan);

  // Step 6: Optionally validate the result
  const validationResult = await runValidationIfPresent(skill, toolResult);

  const outputText = validationResult.valid
    ? toolResult.output
    : `${toolResult.output}\n[Validation feedback: ${validationResult.feedback ?? 'unknown issue'}]`;

  executorLogger.info(
    { skillName, success: toolResult.success, llmCalls: 2 },
    'Non-deterministic skill execution complete',
  );

  return {
    success: toolResult.success && validationResult.valid,
    output: outputText,
    tokensUsed: { input: 0, output: 0 },
    costUsd: plan.estimatedCostUsd,
    llmCallCount: 2,
    wasDeterministic: false,
  };
}
