import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import {
  detectContradiction,
  markSuperseded,
  boostConfidence,
} from '../../../src/memory/contradiction-detector.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

/** Helper to insert a knowledge entry directly for testing. */
function insertKnowledge(
  db: ReturnType<typeof createDatabase>['db'],
  category: string,
  key: string,
  value: string,
  confidence = 0.8,
): number {
  const result = db.prepare(
    `INSERT INTO knowledge (category, key, value, confidence)
     VALUES (?, ?, ?, ?)`,
  ).run(category, key, value, confidence);
  return result.lastInsertRowid as number;
}

describe('contradiction-detector', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    dbManager.close();
  });

  describe('detectContradiction', () => {
    it('returns insert when no existing entry exists', () => {
      const result = detectContradiction(
        dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.8,
      );
      expect(result.action).toBe('insert');
      expect(result.existingId).toBeUndefined();
    });

    it('returns boost when same value already exists', () => {
      const id = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.7);

      const result = detectContradiction(
        dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.7,
      );
      expect(result.action).toBe('boost');
      expect(result.existingId).toBe(id);
      expect(result.existingConfidence).toBe(0.7);
    });

    it('returns boost for similar values (high Jaccard similarity)', () => {
      const id = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'downtown Seattle WA', 0.7);

      const result = detectContradiction(
        dbManager.db, 'user_fact', 'lives_in', 'downtown seattle wa', 0.7,
      );
      expect(result.action).toBe('boost');
      expect(result.existingId).toBe(id);
    });

    it('returns supersede when correction signal is present', () => {
      const id = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.8);

      const result = detectContradiction(
        dbManager.db, 'user_fact', 'lives_in', 'Portland', 0.8, true,
      );
      expect(result.action).toBe('supersede');
      expect(result.existingId).toBe(id);
    });

    it('returns supersede when new confidence is significantly higher', () => {
      const id = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.5);

      const result = detectContradiction(
        dbManager.db, 'user_fact', 'lives_in', 'Portland', 0.75,
      );
      expect(result.action).toBe('supersede');
      expect(result.existingId).toBe(id);
    });

    it('returns insert when values differ but confidence is similar', () => {
      insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.7);

      const result = detectContradiction(
        dbManager.db, 'user_fact', 'lives_in', 'Portland', 0.8,
      );
      // Delta is 0.1, which is < 0.2 threshold, so insert both
      expect(result.action).toBe('insert');
    });

    it('ignores superseded entries', () => {
      const oldId = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.8);
      const newId = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Portland', 0.8);
      markSuperseded(dbManager.db, oldId, newId);

      // Now trying to detect against "Seattle" should not find the superseded entry
      const result = detectContradiction(
        dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.8,
      );
      // Should compare against "Portland" (active), not "Seattle" (superseded)
      // Portland vs Seattle are different, same confidence → insert
      expect(result.action).toBe('insert');
    });
  });

  describe('markSuperseded', () => {
    it('sets superseded_by and superseded_at on the old entry', () => {
      const oldId = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.8);
      const newId = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Portland', 0.8);

      markSuperseded(dbManager.db, oldId, newId);

      const row = dbManager.db.prepare(
        'SELECT superseded_by, superseded_at FROM knowledge WHERE id = ?',
      ).get(oldId) as { superseded_by: number | null; superseded_at: string | null };

      expect(row.superseded_by).toBe(newId);
      expect(row.superseded_at).not.toBeNull();
    });
  });

  describe('boostConfidence', () => {
    it('increments confidence by 0.05', () => {
      const id = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.7);

      boostConfidence(dbManager.db, id, 0.7);

      const row = dbManager.db.prepare(
        'SELECT confidence FROM knowledge WHERE id = ?',
      ).get(id) as { confidence: number };

      expect(row.confidence).toBeCloseTo(0.75, 5);
    });

    it('caps confidence at 0.95', () => {
      const id = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.92);

      boostConfidence(dbManager.db, id, 0.92);

      const row = dbManager.db.prepare(
        'SELECT confidence FROM knowledge WHERE id = ?',
      ).get(id) as { confidence: number };

      expect(row.confidence).toBe(0.95);
    });

    it('increments access_count', () => {
      const id = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Seattle', 0.7);

      boostConfidence(dbManager.db, id, 0.7);

      const row = dbManager.db.prepare(
        'SELECT access_count FROM knowledge WHERE id = ?',
      ).get(id) as { access_count: number };

      expect(row.access_count).toBe(1);
    });
  });
});
