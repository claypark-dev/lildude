/**
 * Knowledge privacy data access layer.
 * Provides visibility-filtered queries for the knowledge table,
 * ensuring party waves only see 'shared' knowledge.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Valid visibility levels for knowledge entries. */
export type KnowledgeVisibility = 'owner' | 'shared';

/** Knowledge row with visibility field. */
export interface KnowledgeRowWithVisibility {
  id: number;
  category: string;
  key: string;
  value: string;
  visibility: KnowledgeVisibility;
  confidence: number;
  createdAt: Date;
}

/** Raw DB row shape with visibility. */
interface VisibilityDbRow {
  id: number;
  category: string;
  key: string;
  value: string;
  visibility: string;
  confidence: number;
  created_at: string;
}

/** Map raw row to typed interface. */
function mapVisRow(row: VisibilityDbRow): KnowledgeRowWithVisibility {
  return {
    id: row.id,
    category: row.category,
    key: row.key,
    value: row.value,
    visibility: row.visibility as KnowledgeVisibility,
    confidence: row.confidence,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Update the visibility of a knowledge entry.
 *
 * @param db - The database connection.
 * @param knowledgeId - The knowledge entry ID.
 * @param visibility - The new visibility level.
 * @returns True if the entry was updated.
 */
export function setKnowledgeVisibility(
  db: BetterSqlite3.Database,
  knowledgeId: number,
  visibility: KnowledgeVisibility,
): boolean {
  try {
    const result = db.prepare(
      `UPDATE knowledge SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(visibility, knowledgeId);

    if (result.changes > 0) {
      // Also update the embedding visibility if it exists
      db.prepare(
        `UPDATE knowledge_embeddings SET visibility = ? WHERE knowledge_id = ?`,
      ).run(visibility, knowledgeId);

      persistenceLogger.debug({ knowledgeId, visibility }, 'Knowledge visibility updated');
    }

    return result.changes > 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to set knowledge visibility: ${message}`);
  }
}

/**
 * Search knowledge entries filtered by visibility.
 * Used to restrict party waves to 'shared' knowledge only.
 *
 * @param db - The database connection.
 * @param searchTerm - The search term.
 * @param visibility - Only return entries with this visibility.
 * @param category - Optional category filter.
 * @returns Matching knowledge rows.
 */
export function searchKnowledgeByVisibility(
  db: BetterSqlite3.Database,
  searchTerm: string,
  visibility: KnowledgeVisibility,
  category?: string,
): KnowledgeRowWithVisibility[] {
  try {
    const pattern = `%${searchTerm}%`;

    if (category !== undefined) {
      const rows = db.prepare(
        `SELECT id, category, key, value, visibility, confidence, created_at
         FROM knowledge
         WHERE visibility = ? AND category = ?
           AND (key LIKE ? COLLATE NOCASE OR value LIKE ? COLLATE NOCASE)
         ORDER BY created_at DESC`,
      ).all(visibility, category, pattern, pattern) as VisibilityDbRow[];

      return rows.map(mapVisRow);
    }

    const rows = db.prepare(
      `SELECT id, category, key, value, visibility, confidence, created_at
       FROM knowledge
       WHERE visibility = ?
         AND (key LIKE ? COLLATE NOCASE OR value LIKE ? COLLATE NOCASE)
       ORDER BY created_at DESC`,
    ).all(visibility, pattern, pattern) as VisibilityDbRow[];

    return rows.map(mapVisRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to search knowledge by visibility: ${message}`);
  }
}

/**
 * Get all knowledge entries with a specific visibility level.
 *
 * @param db - The database connection.
 * @param visibility - The visibility level to filter by.
 * @returns All matching knowledge rows.
 */
export function listKnowledgeByVisibility(
  db: BetterSqlite3.Database,
  visibility: KnowledgeVisibility,
): KnowledgeRowWithVisibility[] {
  try {
    const rows = db.prepare(
      `SELECT id, category, key, value, visibility, confidence, created_at
       FROM knowledge
       WHERE visibility = ?
       ORDER BY created_at DESC`,
    ).all(visibility) as VisibilityDbRow[];

    return rows.map(mapVisRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list knowledge by visibility: ${message}`);
  }
}

/**
 * Count knowledge entries by visibility.
 *
 * @param db - The database connection.
 * @param visibility - The visibility level.
 * @returns Number of entries with that visibility.
 */
export function countKnowledgeByVisibility(
  db: BetterSqlite3.Database,
  visibility: KnowledgeVisibility,
): number {
  try {
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM knowledge WHERE visibility = ?`,
    ).get(visibility) as { count: number };

    return row.count;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to count knowledge by visibility: ${message}`);
  }
}

/**
 * Log a party wave knowledge access attempt for auditing.
 *
 * @param db - The database connection.
 * @param knowledgeId - The knowledge entry ID (null if search returned no results).
 * @param waveName - The party wave name.
 * @param contactId - The external contact ID.
 * @param accessType - Type of access attempted.
 * @param wasAllowed - Whether the access was permitted.
 */
export function logKnowledgeAccess(
  db: BetterSqlite3.Database,
  knowledgeId: number | null,
  waveName: string,
  contactId: string,
  accessType: 'search' | 'read' | 'blocked',
  wasAllowed: boolean,
): void {
  try {
    db.prepare(
      `INSERT INTO party_wave_knowledge_access
       (knowledge_id, wave_name, contact_id, access_type, was_allowed)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(knowledgeId, waveName, contactId, accessType, wasAllowed ? 1 : 0);
  } catch (error: unknown) {
    // Non-critical — don't throw, just log
    const message = error instanceof Error ? error.message : String(error);
    persistenceLogger.warn({ error: message }, 'Failed to log knowledge access');
  }
}

/**
 * Get recent knowledge access logs for auditing.
 *
 * @param db - The database connection.
 * @param limit - Maximum entries to return.
 * @returns Recent access log entries.
 */
export function getKnowledgeAccessLogs(
  db: BetterSqlite3.Database,
  limit = 50,
): Array<{
  id: number;
  knowledgeId: number | null;
  waveName: string;
  contactId: string;
  accessType: string;
  wasAllowed: boolean;
  createdAt: string;
}> {
  try {
    const rows = db.prepare(
      `SELECT id, knowledge_id, wave_name, contact_id, access_type, was_allowed, created_at
       FROM party_wave_knowledge_access
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(limit) as Array<{
      id: number;
      knowledge_id: number | null;
      wave_name: string;
      contact_id: string;
      access_type: string;
      was_allowed: number;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      knowledgeId: r.knowledge_id,
      waveName: r.wave_name,
      contactId: r.contact_id,
      accessType: r.access_type,
      wasAllowed: r.was_allowed === 1,
      createdAt: r.created_at,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get knowledge access logs: ${message}`);
  }
}
