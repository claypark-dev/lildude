/**
 * Conversation logs data access layer.
 * Provides operations for appending, querying, and pruning
 * individual message entries within a conversation.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Valid roles for conversation log entries. */
export type LogRole = 'user' | 'assistant' | 'system' | 'tool_call' | 'tool_result';

/** Row shape returned from the conversation_logs table. */
export interface ConversationLogRow {
  id: number;
  conversationId: string;
  role: LogRole;
  content: string;
  tokenCount: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/** Input for appending a new conversation log entry. */
export interface AppendLogInput {
  conversationId: string;
  role: LogRole;
  content: string;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

/** Raw row from SQLite for the conversation_logs table. */
interface ConversationLogDbRow {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  token_count: number | null;
  metadata: string | null;
  created_at: string;
}

/**
 * Parse a JSON string into a metadata record.
 * Returns null if the input is null or invalid JSON.
 * @param json - The JSON string to parse.
 * @returns A record of metadata, or null.
 */
function parseMetadata(json: string | null): Record<string, unknown> | null {
  if (json === null || json === '') {
    return null;
  }
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Map a raw database row to the application-level ConversationLogRow interface.
 * @param row - Raw SQLite row from the conversation_logs table.
 * @returns A typed ConversationLogRow object.
 */
function mapRow(row: ConversationLogDbRow): ConversationLogRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as LogRole,
    content: row.content,
    tokenCount: row.token_count,
    metadata: parseMetadata(row.metadata),
    createdAt: new Date(row.created_at),
  };
}

/**
 * Append a new log entry to a conversation.
 * @param db - The database connection.
 * @param input - The log entry data.
 * @returns The newly created log row.
 * @throws {PersistenceError} If the insert fails.
 */
export function appendConversationLog(
  db: BetterSqlite3.Database,
  input: AppendLogInput,
): ConversationLogRow {
  try {
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

    const result = db.prepare(
      `INSERT INTO conversation_logs (conversation_id, role, content, token_count, metadata)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      input.conversationId,
      input.role,
      input.content,
      input.tokenCount ?? null,
      metadataJson,
    );

    const insertedId = result.lastInsertRowid as number;
    persistenceLogger.debug(
      { logId: insertedId, conversationId: input.conversationId },
      'Conversation log appended',
    );

    const row = db.prepare(
      'SELECT * FROM conversation_logs WHERE id = ?',
    ).get(insertedId) as ConversationLogDbRow;

    return mapRow(row);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to append conversation log: ${message}`);
  }
}

/**
 * Retrieve log entries for a conversation, ordered by creation time ascending.
 * @param db - The database connection.
 * @param conversationId - The conversation to retrieve logs for.
 * @param limit - Maximum number of logs to return (default 100).
 * @param offset - Number of logs to skip for pagination (default 0).
 * @returns An array of conversation log rows.
 * @throws {PersistenceError} If the query fails.
 */
export function getConversationLogs(
  db: BetterSqlite3.Database,
  conversationId: string,
  limit: number = 100,
  offset: number = 0,
): ConversationLogRow[] {
  try {
    const rows = db.prepare(
      `SELECT * FROM conversation_logs
       WHERE conversation_id = ?
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
    ).all(conversationId, limit, offset) as ConversationLogDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get conversation logs: ${message}`);
  }
}

/**
 * Get the total token count across all log entries for a conversation.
 * Entries with null token_count are excluded from the sum.
 * @param db - The database connection.
 * @param conversationId - The conversation to sum tokens for.
 * @returns The total number of tokens used in the conversation.
 * @throws {PersistenceError} If the query fails.
 */
export function getConversationTokenCount(
  db: BetterSqlite3.Database,
  conversationId: string,
): number {
  try {
    const row = db.prepare(
      `SELECT COALESCE(SUM(token_count), 0) AS total
       FROM conversation_logs
       WHERE conversation_id = ?`,
    ).get(conversationId) as { total: number };

    return row.total;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get conversation token count: ${message}`);
  }
}

/**
 * Delete old log entries for a conversation, keeping only the most recent N.
 * @param db - The database connection.
 * @param conversationId - The conversation to prune logs for.
 * @param keepCount - The number of most-recent logs to keep.
 * @returns The number of log entries deleted.
 * @throws {PersistenceError} If the delete fails.
 */
export function deleteOldLogs(
  db: BetterSqlite3.Database,
  conversationId: string,
  keepCount: number,
): number {
  try {
    const result = db.prepare(
      `DELETE FROM conversation_logs
       WHERE conversation_id = ?
         AND id NOT IN (
           SELECT id FROM conversation_logs
           WHERE conversation_id = ?
           ORDER BY id DESC
           LIMIT ?
         )`,
    ).run(conversationId, conversationId, keepCount);

    const deletedCount = result.changes;
    if (deletedCount > 0) {
      persistenceLogger.debug(
        { conversationId, deletedCount, keepCount },
        'Old conversation logs deleted',
      );
    }
    return deletedCount;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete old logs: ${message}`);
  }
}
