/**
 * Knowledge tools — S1.H.2
 *
 * Provides store and recall operations for the knowledge base.
 * All operations are logged to the security audit log.
 *
 * RULE: NEVER access SQLite directly — always go through src/persistence/.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ToolResult } from '../types/index.js';
import { upsertKnowledge, searchKnowledge } from '../persistence/knowledge.js';
import { appendSecurityLog } from '../persistence/security-log.js';

/** Action type constants for security log entries. */
const ACTION_TYPE_STORE = 'knowledge_store';
const ACTION_TYPE_RECALL = 'knowledge_recall';

/** Options for the knowledge store operation. */
export interface KnowledgeStoreOptions {
  sourceConversationId?: string;
  sourceTaskId?: string;
  confidence?: number;
  securityLevel?: number;
}

/** Options for the knowledge recall operation. */
export interface KnowledgeRecallOptions {
  securityLevel?: number;
  taskId?: string;
}

/**
 * Store a knowledge entry in the knowledge base.
 *
 * Persists the given category/key/value via the knowledge DAL
 * and logs the action to the security audit log.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param category - The knowledge category (e.g. 'personal', 'work').
 * @param key - The knowledge key within the category.
 * @param value - The knowledge value to store.
 * @param opts - Optional parameters for source tracking and confidence.
 * @returns A ToolResult indicating success or failure (never throws).
 */
export async function knowledgeStore(
  db: BetterSqlite3.Database,
  category: string,
  key: string,
  value: string,
  opts?: KnowledgeStoreOptions,
): Promise<ToolResult> {
  try {
    const entry = upsertKnowledge(db, {
      category,
      key,
      value,
      sourceConversationId: opts?.sourceConversationId,
      sourceTaskId: opts?.sourceTaskId,
      confidence: opts?.confidence,
    });

    appendSecurityLog(db, {
      actionType: ACTION_TYPE_STORE,
      actionDetail: `${category}/${key}`,
      allowed: true,
      securityLevel: opts?.securityLevel ?? 3,
      reason: 'Knowledge entry stored successfully',
      taskId: opts?.sourceTaskId,
    });

    return {
      success: true,
      output: `Stored knowledge: [${category}] ${key} = ${value}`,
      metadata: {
        knowledgeId: entry.id,
        category: entry.category,
        key: entry.key,
        confidence: entry.confidence,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: '',
      error: `Knowledge store error: ${message}`,
    };
  }
}

/**
 * Search the knowledge base and return matching entries.
 *
 * Uses the searchKnowledge DAL to find entries matching the query term,
 * optionally filtered by category. Results are formatted as a readable string.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param query - The search term to match against knowledge keys and values.
 * @param category - Optional category to restrict the search to.
 * @param opts - Optional parameters for security level and task tracking.
 * @returns A ToolResult containing formatted search results (never throws).
 */
export async function knowledgeRecall(
  db: BetterSqlite3.Database,
  query: string,
  category?: string,
  opts?: KnowledgeRecallOptions,
): Promise<ToolResult> {
  try {
    const results = searchKnowledge(db, query, category);

    appendSecurityLog(db, {
      actionType: ACTION_TYPE_RECALL,
      actionDetail: category ? `${category}:${query}` : query,
      allowed: true,
      securityLevel: opts?.securityLevel ?? 3,
      reason: `Knowledge search returned ${results.length} result(s)`,
      taskId: opts?.taskId,
    });

    if (results.length === 0) {
      return {
        success: true,
        output: 'No knowledge entries found matching the query.',
        metadata: { resultCount: 0 },
      };
    }

    const formatted = results.map((row) =>
      `[${row.category}] ${row.key} = ${row.value} (confidence: ${row.confidence})`,
    ).join('\n');

    return {
      success: true,
      output: formatted,
      metadata: {
        resultCount: results.length,
        categories: [...new Set(results.map((row) => row.category))],
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: '',
      error: `Knowledge recall error: ${message}`,
    };
  }
}
