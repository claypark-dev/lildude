/**
 * Relayed messages DAL.
 * Manages messages left by external users for the owner.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Valid message urgency levels. */
export type MessageUrgency = 'low' | 'normal' | 'high' | 'urgent';

/** Valid message statuses. */
export type MessageStatus = 'unread' | 'read' | 'archived' | 'replied';

/** Application-level relayed message. */
export interface RelayedMessage {
  id: string;
  contactId: string;
  message: string;
  urgency: MessageUrgency;
  status: MessageStatus;
  channelType: string | null;
  channelId: string | null;
  createdAt: Date;
  readAt: Date | null;
  repliedAt: Date | null;
}

/** Input for creating a relayed message. */
export interface CreateRelayedMessageInput {
  contactId: string;
  message: string;
  urgency?: MessageUrgency;
  channelType?: string;
  channelId?: string;
}

/** Raw DB row. */
interface RelayedMessageDbRow {
  id: string;
  contact_id: string;
  message: string;
  urgency: string;
  status: string;
  channel_type: string | null;
  channel_id: string | null;
  created_at: string;
  read_at: string | null;
  replied_at: string | null;
}

function mapRow(row: RelayedMessageDbRow): RelayedMessage {
  return {
    id: row.id,
    contactId: row.contact_id,
    message: row.message,
    urgency: row.urgency as MessageUrgency,
    status: row.status as MessageStatus,
    channelType: row.channel_type,
    channelId: row.channel_id,
    createdAt: new Date(row.created_at),
    readAt: row.read_at ? new Date(row.read_at) : null,
    repliedAt: row.replied_at ? new Date(row.replied_at) : null,
  };
}

/**
 * Create a new relayed message.
 * @param db - Database connection.
 * @param input - Message details.
 * @returns The created message.
 */
export function createRelayedMessage(
  db: BetterSqlite3.Database,
  input: CreateRelayedMessageInput,
): RelayedMessage {
  try {
    const id = `msg_${nanoid()}`;
    db.prepare(
      `INSERT INTO relayed_messages (id, contact_id, message, urgency, channel_type, channel_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.contactId,
      input.message,
      input.urgency || 'normal',
      input.channelType || null,
      input.channelId || null,
    );

    persistenceLogger.debug({ messageId: id }, 'Relayed message created');

    const row = db.prepare('SELECT * FROM relayed_messages WHERE id = ?').get(id) as RelayedMessageDbRow;
    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create relayed message: ${message}`);
  }
}

/**
 * Get a relayed message by ID.
 * @param db - Database connection.
 * @param messageId - The message ID.
 * @returns The message, or null if not found.
 */
export function getRelayedMessage(
  db: BetterSqlite3.Database,
  messageId: string,
): RelayedMessage | null {
  try {
    const row = db.prepare('SELECT * FROM relayed_messages WHERE id = ?').get(messageId) as RelayedMessageDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get relayed message: ${message}`);
  }
}

/**
 * List relayed messages with optional status filter.
 * @param db - Database connection.
 * @param status - Optional status filter.
 * @param limit - Maximum results (default 50).
 * @returns Array of messages, most recent first.
 */
export function listRelayedMessages(
  db: BetterSqlite3.Database,
  status?: MessageStatus,
  limit: number = 50,
): RelayedMessage[] {
  try {
    const rows = status
      ? db.prepare(
          'SELECT * FROM relayed_messages WHERE status = ? ORDER BY created_at DESC LIMIT ?',
        ).all(status, limit) as RelayedMessageDbRow[]
      : db.prepare(
          'SELECT * FROM relayed_messages ORDER BY created_at DESC LIMIT ?',
        ).all(limit) as RelayedMessageDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list relayed messages: ${message}`);
  }
}

/**
 * Mark a message as read.
 * @param db - Database connection.
 * @param messageId - The message ID.
 */
export function markMessageRead(
  db: BetterSqlite3.Database,
  messageId: string,
): void {
  try {
    db.prepare(
      `UPDATE relayed_messages SET status = 'read', read_at = datetime('now') WHERE id = ?`,
    ).run(messageId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to mark message read: ${message}`);
  }
}

/**
 * Mark a message as replied.
 * @param db - Database connection.
 * @param messageId - The message ID.
 */
export function markMessageReplied(
  db: BetterSqlite3.Database,
  messageId: string,
): void {
  try {
    db.prepare(
      `UPDATE relayed_messages SET status = 'replied', replied_at = datetime('now') WHERE id = ?`,
    ).run(messageId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to mark message replied: ${message}`);
  }
}

/**
 * Archive a message.
 * @param db - Database connection.
 * @param messageId - The message ID.
 */
export function archiveMessage(
  db: BetterSqlite3.Database,
  messageId: string,
): void {
  try {
    db.prepare(
      `UPDATE relayed_messages SET status = 'archived' WHERE id = ?`,
    ).run(messageId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to archive message: ${message}`);
  }
}

/**
 * Count unread messages.
 * @param db - Database connection.
 * @returns Unread message count.
 */
export function countUnreadMessages(db: BetterSqlite3.Database): number {
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS count FROM relayed_messages WHERE status = 'unread'`,
    ).get() as { count: number };
    return row.count;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to count unread messages: ${message}`);
  }
}

/**
 * Get messages for a specific contact.
 * @param db - Database connection.
 * @param contactId - The contact ID.
 * @param limit - Maximum results (default 50).
 * @returns Array of messages from that contact.
 */
export function getMessagesByContact(
  db: BetterSqlite3.Database,
  contactId: string,
  limit: number = 50,
): RelayedMessage[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM relayed_messages WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(contactId, limit) as RelayedMessageDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get messages by contact: ${message}`);
  }
}
