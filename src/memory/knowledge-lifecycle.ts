/**
 * Knowledge lifecycle management — eviction and confidence decay.
 * Runs daily via the learning journal to keep the knowledge base
 * lean and high-quality. All logic is deterministic — no LLM calls.
 *
 * Part of the Memory System Re-engineering (Sprint A, Gap 5).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('knowledge-lifecycle');

/** Summary of a lifecycle run. */
export interface LifecycleResult {
  /** Number of entries evicted (deleted). */
  evicted: number;
  /** Number of entries with confidence decayed. */
  decayed: number;
  /** Number of duplicate entries merged. */
  merged: number;
}

/**
 * Run the full knowledge lifecycle: eviction, decay, and deduplication.
 * Safe to call multiple times per day (idempotent).
 *
 * @param db - Database connection.
 * @returns Summary of actions taken.
 */
export function runKnowledgeLifecycle(db: BetterSqlite3.Database): LifecycleResult {
  const result: LifecycleResult = { evicted: 0, decayed: 0, merged: 0 };

  try {
    // Run all lifecycle operations inside a single transaction for atomicity
    db.transaction(() => {
      result.evicted = evictStaleEntries(db);
      result.decayed = decayConfidence(db);
      result.merged = mergeDuplicates(db);
    })();

    log.info(result, 'Knowledge lifecycle completed');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ error: msg }, 'Knowledge lifecycle failed');
  }

  return result;
}

/**
 * Evict knowledge entries that are no longer valuable.
 *
 * Rules:
 * 1. Low confidence, never accessed, older than 30 days → delete
 * 2. Not accessed in 90 days, low confidence, low access count → delete
 * 3. Superseded entries with audit window expired (14 days) → delete
 *
 * Safety: Never evict entries with confidence >= 0.9.
 *
 * @param db - Database connection.
 * @returns Number of entries evicted.
 */
function evictStaleEntries(db: BetterSqlite3.Database): number {
  let totalEvicted = 0;

  // Rule 1: Low confidence, never accessed, old
  const rule1 = db.prepare(`
    DELETE FROM knowledge
    WHERE confidence < 0.2
      AND access_count = 0
      AND created_at < datetime('now', '-30 days')
      AND superseded_by IS NULL
  `).run();
  totalEvicted += rule1.changes;

  // Rule 2: Stale entries — not accessed recently, low engagement
  const rule2 = db.prepare(`
    DELETE FROM knowledge
    WHERE (last_accessed_at IS NULL OR last_accessed_at < datetime('now', '-90 days'))
      AND confidence < 0.5
      AND access_count < 3
      AND created_at < datetime('now', '-90 days')
      AND superseded_by IS NULL
  `).run();
  totalEvicted += rule2.changes;

  // Rule 3: Superseded entries past audit window
  const rule3 = db.prepare(`
    DELETE FROM knowledge
    WHERE superseded_by IS NOT NULL
      AND superseded_at < datetime('now', '-14 days')
  `).run();
  totalEvicted += rule3.changes;

  if (totalEvicted > 0) {
    log.debug(
      { rule1: rule1.changes, rule2: rule2.changes, rule3: rule3.changes },
      'Evicted stale knowledge entries',
    );
  }

  return totalEvicted;
}

/**
 * Apply confidence decay to rarely-accessed entries.
 * Monthly decay: confidence *= 0.98 for entries that haven't been
 * accessed in 30+ days and have low engagement.
 *
 * Safety: Never decay below 0.1 or entries with confidence >= 0.9.
 *
 * @param db - Database connection.
 * @returns Number of entries decayed.
 */
function decayConfidence(db: BetterSqlite3.Database): number {
  const result = db.prepare(`
    UPDATE knowledge
    SET confidence = MAX(0.1, confidence * 0.98),
        updated_at = CURRENT_TIMESTAMP
    WHERE access_count < 2
      AND (last_accessed_at IS NULL OR last_accessed_at < datetime('now', '-30 days'))
      AND confidence < 0.9
      AND confidence > 0.1
      AND superseded_by IS NULL
      AND updated_at < datetime('now', '-30 days')
  `).run();

  return result.changes;
}

/**
 * Merge exact duplicate entries (same category + key + value).
 * Keeps the entry with the highest confidence, deletes the rest.
 *
 * @param db - Database connection.
 * @returns Number of duplicate entries removed.
 */
function mergeDuplicates(db: BetterSqlite3.Database): number {
  // Find groups of active duplicates (same category + key + normalized value)
  const duplicates = db.prepare(`
    SELECT category, key, value, COUNT(*) as cnt,
           MAX(confidence) as max_confidence,
           MAX(id) as keep_id
    FROM knowledge
    WHERE superseded_by IS NULL
    GROUP BY category, key, LOWER(TRIM(value))
    HAVING cnt > 1
  `).all() as Array<{
    category: string;
    key: string;
    value: string;
    cnt: number;
    max_confidence: number;
    keep_id: number;
  }>;

  let totalMerged = 0;

  for (const dup of duplicates) {
    // Delete all duplicates except the one with highest ID (most recent)
    // But first, update the kept entry to have the max confidence
    db.prepare(`
      UPDATE knowledge SET confidence = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(dup.max_confidence, dup.keep_id);

    const result = db.prepare(`
      DELETE FROM knowledge
      WHERE category = ? AND key = ? AND LOWER(TRIM(value)) = LOWER(TRIM(?))
        AND superseded_by IS NULL
        AND id != ?
    `).run(dup.category, dup.key, dup.value, dup.keep_id);

    totalMerged += result.changes;
  }

  if (totalMerged > 0) {
    log.debug({ merged: totalMerged }, 'Merged duplicate knowledge entries');
  }

  return totalMerged;
}
