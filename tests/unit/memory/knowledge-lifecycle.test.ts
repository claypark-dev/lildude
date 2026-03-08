import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import { runKnowledgeLifecycle } from '../../../src/memory/knowledge-lifecycle.js';
import { markSuperseded } from '../../../src/memory/contradiction-detector.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

/** Helper to insert a knowledge entry with backdated timestamps for testing. */
function insertKnowledgeWithDates(
  db: ReturnType<typeof createDatabase>['db'],
  opts: {
    category?: string;
    key?: string;
    value?: string;
    confidence?: number;
    accessCount?: number;
    createdDaysAgo?: number;
    lastAccessedDaysAgo?: number | null;
  },
): number {
  const {
    category = 'user_fact',
    key = 'test_key',
    value = 'test_value',
    confidence = 0.5,
    accessCount = 0,
    createdDaysAgo = 0,
    lastAccessedDaysAgo = null,
  } = opts;

  const result = db.prepare(`
    INSERT INTO knowledge (category, key, value, confidence, access_count,
      created_at, updated_at, last_accessed_at)
    VALUES (?, ?, ?, ?, ?,
      datetime('now', '-' || ? || ' days'),
      datetime('now', '-' || ? || ' days'),
      CASE WHEN ? IS NOT NULL THEN datetime('now', '-' || ? || ' days') ELSE NULL END)
  `).run(
    category, key, value, confidence, accessCount,
    createdDaysAgo, createdDaysAgo,
    lastAccessedDaysAgo, lastAccessedDaysAgo,
  );

  return result.lastInsertRowid as number;
}

describe('knowledge-lifecycle', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    dbManager.close();
  });

  describe('eviction rules', () => {
    it('evicts low-confidence, never-accessed entries older than 30 days', () => {
      // Should be evicted: low confidence, no access, old
      insertKnowledgeWithDates(dbManager.db, {
        confidence: 0.15,
        accessCount: 0,
        createdDaysAgo: 45,
      });
      // Should survive: low confidence but too recent
      insertKnowledgeWithDates(dbManager.db, {
        key: 'recent',
        confidence: 0.15,
        accessCount: 0,
        createdDaysAgo: 10,
      });

      const result = runKnowledgeLifecycle(dbManager.db);
      expect(result.evicted).toBe(1);

      // Verify the recent one survived
      const remaining = dbManager.db.prepare('SELECT COUNT(*) as cnt FROM knowledge').get() as { cnt: number };
      expect(remaining.cnt).toBe(1);
    });

    it('evicts stale entries not accessed in 90 days', () => {
      insertKnowledgeWithDates(dbManager.db, {
        confidence: 0.4,
        accessCount: 1,
        createdDaysAgo: 100,
        lastAccessedDaysAgo: 95,
      });

      const result = runKnowledgeLifecycle(dbManager.db);
      expect(result.evicted).toBe(1);
    });

    it('evicts superseded entries past 14-day audit window', () => {
      const oldId = insertKnowledgeWithDates(dbManager.db, {
        key: 'lives_in',
        value: 'Seattle',
        confidence: 0.8,
        createdDaysAgo: 30,
      });
      const newId = insertKnowledgeWithDates(dbManager.db, {
        key: 'lives_in',
        value: 'Portland',
        confidence: 0.8,
        createdDaysAgo: 20,
      });
      markSuperseded(dbManager.db, oldId, newId);

      // Manually backdate the superseded_at to 15 days ago
      dbManager.db.prepare(`
        UPDATE knowledge SET superseded_at = datetime('now', '-15 days')
        WHERE id = ?
      `).run(oldId);

      const result = runKnowledgeLifecycle(dbManager.db);
      expect(result.evicted).toBeGreaterThanOrEqual(1);

      // The new entry should survive
      const remaining = dbManager.db.prepare(
        'SELECT id FROM knowledge WHERE superseded_by IS NULL',
      ).all() as { id: number }[];
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(newId);
    });

    it('never evicts high-confidence entries', () => {
      insertKnowledgeWithDates(dbManager.db, {
        confidence: 0.95,
        accessCount: 0,
        createdDaysAgo: 120,
      });

      const result = runKnowledgeLifecycle(dbManager.db);
      // confidence 0.95 >= 0.9 protects from decay; 0.95 >= 0.5 protects from rule 2;
      // 0.95 >= 0.2 protects from rule 1
      expect(result.evicted).toBe(0);
    });
  });

  describe('confidence decay', () => {
    it('decays confidence for rarely-accessed old entries', () => {
      const id = insertKnowledgeWithDates(dbManager.db, {
        confidence: 0.5,
        accessCount: 1,
        createdDaysAgo: 60,
        lastAccessedDaysAgo: 45,
      });

      runKnowledgeLifecycle(dbManager.db);

      const row = dbManager.db.prepare(
        'SELECT confidence FROM knowledge WHERE id = ?',
      ).get(id) as { confidence: number };

      // 0.5 * 0.98 = 0.49
      expect(row.confidence).toBeCloseTo(0.49, 1);
    });

    it('does not decay high-confidence entries', () => {
      const id = insertKnowledgeWithDates(dbManager.db, {
        confidence: 0.92,
        accessCount: 1,
        createdDaysAgo: 60,
        lastAccessedDaysAgo: 45,
      });

      runKnowledgeLifecycle(dbManager.db);

      const row = dbManager.db.prepare(
        'SELECT confidence FROM knowledge WHERE id = ?',
      ).get(id) as { confidence: number };

      // Should remain unchanged (>= 0.9 is protected)
      expect(row.confidence).toBe(0.92);
    });

    it('does not decay below 0.1', () => {
      const id = insertKnowledgeWithDates(dbManager.db, {
        confidence: 0.11,
        accessCount: 1,
        createdDaysAgo: 60,
        lastAccessedDaysAgo: 45,
      });

      runKnowledgeLifecycle(dbManager.db);

      const row = dbManager.db.prepare(
        'SELECT confidence FROM knowledge WHERE id = ?',
      ).get(id) as { confidence: number };

      expect(row.confidence).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe('deduplication', () => {
    it('merges exact duplicate entries', () => {
      insertKnowledgeWithDates(dbManager.db, {
        key: 'lives_in',
        value: 'Seattle',
        confidence: 0.6,
        createdDaysAgo: 30,
      });
      insertKnowledgeWithDates(dbManager.db, {
        key: 'lives_in',
        value: 'Seattle',
        confidence: 0.8,
        createdDaysAgo: 10,
      });

      const result = runKnowledgeLifecycle(dbManager.db);
      expect(result.merged).toBe(1);

      // One entry should remain with the higher confidence
      const rows = dbManager.db.prepare(
        "SELECT confidence FROM knowledge WHERE key = 'lives_in'",
      ).all() as { confidence: number }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].confidence).toBe(0.8);
    });

    it('is idempotent — running twice produces same result', () => {
      insertKnowledgeWithDates(dbManager.db, {
        key: 'lives_in',
        value: 'Seattle',
        confidence: 0.6,
        createdDaysAgo: 30,
      });
      insertKnowledgeWithDates(dbManager.db, {
        key: 'lives_in',
        value: 'Seattle',
        confidence: 0.8,
        createdDaysAgo: 10,
      });

      runKnowledgeLifecycle(dbManager.db);
      const secondResult = runKnowledgeLifecycle(dbManager.db);

      expect(secondResult.merged).toBe(0);
      expect(secondResult.evicted).toBe(0);
    });
  });

  describe('full lifecycle', () => {
    it('handles a mix of eviction, decay, and dedup in one run', () => {
      // Entry to evict (low confidence, old, never accessed)
      insertKnowledgeWithDates(dbManager.db, {
        key: 'stale',
        value: 'old_value',
        confidence: 0.1,
        accessCount: 0,
        createdDaysAgo: 60,
      });

      // Two duplicate entries to merge
      insertKnowledgeWithDates(dbManager.db, {
        key: 'dup',
        value: 'same_value',
        confidence: 0.6,
        accessCount: 3,
        createdDaysAgo: 5,
      });
      insertKnowledgeWithDates(dbManager.db, {
        key: 'dup',
        value: 'same_value',
        confidence: 0.7,
        accessCount: 1,
        createdDaysAgo: 2,
      });

      // Entry to decay (rarely accessed, old, moderate confidence)
      insertKnowledgeWithDates(dbManager.db, {
        key: 'decaying',
        value: 'some_value',
        confidence: 0.5,
        accessCount: 1,
        createdDaysAgo: 45,
        lastAccessedDaysAgo: 40,
      });

      const result = runKnowledgeLifecycle(dbManager.db);
      expect(result.evicted).toBeGreaterThanOrEqual(1);
      expect(result.merged).toBe(1);
    });
  });
});
