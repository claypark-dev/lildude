/**
 * Conversations data access layer.
 * Provides CRUD operations for the conversations table.
 * Conversations track channel-scoped dialogue sessions including
 * message counts, token usage, summaries, and extracted key facts.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';
import type { KeyFact } from '../types/index.js';

/** Row shape returned from the conversations table. */
export interface ConversationRow {
  id: string;
  taskId: string | null;
  channelType: string;
  channelId: string;
  summary: string | null;
  keyFacts: KeyFact[];
  messageCount: number;
  totalTokens: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new conversation. */
export interface CreateConversationInput {
  /** Explicit id for the conversation. If omitted, a nanoid is generated. */
  id?: string;
  channelType: string;
  channelId: string;
  taskId?: string;
}

/** Raw row from SQLite for the conversations table. */
interface ConversationDbRow {
  id: string;
  task_id: string | null;
  channel_type: string;
  channel_id: string;
  summary: string | null;
  key_facts: string | null;
  message_count: number;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

/**
 * Parse a JSON string into a KeyFact array.
 * Returns an empty array if the input is null or invalid JSON.
 * @param json - The JSON string to parse.
 * @returns An array of KeyFact objects.
 */
function parseKeyFacts(json: string | null): KeyFact[] {
  if (json === null || json === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed as KeyFact[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Map a raw database row to the application-level ConversationRow interface.
 * @param row - Raw SQLite row from the conversations table.
 * @returns A typed ConversationRow object.
 */
function mapRow(row: ConversationDbRow): ConversationRow {
  return {
    id: row.id,
    taskId: row.task_id,
    channelType: row.channel_type,
    channelId: row.channel_id,
    summary: row.summary,
    keyFacts: parseKeyFacts(row.key_facts),
    messageCount: row.message_count,
    totalTokens: row.total_tokens,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Create a new conversation in the database.
 * @param db - The database connection.
 * @param input - The conversation creation parameters.
 * @returns The newly created conversation row.
 * @throws {PersistenceError} If the insert fails.
 */
export function createConversation(
  db: BetterSqlite3.Database,
  input: CreateConversationInput,
): ConversationRow {
  try {
    const id = input.id ?? nanoid();
    db.prepare(
      `INSERT INTO conversations (id, task_id, channel_type, channel_id)
       VALUES (?, ?, ?, ?)`,
    ).run(id, input.taskId ?? null, input.channelType, input.channelId);

    persistenceLogger.debug({ conversationId: id }, 'Conversation created');

    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationDbRow;
    return mapRow(row);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create conversation: ${message}`);
  }
}

/**
 * Retrieve a conversation by its ID.
 * @param db - The database connection.
 * @param conversationId - The conversation's unique identifier.
 * @returns The conversation row, or undefined if not found.
 * @throws {PersistenceError} If the query fails.
 */
export function getConversation(
  db: BetterSqlite3.Database,
  conversationId: string,
): ConversationRow | undefined {
  try {
    const row = db.prepare(
      'SELECT * FROM conversations WHERE id = ?',
    ).get(conversationId) as ConversationDbRow | undefined;

    return row ? mapRow(row) : undefined;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get conversation: ${message}`);
  }
}

/**
 * Update the summary text of a conversation.
 * @param db - The database connection.
 * @param conversationId - The conversation's unique identifier.
 * @param summary - The new summary text.
 * @throws {PersistenceError} If the update fails.
 */
export function updateConversationSummary(
  db: BetterSqlite3.Database,
  conversationId: string,
  summary: string,
): void {
  try {
    db.prepare(
      `UPDATE conversations SET summary = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(summary, conversationId);

    persistenceLogger.debug({ conversationId }, 'Conversation summary updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update conversation summary: ${message}`);
  }
}

/**
 * Update the key facts associated with a conversation.
 * Key facts are stored as a JSON string in the database.
 * @param db - The database connection.
 * @param conversationId - The conversation's unique identifier.
 * @param keyFacts - The array of key facts to store.
 * @throws {PersistenceError} If the update fails.
 */
export function updateConversationKeyFacts(
  db: BetterSqlite3.Database,
  conversationId: string,
  keyFacts: KeyFact[],
): void {
  try {
    const json = JSON.stringify(keyFacts);
    db.prepare(
      `UPDATE conversations SET key_facts = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(json, conversationId);

    persistenceLogger.debug({ conversationId }, 'Conversation key facts updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update conversation key facts: ${message}`);
  }
}

/**
 * Increment the message count and add to the total token count for a conversation.
 * @param db - The database connection.
 * @param conversationId - The conversation's unique identifier.
 * @param tokenCount - The number of tokens to add to the total.
 * @throws {PersistenceError} If the update fails.
 */
export function incrementMessageCount(
  db: BetterSqlite3.Database,
  conversationId: string,
  tokenCount: number,
): void {
  try {
    db.prepare(
      `UPDATE conversations
       SET message_count = message_count + 1,
           total_tokens = total_tokens + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(tokenCount, conversationId);

    persistenceLogger.debug({ conversationId, tokenCount }, 'Conversation message count incremented');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to increment message count: ${message}`);
  }
}

/**
 * Retrieve conversations for a specific channel, ordered by most recent first.
 * @param db - The database connection.
 * @param channelType - The channel type to filter by (e.g. 'discord', 'telegram').
 * @param channelId - The channel identifier to filter by.
 * @param limit - Maximum number of conversations to return (default 50).
 * @returns An array of matching conversation rows.
 * @throws {PersistenceError} If the query fails.
 */
export function getConversationsByChannel(
  db: BetterSqlite3.Database,
  channelType: string,
  channelId: string,
  limit: number = 50,
): ConversationRow[] {
  try {
    const rows = db.prepare(
      `SELECT * FROM conversations
       WHERE channel_type = ? AND channel_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(channelType, channelId, limit) as ConversationDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get conversations by channel: ${message}`);
  }
}

/**
 * Delete a conversation by its ID.
 * @param db - The database connection.
 * @param conversationId - The conversation's unique identifier.
 * @returns True if a conversation was deleted, false if it did not exist.
 * @throws {PersistenceError} If the delete fails.
 */
export function deleteConversation(
  db: BetterSqlite3.Database,
  conversationId: string,
): boolean {
  try {
    const result = db.prepare(
      'DELETE FROM conversations WHERE id = ?',
    ).run(conversationId);

    const deleted = result.changes > 0;
    if (deleted) {
      persistenceLogger.debug({ conversationId }, 'Conversation deleted');
    }
    return deleted;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete conversation: ${message}`);
  }
}
