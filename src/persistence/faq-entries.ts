/**
 * FAQ entries DAL.
 * Manages frequently asked questions configured by the owner for external users.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level FAQ entry. */
export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  category: string;
  enabled: boolean;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a FAQ entry. */
export interface CreateFaqEntryInput {
  question: string;
  answer: string;
  category?: string;
}

/** Input for updating a FAQ entry. */
export interface UpdateFaqEntryInput {
  question?: string;
  answer?: string;
  category?: string;
  enabled?: boolean;
}

/** Raw DB row. */
interface FaqEntryDbRow {
  id: string;
  question: string;
  answer: string;
  category: string;
  enabled: number;
  access_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Map a raw DB row to an application-level FaqEntry.
 * @param row - The raw database row.
 * @returns The mapped FaqEntry.
 */
function mapRow(row: FaqEntryDbRow): FaqEntry {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    category: row.category,
    enabled: row.enabled === 1,
    accessCount: row.access_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Create a new FAQ entry.
 * @param db - Database connection.
 * @param input - FAQ entry details.
 * @returns The created FAQ entry.
 */
export function createFaqEntry(
  db: BetterSqlite3.Database,
  input: CreateFaqEntryInput,
): FaqEntry {
  try {
    const id = `faq_${nanoid()}`;
    db.prepare(
      `INSERT INTO faq_entries (id, question, answer, category)
       VALUES (?, ?, ?, ?)`,
    ).run(
      id,
      input.question,
      input.answer,
      input.category || 'general',
    );

    persistenceLogger.debug({ faqId: id }, 'FAQ entry created');

    const row = db.prepare('SELECT * FROM faq_entries WHERE id = ?').get(id) as FaqEntryDbRow;
    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create FAQ entry: ${message}`);
  }
}

/**
 * Get a FAQ entry by ID.
 * @param db - Database connection.
 * @param faqId - The FAQ entry ID.
 * @returns The FAQ entry, or null if not found.
 */
export function getFaqEntry(
  db: BetterSqlite3.Database,
  faqId: string,
): FaqEntry | null {
  try {
    const row = db.prepare('SELECT * FROM faq_entries WHERE id = ?').get(faqId) as FaqEntryDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get FAQ entry: ${message}`);
  }
}

/**
 * List FAQ entries with optional category filter.
 * @param db - Database connection.
 * @param category - Optional category filter.
 * @param enabledOnly - If true, return only enabled entries (default true).
 * @param limit - Maximum results (default 100).
 * @returns Array of FAQ entries.
 */
export function listFaqEntries(
  db: BetterSqlite3.Database,
  category?: string,
  enabledOnly: boolean = true,
  limit: number = 100,
): FaqEntry[] {
  try {
    let sql = 'SELECT * FROM faq_entries';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (enabledOnly) {
      conditions.push('enabled = 1');
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY category, question LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as FaqEntryDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list FAQ entries: ${message}`);
  }
}

/**
 * Update a FAQ entry.
 * @param db - Database connection.
 * @param faqId - The FAQ entry ID.
 * @param input - Fields to update.
 * @returns The updated FAQ entry, or null if not found.
 */
export function updateFaqEntry(
  db: BetterSqlite3.Database,
  faqId: string,
  input: UpdateFaqEntryInput,
): FaqEntry | null {
  try {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (input.question !== undefined) {
      setClauses.push('question = ?');
      params.push(input.question);
    }
    if (input.answer !== undefined) {
      setClauses.push('answer = ?');
      params.push(input.answer);
    }
    if (input.category !== undefined) {
      setClauses.push('category = ?');
      params.push(input.category);
    }
    if (input.enabled !== undefined) {
      setClauses.push('enabled = ?');
      params.push(input.enabled ? 1 : 0);
    }

    if (setClauses.length === 0) {
      return getFaqEntry(db, faqId);
    }

    setClauses.push("updated_at = datetime('now')");
    params.push(faqId);

    db.prepare(
      `UPDATE faq_entries SET ${setClauses.join(', ')} WHERE id = ?`,
    ).run(...params);

    persistenceLogger.debug({ faqId }, 'FAQ entry updated');
    return getFaqEntry(db, faqId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update FAQ entry: ${message}`);
  }
}

/**
 * Delete a FAQ entry.
 * @param db - Database connection.
 * @param faqId - The FAQ entry ID.
 */
export function deleteFaqEntry(
  db: BetterSqlite3.Database,
  faqId: string,
): void {
  try {
    db.prepare('DELETE FROM faq_entries WHERE id = ?').run(faqId);
    persistenceLogger.debug({ faqId }, 'FAQ entry deleted');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete FAQ entry: ${message}`);
  }
}

/**
 * Search FAQ entries by query string (keyword matching).
 * @param db - Database connection.
 * @param query - Search query.
 * @param limit - Maximum results (default 10).
 * @returns Matching FAQ entries.
 */
export function searchFaqEntries(
  db: BetterSqlite3.Database,
  query: string,
  limit: number = 10,
): FaqEntry[] {
  try {
    const likePattern = `%${query}%`;
    const rows = db.prepare(
      `SELECT * FROM faq_entries
       WHERE enabled = 1 AND (question LIKE ? OR answer LIKE ? OR category LIKE ?)
       ORDER BY access_count DESC
       LIMIT ?`,
    ).all(likePattern, likePattern, likePattern, limit) as FaqEntryDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to search FAQ entries: ${message}`);
  }
}

/**
 * Increment the access count for a FAQ entry.
 * @param db - Database connection.
 * @param faqId - The FAQ entry ID.
 */
export function incrementFaqAccessCount(
  db: BetterSqlite3.Database,
  faqId: string,
): void {
  try {
    db.prepare(
      'UPDATE faq_entries SET access_count = access_count + 1 WHERE id = ?',
    ).run(faqId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to increment FAQ access count: ${message}`);
  }
}
