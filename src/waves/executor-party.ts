/**
 * Party wave execution engine.
 * Handles execution of external-facing waves with sanitized context
 * and output filtering to prevent owner data leakage.
 *
 * Party waves are the "EA for others" — capabilities exposed to
 * external contacts with trust-level-appropriate access controls.
 *
 * Separated from executor.ts to keep files under 300 lines.
 */

import type { Wave, WavePlan } from '../types/index.js';
import { calculateCost } from '../cost/pricing.js';
import { selectModel } from '../providers/router.js';
import { createModuleLogger } from '../utils/logger.js';
import { BudgetExceededError } from '../errors.js';
import type { WaveExecutionResult, WaveExecutorDeps } from './executor.js';
import {
  callLLMForParamExtraction,
  parseExtractedParams,
  runValidationIfPresent,
  assertCanAfford,
  buildFailureResult,
} from './executor-helpers.js';
import {
  buildPartyWaveContext,
  sanitizePartyWaveOutput,
  validateExtractedParams,
} from './party-wave-context.js';
import { createPartyWaveDbProxy } from './party-wave-db-proxy.js';

const partyExecutorLogger = createModuleLogger('party-wave-executor');

/**
 * Execute a party wave with restricted context and output sanitization.
 * Ensures external-facing wave execution never leaks owner-private data.
 *
 * Uses the same deterministic/non-deterministic split as the main executor,
 * but wraps context building and output filtering for security.
 *
 * @param wave - The party wave to execute.
 * @param userMessage - The raw user message from the external contact.
 * @param deps - Injected dependencies (must include externalContact).
 * @returns A WaveExecutionResult with sanitized output.
 */
export async function executePartyWave(
  wave: Wave,
  userMessage: string,
  deps: WaveExecutorDeps,
): Promise<WaveExecutionResult> {
  const waveName = wave.manifest.name;
  const isDeterministic = wave.manifest.deterministic;
  const contact = deps.externalContact;

  if (!contact) {
    partyExecutorLogger.error({ waveName }, 'Party wave executed without external contact');
    return buildFailureResult(
      `Party wave "${waveName}" requires an external contact`,
      isDeterministic,
    );
  }

  partyExecutorLogger.info(
    { waveName, contactId: contact.id, trustLevel: contact.trustLevel, isDeterministic },
    'Starting party wave execution with sanitized context',
  );

  try {
    const result = isDeterministic
      ? await executePartyDeterministic(wave, userMessage, deps)
      : await executePartyNonDeterministic(wave, userMessage, deps);

    // Post-execution: sanitize output to prevent data leakage
    if (result.success) {
      result.output = sanitizePartyWaveOutput(result.output);
    }

    partyExecutorLogger.info(
      { waveName, contactId: contact.id, success: result.success },
      'Party wave execution complete',
    );

    return result;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    partyExecutorLogger.error(
      { waveName, contactId: contact.id, error: errorMessage },
      'Party wave execution failed',
    );

    if (error instanceof BudgetExceededError) {
      return buildFailureResult(
        `Budget exceeded while executing party wave "${waveName}"`,
        isDeterministic,
      );
    }

    return buildFailureResult(
      `Party wave "${waveName}" execution failed: ${errorMessage}`,
      isDeterministic,
    );
  }
}

/**
 * Execute a deterministic party wave with sanitized context.
 * Same as the main deterministic path but builds a restricted context.
 *
 * @param wave - The deterministic party wave.
 * @param userMessage - The raw user message.
 * @param deps - Injected dependencies.
 * @returns A WaveExecutionResult.
 */
async function executePartyDeterministic(
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

  // Step 4: Parse extracted parameters and VALIDATE for data leakage
  const rawParams = parseExtractedParams(extractionResponse);
  const extractedParams = validateExtractedParams(rawParams, waveName);

  // Step 5: Build SANITIZED context with DB proxy (party wave safety)
  const dbProxy = createPartyWaveDbProxy(deps.db, waveName, deps.externalContact!.id);
  const waveDeps = {
    db: dbProxy,
    getAccessToken: deps.getAccessToken,
  };

  const sanitizedContext = buildPartyWaveContext(
    { _deps: waveDeps, ...extractedParams },
    deps.externalContact!,
  );

  const plan: WavePlan = {
    steps: wave.manifest.tools.map((tool) => ({
      type: 'api_call' as const,
      description: tool.description,
      params: extractedParams,
    })),
    estimatedCostUsd: extractionCost,
    isDeterministic: true,
    extractedParams: sanitizedContext,
  };

  // Step 6: Execute the wave
  const toolResult = await wave.execute(plan);

  // Step 7: Validate
  const validationResult = await runValidationIfPresent(wave, toolResult);

  const outputText = validationResult.valid
    ? toolResult.output
    : `${toolResult.output}\n[Validation feedback: ${validationResult.feedback ?? 'unknown issue'}]`;

  partyExecutorLogger.debug(
    { waveName, success: toolResult.success, llmCalls: 1 },
    'Deterministic party wave execution complete',
  );

  return {
    success: toolResult.success && validationResult.valid,
    output: outputText,
    tokensUsed: {
      input: extractionResponse.usage.inputTokens,
      output: extractionResponse.usage.outputTokens,
    },
    costUsd: extractionCost,
    llmCallCount: 1,
    wasDeterministic: true,
  };
}

/**
 * Execute a non-deterministic party wave with sanitized context.
 * Same as the main non-deterministic path but uses restricted context.
 *
 * @param wave - The non-deterministic party wave.
 * @param userMessage - The raw user message.
 * @param deps - Injected dependencies.
 * @returns A WaveExecutionResult.
 */
async function executePartyNonDeterministic(
  wave: Wave,
  userMessage: string,
  deps: WaveExecutorDeps,
): Promise<WaveExecutionResult> {
  const waveName = wave.manifest.name;

  // Step 1: Select MEDIUM model
  const modelSelection = selectModel('medium', deps.enabledProviders);

  // Step 2: Budget check
  const estimatedPlanCost = calculateCost(modelSelection.model, 1000, 500);
  assertCanAfford(deps, estimatedPlanCost);

  // Step 3: Build SANITIZED context with DB proxy and plan
  const dbProxy = createPartyWaveDbProxy(deps.db, waveName, deps.externalContact!.id);
  const waveDeps = {
    db: dbProxy,
    getAccessToken: deps.getAccessToken,
  };

  const sanitizedContext = buildPartyWaveContext(
    { _deps: waveDeps },
    deps.externalContact!,
  );

  const plan = await wave.plan(userMessage, sanitizedContext);

  // Step 4: Budget check for execution
  assertCanAfford(deps, plan.estimatedCostUsd);

  // Step 5: Execute
  const toolResult = await wave.execute(plan);

  // Step 6: Validate
  const validationResult = await runValidationIfPresent(wave, toolResult);

  const outputText = validationResult.valid
    ? toolResult.output
    : `${toolResult.output}\n[Validation feedback: ${validationResult.feedback ?? 'unknown issue'}]`;

  partyExecutorLogger.debug(
    { waveName, success: toolResult.success, llmCalls: 2 },
    'Non-deterministic party wave execution complete',
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
