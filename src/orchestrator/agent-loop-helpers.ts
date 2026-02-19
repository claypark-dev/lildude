/**
 * Helper types and utility functions for the agent loop.
 * Extracted to keep the main agent-loop.ts under 300 lines.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type {
  LLMProvider,
  ChatResponse,
  ContentBlock,
  ChannelType,
} from '../types/index.js';
import type { SecurityLevel } from '../security/permissions.js';
import type { ToolExecutor } from '../tools/executor.js';
import { needsSummarization, summarizeConversation, extractKeyFacts } from '../context/summarizer.js';
import { getConversationLogs } from '../persistence/conversation-logs.js';
import { upsertKnowledge } from '../persistence/knowledge.js';
import { orchestratorLogger } from '../utils/logger.js';

/** Default kill condition limits. */
export const DEFAULT_MAX_ROUND_TRIPS = 20;
export const DEFAULT_MAX_TOKENS_PER_TASK = 50_000;
export const DEFAULT_MAX_DURATION_MS = 300_000; // 5 minutes
export const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;
export const DEFAULT_TASK_BUDGET_USD = 0.50;

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
 * Extract concatenated text from an LLM ChatResponse.
 * @param response - The ChatResponse from the provider.
 * @returns The combined text content from all text blocks.
 */
export function extractResponseText(response: ChatResponse): string {
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
export async function executeTools(
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
export function buildResult(
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
export function triggerSummarizationIfNeeded(
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

/**
 * Extract key facts from recent conversation logs on task completion
 * and persist them to the knowledge table. This is a deterministic,
 * lightweight extraction that scans the final assistant response for
 * fact-like patterns without making an LLM call.
 *
 * Errors are logged but never propagate to the caller.
 *
 * @param db - The database connection.
 * @param conversationId - The conversation to extract facts from.
 */
export function extractKeyFactsOnTaskCompletion(
  db: BetterSqlite3.Database,
  conversationId: string,
): void {
  try {
    const logs = getConversationLogs(db, conversationId);
    if (logs.length === 0) {
      return;
    }

    // Build a text block from the most recent messages (last 10) to scan for facts
    const recentLogs = logs.slice(-10);
    const textBlock = recentLogs
      .map((log) => `[${log.role.toUpperCase()}]: ${log.content}`)
      .join('\n');

    const facts = extractKeyFacts(textBlock);

    for (const fact of facts) {
      upsertKnowledge(db, {
        category: 'task_completion_fact',
        key: fact.key,
        value: fact.value,
        sourceConversationId: conversationId,
        confidence: fact.confidence,
      });
    }

    if (facts.length > 0) {
      orchestratorLogger.debug(
        { conversationId, factCount: facts.length },
        'Key facts extracted on task completion',
      );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    orchestratorLogger.warn(
      { conversationId, error: errorMessage },
      'Failed to extract key facts on task completion',
    );
  }
}
