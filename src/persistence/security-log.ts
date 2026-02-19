/**
 * Security log data access layer.
 * Provides functions to append and query the security audit log.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level representation of a security log entry. */
export interface SecurityLogRow {
  id: number;
  actionType: string;
  actionDetail: string;
  allowed: boolean;
  securityLevel: number;
  reason: string | null;
  taskId: string | null;
  createdAt: Date;
}

/** Input for appending a new security log entry. */
export interface AppendSecurityLogInput {
  actionType: string;
  actionDetail: string;
  allowed: boolean;
  securityLevel: number;
  reason?: string;
  taskId?: string;
}

/** Raw row shape from the security_log table. */
interface SecurityLogDbRow {
  id: number;
  action_type: string;
  action_detail: string;
  allowed: number;
  security_level: number;
  reason: string | null;
  task_id: string | null;
  created_at: string;
}

/**
 * Map a raw database row to the application-level SecurityLogRow.
 * @param row - Raw SQLite row from the security_log table.
 * @returns A typed SecurityLogRow object.
 */
function mapRow(row: SecurityLogDbRow): SecurityLogRow {
  return {
    id: row.id,
    actionType: row.action_type,
    actionDetail: row.action_detail,
    allowed: row.allowed === 1,
    securityLevel: row.security_level,
    reason: row.reason,
    taskId: row.task_id,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Append a new entry to the security log.
 * @param db - The better-sqlite3 Database instance.
 * @param input - The security log entry data.
 * @returns The newly created SecurityLogRow.
 * @throws {PersistenceError} If the insert fails.
 */
export function appendSecurityLog(
  db: BetterSqlite3.Database,
  input: AppendSecurityLogInput,
): SecurityLogRow {
  try {
    const result = db.prepare(
      `INSERT INTO security_log (action_type, action_detail, allowed, security_level, reason, task_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.actionType,
      input.actionDetail,
      input.allowed ? 1 : 0,
      input.securityLevel,
      input.reason ?? null,
      input.taskId ?? null,
    );

    persistenceLogger.debug(
      { actionType: input.actionType, allowed: input.allowed },
      'Security log entry appended',
    );

    const row = db.prepare(
      'SELECT * FROM security_log WHERE id = ?',
    ).get(result.lastInsertRowid) as SecurityLogDbRow;

    return mapRow(row);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to append security log: ${message}`);
  }
}

/**
 * Get recent security log entries, most recent first.
 * @param db - The better-sqlite3 Database instance.
 * @param limit - Maximum number of entries to return (default: 50).
 * @param offset - Number of entries to skip (default: 0).
 * @returns An array of SecurityLogRow objects ordered by most recent first.
 * @throws {PersistenceError} If the query fails.
 */
export function getRecentSecurityLogs(
  db: BetterSqlite3.Database,
  limit: number = 50,
  offset: number = 0,
): SecurityLogRow[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM security_log ORDER BY created_at DESC LIMIT ? OFFSET ?',
    ).all(limit, offset) as SecurityLogDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get recent security logs: ${message}`);
  }
}

/**
 * Get security log entries filtered by action type.
 * @param db - The better-sqlite3 Database instance.
 * @param actionType - The action type to filter by.
 * @param limit - Maximum number of entries to return (default: 50).
 * @returns An array of SecurityLogRow objects matching the action type.
 * @throws {PersistenceError} If the query fails.
 */
export function getSecurityLogsByAction(
  db: BetterSqlite3.Database,
  actionType: string,
  limit: number = 50,
): SecurityLogRow[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM security_log WHERE action_type = ? ORDER BY created_at DESC LIMIT ?',
    ).all(actionType, limit) as SecurityLogDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get security logs by action: ${message}`);
  }
}

/**
 * Get security log entries filtered by allowed/denied status.
 * @param db - The better-sqlite3 Database instance.
 * @param allowed - Whether to filter for allowed (true) or denied (false) entries.
 * @param limit - Maximum number of entries to return (default: 50).
 * @returns An array of SecurityLogRow objects matching the allowed status.
 * @throws {PersistenceError} If the query fails.
 */
export function getSecurityLogsByAllowed(
  db: BetterSqlite3.Database,
  allowed: boolean,
  limit: number = 50,
): SecurityLogRow[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM security_log WHERE allowed = ? ORDER BY created_at DESC LIMIT ?',
    ).all(allowed ? 1 : 0, limit) as SecurityLogDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get security logs by allowed: ${message}`);
  }
}

/**
 * Count security log entries, optionally since a given date.
 * @param db - The better-sqlite3 Database instance.
 * @param since - Optional date to count entries from. Counts all entries if omitted.
 * @returns The total number of matching security log entries.
 * @throws {PersistenceError} If the query fails.
 */
export function countSecurityLogs(
  db: BetterSqlite3.Database,
  since?: Date,
): number {
  try {
    if (since) {
      const row = db.prepare(
        `SELECT COUNT(*) AS count FROM security_log WHERE created_at >= ?`,
      ).get(since.toISOString()) as { count: number };

      return row.count;
    }

    const row = db.prepare(
      'SELECT COUNT(*) AS count FROM security_log',
    ).get() as { count: number };

    return row.count;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to count security logs: ${message}`);
  }
}
