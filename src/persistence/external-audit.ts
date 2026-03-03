/**
 * External interaction audit log.
 * Records all interactions from external users for security and visibility.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Valid event types for external interactions. */
export type ExternalAuditEventType =
  | 'message_received'
  | 'wave_triggered'
  | 'wave_blocked'
  | 'rate_limited'
  | 'budget_exceeded'
  | 'trust_change';

/** Application-level external audit entry. */
export interface ExternalAuditEntry {
  id: number;
  contactId: string;
  eventType: ExternalAuditEventType;
  detail: string | null;
  createdAt: Date;
}

/** Raw DB row. */
interface ExternalAuditDbRow {
  id: number;
  contact_id: string;
  event_type: string;
  detail: string | null;
  created_at: string;
}

function mapRow(row: ExternalAuditDbRow): ExternalAuditEntry {
  return {
    id: row.id,
    contactId: row.contact_id,
    eventType: row.event_type as ExternalAuditEventType,
    detail: row.detail,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Log an external interaction event.
 * @param db - Database connection.
 * @param contactId - The contact involved.
 * @param eventType - The type of event.
 * @param detail - Optional detail string.
 * @returns The created audit entry.
 */
export function logExternalEvent(
  db: BetterSqlite3.Database,
  contactId: string,
  eventType: ExternalAuditEventType,
  detail?: string,
): ExternalAuditEntry {
  try {
    const result = db.prepare(
      `INSERT INTO external_audit (contact_id, event_type, detail)
       VALUES (?, ?, ?)`,
    ).run(contactId, eventType, detail ?? null);

    persistenceLogger.debug(
      { contactId, eventType },
      'External audit event logged',
    );

    const row = db.prepare(
      'SELECT * FROM external_audit WHERE id = ?',
    ).get(result.lastInsertRowid) as ExternalAuditDbRow;

    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to log external event: ${message}`);
  }
}

/**
 * Get recent audit events for a contact.
 * @param db - Database connection.
 * @param contactId - The contact ID.
 * @param limit - Maximum entries (default 50).
 * @returns Array of audit entries, most recent first.
 */
export function getExternalAuditByContact(
  db: BetterSqlite3.Database,
  contactId: string,
  limit: number = 50,
): ExternalAuditEntry[] {
  try {
    const rows = db.prepare(
      `SELECT * FROM external_audit
       WHERE contact_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    ).all(contactId, limit) as ExternalAuditDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get external audit: ${message}`);
  }
}

/**
 * Get recent audit events by type.
 * @param db - Database connection.
 * @param eventType - The event type to filter by.
 * @param limit - Maximum entries (default 50).
 * @returns Array of audit entries, most recent first.
 */
export function getExternalAuditByType(
  db: BetterSqlite3.Database,
  eventType: ExternalAuditEventType,
  limit: number = 50,
): ExternalAuditEntry[] {
  try {
    const rows = db.prepare(
      `SELECT * FROM external_audit
       WHERE event_type = ?
       ORDER BY id DESC
       LIMIT ?`,
    ).all(eventType, limit) as ExternalAuditDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get external audit by type: ${message}`);
  }
}

/**
 * Count audit events for a contact within a time window.
 * Used for rate limiting detection.
 * @param db - Database connection.
 * @param contactId - The contact ID.
 * @param eventType - The event type to count.
 * @param since - Count events after this date.
 * @returns The count.
 */
export function countExternalEvents(
  db: BetterSqlite3.Database,
  contactId: string,
  eventType: ExternalAuditEventType,
  since: Date,
): number {
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS count FROM external_audit
       WHERE contact_id = ? AND event_type = ? AND created_at >= ?`,
    // Format as YYYY-MM-DD HH:MM:SS to match SQLite's datetime('now') format
    ).get(contactId, eventType, since.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')) as { count: number };

    return row.count;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to count external events: ${message}`);
  }
}
