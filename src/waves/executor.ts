/**
 * Deterministic-first wave execution engine.
 * Routes matched waves through either a deterministic path (1 LLM call for
 * parameter extraction) or a full planning path (wave.plan + wave.execute).
 * Always checks canAfford() before every LLM call and tracks token usage.
 * See HLD Section 4.2 for wave execution architecture.
 */

import type {
  Wave,
  WavePlan,
  ModelTier,
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
import { executePartyWave } from './executor-party.js';

const executorLogger = createModuleLogger('wave-executor');

/** Result of a wave execution, including cost and token tracking. */
export interface WaveExecutionResult {
  success: boolean;
  output: string;
  tokensUsed: { input: number; output: number };
  costUsd: number;
  llmCallCount: number;
  wasDeterministic: boolean;
}

/** Dependencies injected into the wave executor. */
export interface WaveExecutorDeps {
  db: BetterSqlite3.Database;
  provider: LLMProvider;
  taskBudgetUsd: number;
  taskSpentUsd: number;
  enabledProviders: string[];
  /** User's security level (1-5). Affects model tier requirements for non-deterministic waves. */
  securityLevel?: number;
  /** OAuth access token getter — returns a valid token for a given provider, or null. */
  getAccessToken?: (provider: string) => Promise<string | null>;
  /** External contact triggering the wave (set for party wave execution). */
  externalContact?: import('../types/index.js').Contact;
}

/**
 * Execute a matched wave, choosing the deterministic or full-planning path
 * based on the wave manifest's `deterministic` flag.
 *
 * Deterministic path: 1 LLM call (SMALL model) to extract parameters,
 * then direct wave.execute() with no further LLM involvement.
 *
 * Non-deterministic path: MEDIUM model calls wave.plan(), then wave.execute(),
 * with full LLM-guided planning.
 *
 * @param wave - The matched Wave to execute.
 * @param userMessage - The raw user message to extract parameters from.
 * @param deps - Injected dependencies (db, provider, budget, etc.).
 * @returns A WaveExecutionResult with output, cost, and token tracking.
 */
export async function executeWave(
  wave: Wave,
  userMessage: string,
  deps: WaveExecutorDeps,
): Promise<WaveExecutionResult> {
  const waveName = wave.manifest.name;
  const isDeterministic = wave.manifest.deterministic;
  const isPartyWave = wave.manifest.waveCategory === 'party';

  executorLogger.info(
    { waveName, isDeterministic, isPartyWave },
    'Starting wave execution',
  );

  // Route party waves through the restricted execution path
  if (isPartyWave && deps.externalContact) {
    return executePartyWave(wave, userMessage, deps);
  }

  try {
    if (isDeterministic) {
      return await executeDeterministic(wave, userMessage, deps);
    }
    return await executeNonDeterministic(wave, userMessage, deps);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    executorLogger.error(
      { waveName, error: errorMessage },
      'Wave execution failed',
    );

    if (error instanceof BudgetExceededError) {
      return buildFailureResult(
        `Budget exceeded while executing wave "${waveName}": ${errorMessage}`,
        isDeterministic,
      );
    }

    return buildFailureResult(
      `Wave "${waveName}" execution failed: ${errorMessage}`,
      isDeterministic,
    );
  }
}

/**
 * Execute a deterministic wave: extract params with a SMALL model,
 * then call wave.execute() directly without further LLM involvement.
 *
 * @param wave - The deterministic wave to execute.
 * @param userMessage - The raw user message.
 * @param deps - Injected dependencies.
 * @returns A WaveExecutionResult.
 */
async function executeDeterministic(
  wave: Wave,
  userMessage: string,
  deps: WaveExecutorDeps,
): Promise<WaveExecutionResult> {
  const waveName = wave.manifest.name;

  // Step 1: Select SMALL model for parameter extraction
  const modelSelection = selectModel('small', deps.enabledProviders);

  // Step 2: Budget check before LLM call
  const estimatedCost = calculateCost(modelSelection.model, 500, 200);
  assertCanAfford(deps, estimatedCost);

  // Step 3: Extract parameters with a single LLM call
  const extractionResponse = await callLLMForParamExtraction(
    deps.provider,
    modelSelection.model,
    wave,
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
    { waveName, extractedParams },
    'Parameters extracted for deterministic wave',
  );

  // Step 5: Build a WavePlan with the extracted params + injected deps
  const waveDeps = {
    db: deps.db,
    getAccessToken: deps.getAccessToken,
  };

  const plan: WavePlan = {
    steps: wave.manifest.tools.map((tool) => ({
      type: 'api_call' as const,
      description: tool.description,
      params: extractedParams,
    })),
    estimatedCostUsd: extractionCost,
    isDeterministic: true,
    extractedParams: { ...extractedParams, _deps: waveDeps },
  };

  // Step 6: Execute the wave directly (no LLM call)
  const toolResult = await wave.execute(plan);

  // Step 7: Optionally validate the result
  const validationResult = await runValidationIfPresent(wave, toolResult);

  const outputText = validationResult.valid
    ? toolResult.output
    : `${toolResult.output}\n[Validation feedback: ${validationResult.feedback ?? 'unknown issue'}]`;

  executorLogger.info(
    { waveName, success: toolResult.success, llmCalls: 1 },
    'Deterministic wave execution complete',
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
 * Determine the required model tier for a non-deterministic wave based on security level.
 * Higher security levels demand larger, more capable models.
 *
 * - Security 1-2 (strict): Require medium-tier model (no fallback to undersized models).
 * - Security 3 (standard): Require medium-tier (Ollama-only fallback allowed by the router).
 * - Security 4-5 (permissive): Any model can attempt it (small tier is fine).
 *
 * @param securityLevel - The user's security level (1-5).
 * @returns The minimum ModelTier required.
 */
export function getRequiredTierForNonDeterministic(securityLevel: number): ModelTier {
  if (securityLevel >= 4) {
    return 'small';
  }
  return 'medium';
}

/**
 * Execute a non-deterministic wave: model tier depends on security level.
 * Higher security requires larger models; lower security allows any model.
 *
 * @param wave - The non-deterministic wave to execute.
 * @param userMessage - The raw user message.
 * @param deps - Injected dependencies.
 * @returns A WaveExecutionResult.
 */
async function executeNonDeterministic(
  wave: Wave,
  userMessage: string,
  deps: WaveExecutorDeps,
): Promise<WaveExecutionResult> {
  const waveName = wave.manifest.name;
  const securityLevel = deps.securityLevel ?? 3;

  // Step 1: Select model — tier depends on security level
  const requiredTier = getRequiredTierForNonDeterministic(securityLevel);
  executorLogger.info(
    { waveName, securityLevel, requiredTier },
    'Non-deterministic wave tier selection',
  );
  const modelSelection = selectModel(requiredTier, deps.enabledProviders);

  // Step 2: Budget check before planning LLM call
  const estimatedPlanCost = calculateCost(modelSelection.model, 1000, 500);
  assertCanAfford(deps, estimatedPlanCost);

  // Step 3: Call wave.plan() with injected deps context
  const waveDeps = {
    db: deps.db,
    getAccessToken: deps.getAccessToken,
  };
  const plan = await wave.plan(userMessage, { _deps: waveDeps });

  executorLogger.debug(
    { waveName, stepCount: plan.steps.length, isDeterministic: plan.isDeterministic },
    'Non-deterministic wave plan generated',
  );

  // Step 4: Budget check before execution
  assertCanAfford(deps, plan.estimatedCostUsd);

  // Step 5: Execute the plan
  const toolResult = await wave.execute(plan);

  // Step 6: Optionally validate the result
  const validationResult = await runValidationIfPresent(wave, toolResult);

  const outputText = validationResult.valid
    ? toolResult.output
    : `${toolResult.output}\n[Validation feedback: ${validationResult.feedback ?? 'unknown issue'}]`;

  executorLogger.info(
    { waveName, success: toolResult.success, llmCalls: 2 },
    'Non-deterministic wave execution complete',
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
