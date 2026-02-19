/**
 * Agent loop — the central nervous system of Lil Dude.
 * Processes user messages through a pipeline of input sanitization,
 * permission gating, cost control, model routing, context building,
 * LLM calls with tool-use loops, and cost tracking.
 * See HLD Section 3 and Section 12 for kill conditions.
 */

import type { ChatResponse, Message, ChannelType, ModelSelection } from '../types/index.js';
import { checkForInjection } from '../security/injection.js';
import { canAfford, isWithinMonthlyBudget } from '../cost/budget.js';
import { calculateCost } from '../cost/pricing.js';
import { classifyComplexity, selectModel } from '../providers/router.js';
import { buildContext } from '../context/manager.js';
import { createToolExecutor } from '../tools/executor.js';
import { CORE_TOOLS } from '../tools/definitions.js';
import { recordTokenUsage } from '../persistence/token-usage.js';
import { getMonthlyTotalCost } from '../persistence/token-usage.js';
import {
  createConversation,
  getConversation,
  incrementMessageCount,
} from '../persistence/conversations.js';
import { appendConversationLog } from '../persistence/conversation-logs.js';
import { createTask, updateTaskStatus, updateTaskSpend } from '../persistence/tasks.js';
import { orchestratorLogger } from '../utils/logger.js';
import {
  DEFAULT_MAX_ROUND_TRIPS,
  DEFAULT_MAX_TOKENS_PER_TASK,
  DEFAULT_MAX_DURATION_MS,
  DEFAULT_MAX_CONSECUTIVE_ERRORS,
  DEFAULT_TASK_BUDGET_USD,
  extractResponseText,
  executeTools,
  buildResult,
  triggerSummarizationIfNeeded,
} from './agent-loop-helpers.js';
import type {
  AgentLoopDeps,
  AgentLoopConfig,
  AgentLoopResult,
  AgentLoop,
} from './agent-loop-helpers.js';

// Re-export types so existing consumers aren't broken
export type { AgentLoopDeps, AgentLoopConfig, AgentLoopResult, AgentLoop };

/**
 * Create an agent loop configured with the given dependencies.
 * The agent loop processes messages through the full pipeline:
 * sanitization, permission gate, cost gate, model routing,
 * context building, LLM call with tool-use loop, and cost tracking.
 *
 * @param deps - The injected dependencies (db, provider, security level, etc.).
 * @param config - Optional kill condition overrides.
 * @returns An AgentLoop instance.
 */
export function createAgentLoop(
  deps: AgentLoopDeps,
  config?: AgentLoopConfig,
): AgentLoop {
  const maxRoundTrips = config?.maxRoundTrips ?? DEFAULT_MAX_ROUND_TRIPS;
  const maxTokensPerTask = config?.maxTokensPerTask ?? DEFAULT_MAX_TOKENS_PER_TASK;
  const maxDurationMs = config?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const maxConsecutiveErrors = config?.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
  const taskBudgetUsd = config?.taskBudgetUsd ?? DEFAULT_TASK_BUDGET_USD;
  const enabledProviders = config?.enabledProviders ?? [deps.provider.name];

  return {
    async processMessage(
      conversationId: string,
      userMessage: string,
      channelType: ChannelType,
    ): Promise<AgentLoopResult> {
      const startTime = Date.now();
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;
      let toolCallCount = 0;
      let roundTrips = 0;

      try {
        // Step 1: Input sanitization — check for prompt injection
        const sanitizationResult = checkForInjection(userMessage, 'user');
        if (!sanitizationResult.isClean) {
          orchestratorLogger.warn(
            { conversationId, threats: sanitizationResult.threats },
            'Prompt injection detected in user message',
          );
          return buildResult(
            'I detected potentially harmful content in your message and cannot process it. Please rephrase your request.',
            totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips,
          );
        }

        // Step 2: Create task for tracking
        const task = createTask(deps.db, {
          type: 'chat',
          description: userMessage.slice(0, 200),
          channelType,
          channelId: conversationId,
          tokenBudgetUsd: taskBudgetUsd,
        });
        const taskId = task.id;
        updateTaskStatus(deps.db, taskId, 'running');

        // Step 3: Ensure conversation exists
        if (!getConversation(deps.db, conversationId)) {
          createConversation(deps.db, { channelType, channelId: conversationId, taskId });
        }

        // Step 4: Monthly budget check
        const monthlySpent = getMonthlyTotalCost(deps.db);
        if (!isWithinMonthlyBudget(monthlySpent, deps.monthlyBudgetUsd, 0)) {
          updateTaskStatus(deps.db, taskId, 'failed', 'Monthly budget exceeded');
          return buildResult(
            'Monthly budget has been exceeded. Please adjust your budget or wait until next month.',
            totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips,
          );
        }

        // Step 5: Model routing
        const tier = classifyComplexity(userMessage, false);
        let modelSelection: ModelSelection;
        try {
          modelSelection = selectModel(tier, enabledProviders);
        } catch {
          updateTaskStatus(deps.db, taskId, 'failed', 'No model available');
          return buildResult(
            'No suitable model is available for this request. Please check your provider configuration.',
            totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips,
          );
        }

        // Step 6: Build context
        const contextPayload = await buildContext(deps.db, conversationId, userMessage, {
          userName: deps.userName,
          securityLevel: deps.securityLevel,
        });

        // Step 7: Log user message
        appendConversationLog(deps.db, {
          conversationId, role: 'user', content: userMessage, tokenCount: contextPayload.totalTokens,
        });

        // Step 8: Pre-call cost gate
        const estimatedCost = calculateCost(modelSelection.model, contextPayload.totalTokens, 1000);
        if (!canAfford(totalCostUsd, taskBudgetUsd, estimatedCost)) {
          updateTaskStatus(deps.db, taskId, 'failed', 'Task budget exceeded before first call');
          return buildResult(
            'This request would exceed the task budget. Please try a simpler request.',
            totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips,
          );
        }

        // Step 9: Create tool executor
        const toolExecutor = createToolExecutor(deps.db, deps.securityLevel, taskId);

        // Step 10: LLM call with tool-use loop
        const messages: Message[] = [...contextPayload.messages];
        let consecutiveErrors = 0;

        while (roundTrips < maxRoundTrips) {
          if (Date.now() - startTime > maxDurationMs) {
            orchestratorLogger.warn({ taskId, roundTrips }, 'Max duration exceeded');
            updateTaskStatus(deps.db, taskId, 'killed', 'Max duration exceeded');
            return buildResult('I ran out of time processing your request. Here is what I have so far.',
              totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
          }

          if (totalInputTokens + totalOutputTokens > maxTokensPerTask) {
            orchestratorLogger.warn({ taskId, roundTrips }, 'Max tokens per task exceeded');
            updateTaskStatus(deps.db, taskId, 'killed', 'Max tokens exceeded');
            return buildResult('Token limit for this task has been reached.',
              totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
          }

          const preCallEstimate = calculateCost(modelSelection.model, 1000, 1000);
          if (!canAfford(totalCostUsd, taskBudgetUsd, preCallEstimate)) {
            orchestratorLogger.warn({ taskId, totalCostUsd }, 'Task budget exceeded');
            updateTaskStatus(deps.db, taskId, 'failed', 'Task budget exceeded');
            return buildResult('Task budget has been exceeded.',
              totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
          }

          let response: ChatResponse;
          try {
            response = await deps.provider.chat(messages, {
              model: modelSelection.model, maxTokens: 4096, tools: CORE_TOOLS,
              systemPrompt: contextPayload.systemPrompt,
            });
            consecutiveErrors = 0;
          } catch (error: unknown) {
            consecutiveErrors++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            orchestratorLogger.error({ taskId, roundTrips, error: errorMessage }, 'LLM call failed');
            if (consecutiveErrors >= maxConsecutiveErrors) {
              updateTaskStatus(deps.db, taskId, 'failed', 'Max consecutive errors');
              return buildResult('I encountered repeated errors trying to process your request. Please try again later.',
                totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
            }
            continue;
          }

          roundTrips++;
          const callCost = calculateCost(modelSelection.model, response.usage.inputTokens,
            response.usage.outputTokens, response.usage.cacheReadTokens ?? 0);
          totalInputTokens += response.usage.inputTokens;
          totalOutputTokens += response.usage.outputTokens;
          totalCostUsd += callCost;

          recordTokenUsage(deps.db, {
            taskId, provider: deps.provider.name, model: modelSelection.model,
            inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens,
            cachedTokens: response.usage.cacheReadTokens ?? 0, costUsd: callCost, roundTripNumber: roundTrips,
          });

          if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
            const responseText = extractResponseText(response);
            appendConversationLog(deps.db, {
              conversationId, role: 'assistant', content: responseText, tokenCount: response.usage.outputTokens,
            });
            incrementMessageCount(deps.db, conversationId, response.usage.inputTokens + response.usage.outputTokens);
            updateTaskSpend(deps.db, taskId, totalCostUsd);
            updateTaskStatus(deps.db, taskId, 'completed');
            triggerSummarizationIfNeeded(deps.db, conversationId, deps.provider, totalCostUsd, taskBudgetUsd);
            return buildResult(responseText, totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
          }

          if (response.stopReason === 'tool_use') {
            const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');
            messages.push({ role: 'assistant', content: response.content });
            const toolResultBlocks = await executeTools(toolExecutor, toolUseBlocks);
            toolCallCount += toolUseBlocks.length;
            messages.push({ role: 'user', content: toolResultBlocks });
            continue;
          }

          const responseText = extractResponseText(response);
          updateTaskSpend(deps.db, taskId, totalCostUsd);
          updateTaskStatus(deps.db, taskId, 'completed');
          return buildResult(responseText || 'I completed your request.',
            totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
        }

        orchestratorLogger.warn({ conversationId, roundTrips }, 'Max round trips reached');
        updateTaskStatus(deps.db, task.id, 'killed', 'Max round trips exceeded');
        return buildResult('I reached the maximum number of processing steps for this request.',
          totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        orchestratorLogger.error({ conversationId, error: errorMessage }, 'Unhandled error in agent loop');
        return buildResult('An unexpected error occurred while processing your request. Please try again.',
          totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
      }
    },
  };
}
