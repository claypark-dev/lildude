/**
 * Knowledge data access layer.
 * Provides operations for storing, querying, and managing
 * extracted knowledge facts (key-value pairs organized by category).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';
import {
  detectContradiction,
  markSuperseded,
  boostConfidence,
} from '../memory/contradiction-detector.js';

/** Row shape returned from the knowledge table. */
export interface KnowledgeRow {
  id: number;
  category: string;
  key: string;
  value: string;
  sourceConversationId: string | null;
  sourceTaskId: string | null;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for upserting a knowledge entry. */
export interface UpsertKnowledgeInput {
  category: string;
  key: string;
  value: string;
  sourceConversationId?: string;
  sourceTaskId?: string;
  confidence?: number;
  /** Whether the source message contained a correction signal (e.g. "actually", "I changed"). */
  isCorrection?: boolean;
}

/** Raw row from SQLite for the knowledge table. */
interface KnowledgeDbRow {
  id: number;
  category: string;
  key: string;
  value: string;
  source_conversation_id: string | null;
  source_task_id: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
}

/**
 * Map a raw database row to the application-level KnowledgeRow interface.
 * @param row - Raw SQLite row from the knowledge table.
 * @returns A typed KnowledgeRow object.
 */
function mapRow(row: KnowledgeDbRow): KnowledgeRow {
  return {
    id: row.id,
    category: row.category,
    key: row.key,
    value: row.value,
    sourceConversationId: row.source_conversation_id,
    sourceTaskId: row.source_task_id,
    confidence: row.confidence,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Insert or update a knowledge entry with contradiction-aware logic.
 *
 * Before inserting, checks for existing entries with the same category+key:
 * - **Same value** → boost confidence of existing entry (no duplicate)
 * - **Different value + correction signal** → supersede the old entry
 * - **Different value + much higher confidence** → supersede the old entry
 * - **Different value + similar confidence** → insert both (genuinely different facts)
 *
 * @param db - The database connection.
 * @param input - The knowledge entry data.
 * @returns The resulting knowledge row (new or boosted existing).
 * @throws {PersistenceError} If the operation fails.
 */
export function upsertKnowledge(
  db: BetterSqlite3.Database,
  input: UpsertKnowledgeInput,
): KnowledgeRow {
  try {
    const newConfidence = input.confidence ?? 1.0;

    // Run contradiction detection against existing entries
    const decision = detectContradiction(
      db,
      input.category,
      input.key,
      input.value,
      newConfidence,
      input.isCorrection ?? false,
    );

    if (decision.action === 'boost' && decision.existingId != null && decision.existingConfidence != null) {
      // Same value already exists — boost its confidence instead of duplicating
      boostConfidence(db, decision.existingId, decision.existingConfidence);
      persistenceLogger.debug(
        { knowledgeId: decision.existingId, category: input.category, key: input.key },
        'Knowledge entry boosted (duplicate value)',
      );
      const row = db.prepare(
        'SELECT * FROM knowledge WHERE id = ?',
      ).get(decision.existingId) as KnowledgeDbRow;
      return mapRow(row);
    }

    // Insert the new entry (for both 'insert' and 'supersede' actions)
    const result = db.prepare(
      `INSERT INTO knowledge (category, key, value, source_conversation_id, source_task_id, confidence)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.category,
      input.key,
      input.value,
      input.sourceConversationId ?? null,
      input.sourceTaskId ?? null,
      newConfidence,
    );

    const insertedId = result.lastInsertRowid as number;

    // If superseding, mark the old entry
    if (decision.action === 'supersede' && decision.existingId != null) {
      markSuperseded(db, decision.existingId, insertedId);
      persistenceLogger.debug(
        { newId: insertedId, supersededId: decision.existingId, category: input.category, key: input.key },
        'Knowledge entry superseded',
      );
    } else {
      persistenceLogger.debug(
        { knowledgeId: insertedId, category: input.category, key: input.key },
        'Knowledge entry created',
      );
    }

    const row = db.prepare(
      'SELECT * FROM knowledge WHERE id = ?',
    ).get(insertedId) as KnowledgeDbRow;

    return mapRow(row);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to upsert knowledge: ${message}`);
  }
}

/**
 * Retrieve knowledge entries by category and key.
 * @param db - The database connection.
 * @param category - The category to filter by.
 * @param key - The key to filter by.
 * @returns An array of matching knowledge rows.
 * @throws {PersistenceError} If the query fails.
 */
export function getKnowledge(
  db: BetterSqlite3.Database,
  category: string,
  key: string,
): KnowledgeRow[] {
  try {
    const rows = db.prepare(
      `SELECT * FROM knowledge
       WHERE category = ? AND key = ? AND superseded_by IS NULL
       ORDER BY confidence DESC, created_at DESC`,
    ).all(category, key) as KnowledgeDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get knowledge: ${message}`);
  }
}

/**
 * Search knowledge entries by a term matching against key and value columns.
 * Uses case-insensitive LIKE matching. Optionally filters by category.
 * @param db - The database connection.
 * @param searchTerm - The search term to match against key and value.
 * @param category - Optional category to restrict the search to.
 * @returns An array of matching knowledge rows.
 * @throws {PersistenceError} If the query fails.
 */
export function searchKnowledge(
  db: BetterSqlite3.Database,
  searchTerm: string,
  category?: string,
): KnowledgeRow[] {
  try {
    const pattern = `%${searchTerm}%`;

    if (category !== undefined) {
      const rows = db.prepare(
        `SELECT * FROM knowledge
         WHERE category = ? AND superseded_by IS NULL
           AND (key LIKE ? COLLATE NOCASE OR value LIKE ? COLLATE NOCASE)
         ORDER BY confidence DESC, created_at DESC`,
      ).all(category, pattern, pattern) as KnowledgeDbRow[];

      return rows.map(mapRow);
    }

    const rows = db.prepare(
      `SELECT * FROM knowledge
       WHERE superseded_by IS NULL
         AND (key LIKE ? COLLATE NOCASE OR value LIKE ? COLLATE NOCASE)
       ORDER BY confidence DESC, created_at DESC`,
    ).all(pattern, pattern) as KnowledgeDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to search knowledge: ${message}`);
  }
}

/**
 * Retrieve all knowledge entries for a given category.
 * @param db - The database connection.
 * @param category - The category to filter by.
 * @returns An array of knowledge rows in the specified category.
 * @throws {PersistenceError} If the query fails.
 */
export function getKnowledgeByCategory(
  db: BetterSqlite3.Database,
  category: string,
): KnowledgeRow[] {
  try {
    const rows = db.prepare(
      `SELECT * FROM knowledge
       WHERE category = ? AND superseded_by IS NULL
       ORDER BY confidence DESC, created_at DESC`,
    ).all(category) as KnowledgeDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get knowledge by category: ${message}`);
  }
}

/**
 * Delete a knowledge entry by its ID.
 * @param db - The database connection.
 * @param knowledgeId - The knowledge entry's unique identifier.
 * @returns True if an entry was deleted, false if it did not exist.
 * @throws {PersistenceError} If the delete fails.
 */
export function deleteKnowledge(
  db: BetterSqlite3.Database,
  knowledgeId: number,
): boolean {
  try {
    const result = db.prepare(
      'DELETE FROM knowledge WHERE id = ?',
    ).run(knowledgeId);

    const deleted = result.changes > 0;
    if (deleted) {
      persistenceLogger.debug({ knowledgeId }, 'Knowledge entry deleted');
    }
    return deleted;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete knowledge: ${message}`);
  }
}
