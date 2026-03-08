/**
 * Context manager for building LLM context payloads.
 * Assembles system prompt, knowledge entries, conversation history,
 * and the current user message into a token-budgeted ContextPayload.
 * See HLD Section S1.I.1.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ContextPayload, Message } from '../types/index.js';
import { countTokens, estimateMessageTokens } from '../cost/tokens.js';
import { searchKnowledge } from '../persistence/knowledge.js';
import type { KnowledgeRow } from '../persistence/knowledge.js';
import { getConversation } from '../persistence/conversations.js';
import { getConversationLogs } from '../persistence/conversation-logs.js';
import type { ConversationLogRow } from '../persistence/conversation-logs.js';
import { buildSystemPrompt } from '../orchestrator/system-prompt.js';
import { formatKnowledgeForContext } from './knowledge.js';
import { hybridSearch, recordKnowledgeAccess } from '../memory/hybrid-search.js';
import type { EmbeddingResult } from '../memory/embeddings.js';
import { loadUserProfile } from '../memory/preference-extractor.js';
import { searchEntities, getKnowledgeByEntity } from '../memory/entity-linker.js';
import type { ProfileEntry } from '../orchestrator/system-prompt.js';
import { orchestratorLogger } from '../utils/logger.js';

/** Default total token budget for context payloads. */
const DEFAULT_TOKEN_BUDGET = 8000;

/** Maximum tokens allocated for knowledge entries in context. */
const BUDGET_KNOWLEDGE = 500;

/** Maximum tokens allocated for the conversation summary. */
const BUDGET_SUMMARY = 1000;

/** Tokens reserved for the model's response output. */
const BUDGET_RESPONSE_RESERVE = 1200;

/** Options for building context. */
export interface BuildContextOptions {
  /** Target total token budget for the context payload. Defaults to 8000. */
  targetTokenBudget?: number;
  /** The user's display name. Defaults to 'User'. */
  userName?: string;
  /** Security level (1-5). Defaults to 3 (Balanced). */
  securityLevel?: number;
  /** List of active wave names. Defaults to empty array. */
  activeWaves?: string[];
  /** Pre-computed embedding of the user query for hybrid search. */
  queryEmbedding?: EmbeddingResult;
  /** Whether to use hybrid search (vector + BM25). Defaults to false. */
  useHybridSearch?: boolean;
}

/**
 * Extract individual search terms from a user message for knowledge lookup.
 * Splits on whitespace, removes punctuation, and filters out very short words.
 * Returns individual terms for per-word searching against the knowledge base.
 * @param userMessage - The raw user message text.
 * @returns An array of search term strings for knowledge queries.
 */
function extractSearchTerms(userMessage: string): string[] {
  const words = userMessage
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 5);

  return words;
}

/**
 * Convert a conversation log row to a Message for the context payload.
 * Only includes user, assistant, and system roles.
 * @param logRow - The conversation log row from the database.
 * @returns A Message object, or undefined if the role is not includable.
 */
function logRowToMessage(logRow: ConversationLogRow): Message | undefined {
  const includableRoles = new Set(['user', 'assistant', 'system']);
  if (!includableRoles.has(logRow.role)) {
    return undefined;
  }
  return {
    role: logRow.role as 'user' | 'assistant' | 'system',
    content: logRow.content,
  };
}

/**
 * Trim messages from the front (oldest) to fit within a token budget.
 * Always preserves at least the most recent message.
 * @param messages - Array of messages ordered oldest-first.
 * @param maxTokens - Maximum token budget for the messages.
 * @returns A trimmed array of messages that fits within the budget.
 */
function trimMessagesToFit(messages: Message[], maxTokens: number): Message[] {
  if (messages.length === 0) {
    return [];
  }

  // Start from the end (most recent) and work backwards
  const result: Message[] = [];
  let tokenCount = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const messageTokens = estimateMessageTokens([messages[i]]);
    if (tokenCount + messageTokens > maxTokens && result.length > 0) {
      break;
    }
    result.unshift(messages[i]);
    tokenCount += messageTokens;
  }

  return result;
}

/**
 * Build a complete context payload for an LLM call.
 * Assembles the system prompt, relevant knowledge, conversation history,
 * and the current user message into a token-budgeted payload.
 *
 * Token budget allocation:
 * - System prompt: ~1000 tokens
 * - User profile/knowledge: ~500 tokens
 * - Conversation summary: ~1000 tokens
 * - Recent messages: ~2000 tokens
 * - Reserved for response: ~1200 tokens
 *
 * If the conversation does not yet exist (new conversation), summary
 * and historical logs are skipped gracefully.
 *
 * @param db - The database connection.
 * @param conversationId - The conversation ID to load history from (may not exist yet).
 * @param userMessage - The current user message text.
 * @param options - Optional configuration for budget, user info, and waves.
 * @returns A ContextPayload with system prompt, messages, token count, and included knowledge keys.
 */
export async function buildContext(
  db: BetterSqlite3.Database,
  conversationId: string,
  userMessage: string,
  options?: BuildContextOptions,
): Promise<ContextPayload> {
  try {
    const userName = options?.userName ?? 'User';
    const securityLevel = options?.securityLevel ?? 3;
    const activeWaves = options?.activeWaves ?? [];
    const targetBudget = options?.targetTokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const useHybridSearch = options?.useHybridSearch ?? false;
    const queryEmbedding = options?.queryEmbedding ?? null;

    // Step 1: Load user profile and build system prompt
    let userProfile: ProfileEntry[] | undefined;
    try {
      const profileRows = loadUserProfile(db);
      if (profileRows.length > 0) {
        userProfile = profileRows.map((row) => ({
          key: row.key,
          value: row.value,
        }));
      }
    } catch {
      // user_profile table may not exist yet on older DBs
    }

    const systemPrompt = buildSystemPrompt(userName, securityLevel, activeWaves, userProfile);
    const systemPromptTokens = countTokens(systemPrompt);

    // Step 2: Query knowledge base for relevant entries
    const knowledgeIncluded: string[] = [];
    let knowledgeContext = '';

    if (useHybridSearch) {
      // Hybrid search: vector + BM25 with temporal decay and MMR
      const hybridResults = hybridSearch(db, queryEmbedding, userMessage);

      if (hybridResults.length > 0) {
        // Convert hybrid results to KnowledgeRow-compatible format for the formatter
        const entries: KnowledgeRow[] = hybridResults.map((result) => ({
          id: result.knowledgeId,
          category: result.category,
          key: result.key,
          value: result.value,
          sourceConversationId: null,
          sourceTaskId: null,
          confidence: result.score,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));

        knowledgeContext = formatKnowledgeForContext(entries, BUDGET_KNOWLEDGE);

        // Record access for temporal decay tracking
        for (const result of hybridResults) {
          if (knowledgeContext.includes(result.key)) {
            knowledgeIncluded.push(result.key);
            recordKnowledgeAccess(db, result.knowledgeId);
          }
        }
      }
    } else {
      // Fallback: substring-based search (original behavior)
      const searchTerms = extractSearchTerms(userMessage);

      if (searchTerms.length > 0) {
        const seenIds = new Set<number>();
        const allEntries: KnowledgeRow[] = [];

        for (const term of searchTerms) {
          const entries = searchKnowledge(db, term);
          for (const entry of entries) {
            if (!seenIds.has(entry.id)) {
              seenIds.add(entry.id);
              allEntries.push(entry);
            }
          }
        }

        const sortedEntries = allEntries.sort(
          (entryA, entryB) => entryB.confidence - entryA.confidence,
        );

        knowledgeContext = formatKnowledgeForContext(sortedEntries, BUDGET_KNOWLEDGE);

        for (const entry of sortedEntries) {
          if (knowledgeContext.includes(entry.key)) {
            knowledgeIncluded.push(entry.key);
          }
        }
      }
    }

    // Step 2b: Entity-linked knowledge retrieval
    // If the user mentions a known entity (e.g. "Sarah"), fetch all
    // knowledge linked to that entity. Results are merged into the
    // existing knowledge context without exceeding the budget.
    try {
      const searchTerms = extractSearchTerms(userMessage);
      const entitySeenIds = new Set(knowledgeIncluded.map(() => 0)); // track IDs already included
      const entityEntries: KnowledgeRow[] = [];

      for (const term of searchTerms) {
        const matchedEntities = searchEntities(db, term);
        for (const entity of matchedEntities) {
          const linkedKnowledge = getKnowledgeByEntity(db, entity.canonicalName);
          for (const lk of linkedKnowledge) {
            if (!entitySeenIds.has(lk.knowledgeId)) {
              entitySeenIds.add(lk.knowledgeId);
              entityEntries.push({
                id: lk.knowledgeId,
                category: lk.category,
                key: lk.key,
                value: lk.value,
                sourceConversationId: null,
                sourceTaskId: null,
                confidence: lk.confidence,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            }
          }
        }
      }

      if (entityEntries.length > 0 && knowledgeContext.length < BUDGET_KNOWLEDGE * 4) {
        // Append entity-linked facts to existing knowledge context
        const entityContext = formatKnowledgeForContext(entityEntries, BUDGET_KNOWLEDGE);
        if (entityContext.length > 0) {
          knowledgeContext = knowledgeContext
            ? `${knowledgeContext}\n${entityContext}`
            : entityContext;
          for (const entry of entityEntries) {
            knowledgeIncluded.push(entry.key);
          }
        }
      }
    } catch {
      // Entity tables may not exist on older DBs — fail silently
    }

    // Step 3: Load conversation (may not exist for new conversations)
    const conversation = getConversation(db, conversationId);

    // Step 4: Build messages array
    const messages: Message[] = [];

    // Add conversation summary as a system message if available
    if (conversation?.summary) {
      const summaryText = `Previous conversation summary: ${conversation.summary}`;
      const summaryTokens = countTokens(summaryText);

      if (summaryTokens <= BUDGET_SUMMARY) {
        messages.push({
          role: 'system',
          content: summaryText,
        });
      }
    }

    // Add knowledge context as a system message if available
    if (knowledgeContext.length > 0) {
      messages.push({
        role: 'system',
        content: knowledgeContext,
      });
    }

    // Step 5: Load and add recent conversation logs
    if (conversation) {
      const logRows = getConversationLogs(db, conversationId);
      const historicalMessages: Message[] = [];

      for (const logRow of logRows) {
        const message = logRowToMessage(logRow);
        if (message !== undefined) {
          historicalMessages.push(message);
        }
      }

      // Calculate remaining budget for historical messages
      const usedTokens = systemPromptTokens
        + estimateMessageTokens(messages)
        + BUDGET_RESPONSE_RESERVE;
      const remainingForHistory = Math.max(
        0,
        targetBudget - usedTokens - countTokens(userMessage) - 10,
      );

      const trimmedHistory = trimMessagesToFit(historicalMessages, remainingForHistory);
      messages.push(...trimmedHistory);
    }

    // Step 6: Add current user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    // Step 7: Count total tokens
    const totalTokens = systemPromptTokens + estimateMessageTokens(messages);

    orchestratorLogger.debug(
      {
        conversationId,
        totalTokens,
        targetBudget,
        messageCount: messages.length,
        knowledgeKeys: knowledgeIncluded,
      },
      'Context payload built',
    );

    return {
      systemPrompt,
      messages,
      totalTokens,
      knowledgeIncluded,
    };
  } catch (error: unknown) {
    orchestratorLogger.error(
      { conversationId, error: error instanceof Error ? error.message : String(error) },
      'Failed to build context',
    );
    throw error;
  }
}
