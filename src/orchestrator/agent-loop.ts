/**
 * Agent loop — the central nervous system of Lil Dude.
 * Processes user messages through a pipeline of input sanitization,
 * permission gating, cost control, model routing, context building,
 * LLM calls with tool-use loops, and cost tracking.
 * See HLD Section 3 and Section 12 for kill conditions.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type {
  LLMProvider,
  ChatResponse,
  ContentBlock,
  Message,
  ChannelType,
  ModelSelection,
} from '../types/index.js';
import type { SecurityLevel } from '../security/permissions.js';
import { checkForInjection } from '../security/injection.js';
import { canAfford, isWithinMonthlyBudget } from '../cost/budget.js';
import { calculateCost } from '../cost/pricing.js';
import { classifyComplexity, selectModel } from '../providers/router.js';
import { buildContext } from '../context/manager.js';
import { needsSummarization, summarizeConversation } from '../context/summarizer.js';
import { createToolExecutor } from '../tools/executor.js';
import type { ToolExecutor } from '../tools/executor.js';
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

/** Default kill condition limits. */
const DEFAULT_MAX_ROUND_TRIPS = 20;
const DEFAULT_MAX_TOKENS_PER_TASK = 50_000;
const DEFAULT_MAX_DURATION_MS = 300_000; // 5 minutes
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;
const DEFAULT_TASK_BUDGET_USD = 0.50;

/** Dependencies injected into the agent loop. */
export interface AgentLoopDeps {
  db: BetterSqlite3.Database;
  provider: LLMProvider;
  securityLevel: SecurityLevel;
  userName: string;
  monthlyBudgetUsd: number;
}

/** Configurable kill condition overrides. */
export interface AgentLoopConfig {
  maxRoundTrips?: number;
  maxTokensPerTask?: number;
  maxDurationMs?: number;
  maxConsecutiveErrors?: number;
  taskBudgetUsd?: number;
  enabledProviders?: string[];
}

/** Result returned from processing a single message. */
export interface AgentLoopResult {
  responseText: string;
  tokensUsed: { input: number; output: number };
  costUsd: number;
  toolCallCount: number;
  roundTrips: number;
}

/** The agent loop interface with a single processMessage method. */
export interface AgentLoop {
  /** Process a user message and return the agent's response. */
  processMessage(
    conversationId: string,
    userMessage: string,
    channelType: ChannelType,
  ): Promise<AgentLoopResult>;
}

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
            totalInputTokens,
            totalOutputTokens,
            totalCostUsd,
            toolCallCount,
            roundTrips,
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
        const existingConversation = getConversation(deps.db, conversationId);
        if (!existingConversation) {
          createConversation(deps.db, {
            channelType,
            channelId: conversationId,
            taskId,
          });
        }

        // Step 4: Monthly budget check
        const monthlySpent = getMonthlyTotalCost(deps.db);
        if (!isWithinMonthlyBudget(monthlySpent, deps.monthlyBudgetUsd, 0)) {
          updateTaskStatus(deps.db, taskId, 'failed', 'Monthly budget exceeded');
          return buildResult(
            'Monthly budget has been exceeded. Please adjust your budget or wait until next month.',
            totalInputTokens,
            totalOutputTokens,
            totalCostUsd,
            toolCallCount,
            roundTrips,
          );
        }

        // Step 5: Model routing — classify complexity and select model
        const tier = classifyComplexity(userMessage, false);
        let modelSelection: ModelSelection;
        try {
          modelSelection = selectModel(tier, enabledProviders);
        } catch {
          updateTaskStatus(deps.db, taskId, 'failed', 'No model available');
          return buildResult(
            'No suitable model is available for this request. Please check your provider configuration.',
            totalInputTokens,
            totalOutputTokens,
            totalCostUsd,
            toolCallCount,
            roundTrips,
          );
        }

        // Step 6: Build context
        const contextPayload = await buildContext(
          deps.db,
          conversationId,
          userMessage,
          {
            userName: deps.userName,
            securityLevel: deps.securityLevel,
          },
        );

        // Step 7: Log user message to conversation
        appendConversationLog(deps.db, {
          conversationId,
          role: 'user',
          content: userMessage,
          tokenCount: contextPayload.totalTokens,
        });

        // Step 8: Pre-call cost gate
        const estimatedCost = calculateCost(
          modelSelection.model,
          contextPayload.totalTokens,
          1000, // estimated output
        );

        if (!canAfford(totalCostUsd, taskBudgetUsd, estimatedCost)) {
          updateTaskStatus(deps.db, taskId, 'failed', 'Task budget exceeded before first call');
          return buildResult(
            'This request would exceed the task budget. Please try a simpler request.',
            totalInputTokens,
            totalOutputTokens,
            totalCostUsd,
            toolCallCount,
            roundTrips,
          );
        }

        // Step 9: Create tool executor
        const toolExecutor = createToolExecutor(
          deps.db,
          deps.securityLevel,
          taskId,
        );

        // Step 10: LLM call with tool-use loop
        const messages: Message[] = [...contextPayload.messages];
        let consecutiveErrors = 0;

        while (roundTrips < maxRoundTrips) {
          // Kill condition: duration
          if (Date.now() - startTime > maxDurationMs) {
            orchestratorLogger.warn({ taskId, roundTrips }, 'Max duration exceeded');
            updateTaskStatus(deps.db, taskId, 'killed', 'Max duration exceeded');
            return buildResult(
              'I ran out of time processing your request. Here is what I have so far.',
              totalInputTokens,
              totalOutputTokens,
              totalCostUsd,
              toolCallCount,
              roundTrips,
            );
          }

          // Kill condition: total tokens
          if (totalInputTokens + totalOutputTokens > maxTokensPerTask) {
            orchestratorLogger.warn({ taskId, roundTrips }, 'Max tokens per task exceeded');
            updateTaskStatus(deps.db, taskId, 'killed', 'Max tokens exceeded');
            return buildResult(
              'Token limit for this task has been reached.',
              totalInputTokens,
              totalOutputTokens,
              totalCostUsd,
              toolCallCount,
              roundTrips,
            );
          }

          // Cost gate before each LLM call
          const preCallEstimate = calculateCost(modelSelection.model, 1000, 1000);
          if (!canAfford(totalCostUsd, taskBudgetUsd, preCallEstimate)) {
            orchestratorLogger.warn({ taskId, totalCostUsd }, 'Task budget exceeded');
            updateTaskStatus(deps.db, taskId, 'failed', 'Task budget exceeded');
            return buildResult(
              'Task budget has been exceeded.',
              totalInputTokens,
              totalOutputTokens,
              totalCostUsd,
              toolCallCount,
              roundTrips,
            );
          }

          // Make the LLM call
          let response: ChatResponse;
          try {
            response = await deps.provider.chat(messages, {
              model: modelSelection.model,
              maxTokens: 4096,
              tools: CORE_TOOLS,
              systemPrompt: contextPayload.systemPrompt,
            });
            consecutiveErrors = 0;
          } catch (error: unknown) {
            consecutiveErrors++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            orchestratorLogger.error(
              { taskId, roundTrips, error: errorMessage },
              'LLM call failed',
            );

            if (consecutiveErrors >= maxConsecutiveErrors) {
              updateTaskStatus(deps.db, taskId, 'failed', 'Max consecutive errors');
              return buildResult(
                'I encountered repeated errors trying to process your request. Please try again later.',
                totalInputTokens,
                totalOutputTokens,
                totalCostUsd,
                toolCallCount,
                roundTrips,
              );
            }
            continue;
          }

          roundTrips++;

          // Track usage
          const callCost = calculateCost(
            modelSelection.model,
            response.usage.inputTokens,
            response.usage.outputTokens,
            response.usage.cacheReadTokens ?? 0,
          );
          totalInputTokens += response.usage.inputTokens;
          totalOutputTokens += response.usage.outputTokens;
          totalCostUsd += callCost;

          // Record token usage in DB
          recordTokenUsage(deps.db, {
            taskId,
            provider: deps.provider.name,
            model: modelSelection.model,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            cachedTokens: response.usage.cacheReadTokens ?? 0,
            costUsd: callCost,
            roundTripNumber: roundTrips,
          });

          // Check stop reason
          if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
            const responseText = extractResponseText(response);

            // Log assistant response
            appendConversationLog(deps.db, {
              conversationId,
              role: 'assistant',
              content: responseText,
              tokenCount: response.usage.outputTokens,
            });

            // Update conversation stats
            incrementMessageCount(
              deps.db,
              conversationId,
              response.usage.inputTokens + response.usage.outputTokens,
            );

            // Update task
            updateTaskSpend(deps.db, taskId, totalCostUsd);
            updateTaskStatus(deps.db, taskId, 'completed');

            // Trigger summarization if needed (fire and forget)
            triggerSummarizationIfNeeded(
              deps.db,
              conversationId,
              deps.provider,
              totalCostUsd,
              taskBudgetUsd,
            );

            return buildResult(
              responseText,
              totalInputTokens,
              totalOutputTokens,
              totalCostUsd,
              toolCallCount,
              roundTrips,
            );
          }

          // Tool use — process tool calls
          if (response.stopReason === 'tool_use') {
            const toolUseBlocks = response.content.filter(
              (block) => block.type === 'tool_use',
            );

            // Append the assistant message with tool_use blocks
            messages.push({
              role: 'assistant',
              content: response.content,
            });

            // Execute each tool and collect results
            const toolResultBlocks = await executeTools(
              toolExecutor,
              toolUseBlocks,
            );

            toolCallCount += toolUseBlocks.length;

            // Append tool results as a user message
            messages.push({
              role: 'user',
              content: toolResultBlocks,
            });

            // Continue the loop for the next LLM call
            continue;
          }

          // Unexpected stop reason — bail out
          const responseText = extractResponseText(response);
          updateTaskSpend(deps.db, taskId, totalCostUsd);
          updateTaskStatus(deps.db, taskId, 'completed');

          return buildResult(
            responseText || 'I completed your request.',
            totalInputTokens,
            totalOutputTokens,
            totalCostUsd,
            toolCallCount,
            roundTrips,
          );
        }

        // Max round trips reached
        orchestratorLogger.warn({ conversationId, roundTrips }, 'Max round trips reached');
        updateTaskStatus(deps.db, task.id, 'killed', 'Max round trips exceeded');
        return buildResult(
          'I reached the maximum number of processing steps for this request.',
          totalInputTokens,
          totalOutputTokens,
          totalCostUsd,
          toolCallCount,
          roundTrips,
        );
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        orchestratorLogger.error(
          { conversationId, error: errorMessage },
          'Unhandled error in agent loop',
        );
        return buildResult(
          'An unexpected error occurred while processing your request. Please try again.',
          totalInputTokens,
          totalOutputTokens,
          totalCostUsd,
          toolCallCount,
          roundTrips,
        );
      }
    },
  };
}

/**
 * Extract concatenated text from an LLM ChatResponse.
 * @param response - The ChatResponse from the provider.
 * @returns The combined text content from all text blocks.
 */
function extractResponseText(response: ChatResponse): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

/**
 * Execute a batch of tool_use blocks via the tool executor.
 * @param toolExecutor - The configured tool executor.
 * @param toolUseBlocks - Array of tool_use ContentBlocks from the LLM.
 * @returns Array of tool_result ContentBlocks.
 */
async function executeTools(
  toolExecutor: ToolExecutor,
  toolUseBlocks: ContentBlock[],
): Promise<ContentBlock[]> {
  const results: ContentBlock[] = [];
  for (const toolBlock of toolUseBlocks) {
    try {
      const result = await toolExecutor.execute(toolBlock);
      results.push(result);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        type: 'tool_result',
        toolUseId: toolBlock.id ?? '',
        content: `Tool execution failed: ${errorMessage}`,
        isError: true,
      });
    }
  }
  return results;
}

/**
 * Build a standardized AgentLoopResult.
 * @param responseText - The response text to return to the user.
 * @param inputTokens - Total input tokens used.
 * @param outputTokens - Total output tokens used.
 * @param costUsd - Total cost in USD.
 * @param toolCallCount - Number of tool calls executed.
 * @param roundTrips - Number of LLM round trips completed.
 * @returns An AgentLoopResult object.
 */
function buildResult(
  responseText: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  toolCallCount: number,
  roundTrips: number,
): AgentLoopResult {
  return {
    responseText,
    tokensUsed: { input: inputTokens, output: outputTokens },
    costUsd,
    toolCallCount,
    roundTrips,
  };
}

/**
 * Check if summarization is needed and trigger it asynchronously.
 * Errors are logged but do not propagate.
 * @param db - The database connection.
 * @param conversationId - The conversation to check.
 * @param provider - The LLM provider for summarization.
 * @param taskSpentUsd - Current task spending.
 * @param taskBudgetUsd - Maximum task budget.
 */
function triggerSummarizationIfNeeded(
  db: BetterSqlite3.Database,
  conversationId: string,
  provider: LLMProvider,
  taskSpentUsd: number,
  taskBudgetUsd: number,
): void {
  try {
    if (needsSummarization(db, conversationId)) {
      // Fire and forget — do not await
      summarizeConversation(db, conversationId, provider, {
        taskSpentUsd,
        taskBudgetUsd,
      }).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        orchestratorLogger.warn(
          { conversationId, error: errorMessage },
          'Background summarization failed',
        );
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    orchestratorLogger.warn(
      { conversationId, error: errorMessage },
      'Failed to check summarization need',
    );
  }
}
