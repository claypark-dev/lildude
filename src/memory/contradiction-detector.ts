/**
 * Contradiction detection for knowledge entries.
 * Before inserting a new fact, checks for existing entries with the
 * same category+key and determines whether to insert, supersede, or boost.
 *
 * All logic is deterministic — no LLM calls.
 * Part of the Memory System Re-engineering (Sprint A, Gap 2).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('contradiction-detector');

/** Result of contradiction analysis. */
export interface ContradictionResult {
  /** What to do with the new entry. */
  action: 'insert' | 'supersede' | 'boost';
  /** ID of the existing entry to supersede or boost (undefined for insert). */
  existingId?: number;
  /** Current confidence of the existing entry (for boost calculation). */
  existingConfidence?: number;
}

/** Row shape for the existing entry query. */
interface ExistingEntryRow {
  id: number;
  value: string;
  confidence: number;
  created_at: string;
}

/**
 * Detect whether a new knowledge entry contradicts, duplicates, or is
 * independent of existing entries with the same category+key.
 *
 * @param db - Database connection.
 * @param category - Knowledge category.
 * @param key - Knowledge key.
 * @param newValue - The new value being inserted.
 * @param newConfidence - Confidence of the new entry.
 * @param isCorrection - Whether the source message contained correction signals.
 * @returns The recommended action and affected existing entry ID.
 */
export function detectContradiction(
  db: BetterSqlite3.Database,
  category: string,
  key: string,
  newValue: string,
  newConfidence: number,
  isCorrection: boolean = false,
): ContradictionResult {
  // Find the most recent active (non-superseded) entry for this category+key.
  const existing = db.prepare(
    `SELECT id, value, confidence, created_at
     FROM knowledge
     WHERE category = ? AND key = ? AND superseded_by IS NULL
     ORDER BY confidence DESC, created_at DESC
     LIMIT 1`,
  ).get(category, key) as ExistingEntryRow | undefined;

  if (!existing) {
    return { action: 'insert' };
  }

  const normalizedExisting = normalizeValue(existing.value);
  const normalizedNew = normalizeValue(newValue);

  // Same value → boost confidence
  if (normalizedExisting === normalizedNew || jaccardSimilarity(normalizedExisting, normalizedNew) > 0.85) {
    return {
      action: 'boost',
      existingId: existing.id,
      existingConfidence: existing.confidence,
    };
  }

  // Correction signal → supersede regardless of confidence
  if (isCorrection) {
    log.debug(
      { key, oldValue: existing.value, newValue, reason: 'correction_signal' },
      'Superseding knowledge entry (correction detected)',
    );
    return {
      action: 'supersede',
      existingId: existing.id,
      existingConfidence: existing.confidence,
    };
  }

  // New entry has significantly higher confidence → supersede
  if (newConfidence - existing.confidence >= 0.2) {
    log.debug(
      { key, oldValue: existing.value, newValue, confidenceDelta: newConfidence - existing.confidence },
      'Superseding knowledge entry (higher confidence)',
    );
    return {
      action: 'supersede',
      existingId: existing.id,
      existingConfidence: existing.confidence,
    };
  }

  // Different value, similar confidence, no correction → allow both
  return { action: 'insert' };
}

/**
 * Mark an existing knowledge entry as superseded by a new entry.
 *
 * @param db - Database connection.
 * @param existingId - ID of the entry being superseded.
 * @param newId - ID of the entry that supersedes it.
 */
export function markSuperseded(
  db: BetterSqlite3.Database,
  existingId: number,
  newId: number,
): void {
  db.prepare(
    `UPDATE knowledge
     SET superseded_by = ?, superseded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(newId, existingId);
}

/**
 * Boost the confidence of an existing knowledge entry.
 *
 * @param db - Database connection.
 * @param existingId - ID of the entry to boost.
 * @param currentConfidence - Current confidence score.
 */
export function boostConfidence(
  db: BetterSqlite3.Database,
  existingId: number,
  currentConfidence: number,
): void {
  const newConfidence = Math.min(0.95, currentConfidence + 0.05);
  db.prepare(
    `UPDATE knowledge
     SET confidence = ?, access_count = access_count + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(newConfidence, existingId);
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Normalize a value for comparison (lowercase, trim, collapse whitespace).
 */
function normalizeValue(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Jaccard similarity between two strings (word-level).
 * Returns 0-1 where 1 = identical word sets.
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
