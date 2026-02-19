/**
 * Conversation summarizer module.
 * Detects when conversations exceed a token threshold and generates
 * lossy summaries using a small model. Extracts key facts and stores
 * them for future context assembly.
 * See HLD Section S1.I.2.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { LLMProvider, KeyFact, ChatResponse } from '../types/index.js';
import { getConversationLogs, getConversationTokenCount } from '../persistence/conversation-logs.js';
import type { ConversationLogRow } from '../persistence/conversation-logs.js';
import { updateConversationSummary } from '../persistence/conversations.js';
import { upsertKnowledge } from '../persistence/knowledge.js';
import { calculateCost } from '../cost/pricing.js';
import { canAfford } from '../cost/budget.js';
import { createModuleLogger } from '../utils/logger.js';

const summarizerLogger = createModuleLogger('summarizer');

/** Default token threshold above which summarization is triggered. */
const DEFAULT_SUMMARIZATION_THRESHOLD = 4000;

/** The small model used for summarization to keep costs low. */
const SUMMARIZATION_MODEL = 'claude-haiku-4-5-20251001';

/** Maximum tokens to allocate for the summarization response. */
const SUMMARIZATION_MAX_TOKENS = 1500;

/** Estimated input tokens for a summarization call (conversation text). */
const ESTIMATED_INPUT_TOKENS = 4000;

/** Estimated output tokens for a summarization call (summary + key facts). */
const ESTIMATED_OUTPUT_TOKENS = 1000;

/** Options for the summarizeConversation function. */
export interface SummarizeOptions {
  /** Token threshold above which summarization is triggered. Defaults to 4000. */
  threshold?: number;
  /** Current task spending in USD. Defaults to 0. */
  taskSpentUsd?: number;
  /** Maximum task budget in USD. Defaults to 0.10. */
  taskBudgetUsd?: number;
  /** Model to use for summarization. Defaults to claude-haiku. */
  model?: string;
}

/** Result returned from a successful summarization. */
export interface SummarizationResult {
  /** Whether summarization was performed. */
  summarized: boolean;
  /** The generated summary text, or undefined if not summarized. */
  summary?: string;
  /** Extracted key facts, or empty array if not summarized. */
  keyFacts: KeyFact[];
  /** Reason if summarization was skipped. */
  skipReason?: string;
}

/**
 * The system prompt sent to the LLM to guide summarization output.
 * Instructs the model to produce structured output with a summary
 * paragraph followed by key facts in a parseable format.
 */
const SUMMARIZATION_SYSTEM_PROMPT = `You are a conversation summarizer. Given conversation logs, produce:

1. A concise summary paragraph (under 200 words) capturing the main topics, decisions, and outcomes.

2. A list of key facts extracted from the conversation. Each fact should be on its own line in this exact format:
FACT: [key] = [value] (confidence: [0.0-1.0])

Key facts include: user preferences, names, dates, decisions, action items, locations, important numbers, and any other specific information worth remembering.

Format your response exactly like this:

SUMMARY:
[Your summary paragraph here]

KEY_FACTS:
FACT: [key] = [value] (confidence: [score])
FACT: [key] = [value] (confidence: [score])
...`;

/**
 * Check whether a conversation has exceeded the token threshold
 * and needs summarization.
 * @param db - The database connection.
 * @param conversationId - The conversation to check.
 * @param threshold - Token threshold above which summarization is needed. Defaults to 4000.
 * @returns True if the conversation's total tokens exceed the threshold.
 */
export function needsSummarization(
  db: BetterSqlite3.Database,
  conversationId: string,
  threshold: number = DEFAULT_SUMMARIZATION_THRESHOLD,
): boolean {
  const totalTokens = getConversationTokenCount(db, conversationId);
  return totalTokens > threshold;
}

/**
 * Summarize a conversation by calling a small LLM model to generate
 * a lossy summary and extract key facts. Stores the summary in the
 * conversations table and key facts in the knowledge table.
 *
 * The function checks the token threshold before proceeding and
 * verifies budget availability. If the budget is exceeded,
 * summarization is skipped silently with a warning log.
 *
 * Full raw logs in conversation_logs are never modified.
 *
 * @param db - The database connection.
 * @param conversationId - The conversation to summarize.
 * @param provider - The LLM provider to use for generating the summary.
 * @param options - Optional configuration for threshold, budget, and model.
 * @returns A SummarizationResult indicating whether summarization occurred and its outputs.
 */
export async function summarizeConversation(
  db: BetterSqlite3.Database,
  conversationId: string,
  provider: LLMProvider,
  options?: SummarizeOptions,
): Promise<SummarizationResult> {
  try {
    const threshold = options?.threshold ?? DEFAULT_SUMMARIZATION_THRESHOLD;
    const taskSpentUsd = options?.taskSpentUsd ?? 0;
    const taskBudgetUsd = options?.taskBudgetUsd ?? 0.10;
    const model = options?.model ?? SUMMARIZATION_MODEL;

    // Step 1: Check if summarization is needed
    if (!needsSummarization(db, conversationId, threshold)) {
      summarizerLogger.debug(
        { conversationId },
        'Conversation below threshold, skipping summarization',
      );
      return {
        summarized: false,
        keyFacts: [],
        skipReason: 'below_threshold',
      };
    }

    // Step 2: Check budget before making the LLM call
    const estimatedCostUsd = calculateCost(
      model,
      ESTIMATED_INPUT_TOKENS,
      ESTIMATED_OUTPUT_TOKENS,
    );

    if (!canAfford(taskSpentUsd, taskBudgetUsd, estimatedCostUsd)) {
      summarizerLogger.warn(
        { conversationId, taskSpentUsd, taskBudgetUsd, estimatedCostUsd },
        'Budget exceeded, skipping summarization',
      );
      return {
        summarized: false,
        keyFacts: [],
        skipReason: 'budget_exceeded',
      };
    }

    // Step 3: Get conversation logs
    const logs = getConversationLogs(db, conversationId);

    if (logs.length === 0) {
      summarizerLogger.debug(
        { conversationId },
        'No conversation logs found, skipping summarization',
      );
      return {
        summarized: false,
        keyFacts: [],
        skipReason: 'no_logs',
      };
    }

    // Step 4: Build the summarization prompt from conversation logs
    const conversationText = formatLogsForSummarization(logs);

    // Step 5: Call the LLM provider
    const response: ChatResponse = await provider.chat(
      [
        {
          role: 'user',
          content: `Please summarize the following conversation and extract key facts:\n\n${conversationText}`,
        },
      ],
      {
        model,
        maxTokens: SUMMARIZATION_MAX_TOKENS,
        temperature: 0.3,
        systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      },
    );

    // Step 6: Extract text from response
    const responseText = extractResponseText(response);

    if (responseText.length === 0) {
      summarizerLogger.warn(
        { conversationId },
        'Empty response from summarization LLM call',
      );
      return {
        summarized: false,
        keyFacts: [],
        skipReason: 'empty_response',
      };
    }

    // Step 7: Parse the summary and key facts from the response
    const summary = extractSummaryText(responseText);
    const keyFacts = extractKeyFacts(responseText);

    // Step 8: Store the summary in the conversations table
    if (summary.length > 0) {
      updateConversationSummary(db, conversationId, summary);
    }

    // Step 9: Store key facts in the knowledge table
    for (const fact of keyFacts) {
      upsertKnowledge(db, {
        category: 'conversation_fact',
        key: fact.key,
        value: fact.value,
        sourceConversationId: conversationId,
        confidence: fact.confidence,
      });
    }

    summarizerLogger.info(
      {
        conversationId,
        summaryLength: summary.length,
        keyFactCount: keyFacts.length,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      },
      'Conversation summarized successfully',
    );

    return {
      summarized: true,
      summary,
      keyFacts,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    summarizerLogger.error(
      { conversationId, error: errorMessage },
      'Failed to summarize conversation',
    );
    throw error;
  }
}

/**
 * Format conversation log rows into a readable text block
 * suitable for the summarization prompt.
 * @param logs - Array of conversation log rows to format.
 * @returns A formatted string of the conversation.
 */
function formatLogsForSummarization(logs: ConversationLogRow[]): string {
  const lines: string[] = [];

  for (const log of logs) {
    const roleLabel = log.role.toUpperCase();
    lines.push(`[${roleLabel}]: ${log.content}`);
  }

  return lines.join('\n');
}

/**
 * Extract the concatenated text content from a ChatResponse.
 * @param response - The LLM chat response.
 * @returns The combined text from all text content blocks.
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
 * Extract the summary text from the structured LLM response.
 * Looks for the SUMMARY: section and extracts text up to KEY_FACTS:.
 * @param text - The full LLM response text.
 * @returns The extracted summary text, or the full text if no markers found.
 */
function extractSummaryText(text: string): string {
  const summaryMatch = text.match(/SUMMARY:\s*\n([\s\S]*?)(?=\nKEY_FACTS:|$)/i);
  if (summaryMatch) {
    return summaryMatch[1].trim();
  }

  // Fallback: if no SUMMARY marker, treat the whole text as the summary
  return text.trim();
}

/**
 * Parse key facts from the structured LLM response.
 * Looks for lines matching the FACT: [key] = [value] (confidence: [score]) format.
 * This is a pure function with no side effects.
 * @param text - The full LLM response text containing key facts.
 * @returns An array of parsed KeyFact objects.
 */
export function extractKeyFacts(text: string): KeyFact[] {
  const facts: KeyFact[] = [];
  const factPattern = /FACT:\s*(.+?)\s*=\s*(.+?)(?:\s*\(confidence:\s*(-?[\d.]+)\))?$/gm;

  let match = factPattern.exec(text);
  while (match !== null) {
    const key = match[1].trim();
    const value = match[2].trim();
    const confidenceStr = match[3];
    const confidence = confidenceStr ? parseFloat(confidenceStr) : 0.8;

    // Validate confidence is within bounds
    const clampedConfidence = Math.max(0, Math.min(1, isNaN(confidence) ? 0.8 : confidence));

    facts.push({
      key,
      value,
      category: 'conversation_fact',
      source: 'summarizer',
      confidence: clampedConfidence,
    });

    match = factPattern.exec(text);
  }

  return facts;
}
