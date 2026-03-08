/**
 * Wave publish history DAL.
 * Tracks community wave submissions from this Lil Dude instance.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Publish status values. */
export type PublishStatus = 'pending' | 'merged' | 'rejected' | 'closed';

/** Application-level publish history entry. */
export interface PublishHistoryEntry {
  id: string;
  waveName: string;
  version: string;
  prUrl: string | null;
  prNumber: number | null;
  status: PublishStatus;
  publishedAt: Date;
}

/** Raw DB row. */
interface PublishDbRow {
  id: string;
  wave_name: string;
  version: string;
  pr_url: string | null;
  pr_number: number | null;
  status: string;
  published_at: string;
}

/**
 * Map a raw DB row to an application-level PublishHistoryEntry.
 * @param row - The raw database row.
 * @returns The mapped PublishHistoryEntry.
 */
function mapRow(row: PublishDbRow): PublishHistoryEntry {
  return {
    id: row.id,
    waveName: row.wave_name,
    version: row.version,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    status: row.status as PublishStatus,
    publishedAt: new Date(row.published_at),
  };
}

/**
 * Record a new publish attempt.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @param version - The wave version.
 * @param prUrl - The PR URL (null for dry runs).
 * @param prNumber - The PR number (null for dry runs).
 * @returns The created history entry.
 */
export function recordPublish(
  db: BetterSqlite3.Database,
  waveName: string,
  version: string,
  prUrl: string | null,
  prNumber: number | null,
): PublishHistoryEntry {
  try {
    const id = `pub_${nanoid()}`;
    const status: PublishStatus = prUrl ? 'pending' : 'pending';

    db.prepare(
      `INSERT INTO wave_publish_history (id, wave_name, version, pr_url, pr_number, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, waveName, version, prUrl, prNumber, status);

    const row = db.prepare(
      'SELECT * FROM wave_publish_history WHERE id = ?',
    ).get(id) as PublishDbRow;

    persistenceLogger.debug({ id, waveName, version }, 'Publish recorded');
    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to record publish: ${message}`);
  }
}

/**
 * Update the status of a publish entry.
 * @param db - Database connection.
 * @param id - The publish history entry ID.
 * @param status - The new status.
 */
export function updatePublishStatus(
  db: BetterSqlite3.Database,
  id: string,
  status: PublishStatus,
): void {
  try {
    db.prepare(
      'UPDATE wave_publish_history SET status = ? WHERE id = ?',
    ).run(status, id);
    persistenceLogger.debug({ id, status }, 'Publish status updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update publish status: ${message}`);
  }
}

/**
 * Get the publish history for a specific wave.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @returns Array of publish history entries, most recent first.
 */
export function getPublishHistory(
  db: BetterSqlite3.Database,
  waveName: string,
): PublishHistoryEntry[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM wave_publish_history WHERE wave_name = ? ORDER BY published_at DESC',
    ).all(waveName) as PublishDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get publish history: ${message}`);
  }
}

/**
 * Get all publish history entries, most recent first.
 * @param db - Database connection.
 * @param limit - Maximum results (default 50).
 * @returns Array of publish history entries.
 */
export function listPublishHistory(
  db: BetterSqlite3.Database,
  limit: number = 50,
): PublishHistoryEntry[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM wave_publish_history ORDER BY published_at DESC LIMIT ?',
    ).all(limit) as PublishDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list publish history: ${message}`);
  }
}
