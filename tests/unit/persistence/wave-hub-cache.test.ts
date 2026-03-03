import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import {
  getCachedRegistry,
  setCachedRegistry,
  getCachedEtag,
  rateWave,
  getWaveRating,
  getAllWaveRatings,
} from '../../../src/persistence/wave-hub-cache.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('wave-hub-cache DAL', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  describe('registry cache', () => {
    it('setCachedRegistry stores and getCachedRegistry retrieves', () => {
      const testData = JSON.stringify({ version: '1', waves: [] });
      setCachedRegistry(db, 'https://example.com/registry.json', testData, 24, 'etag-123');

      const cached = getCachedRegistry(db, 'https://example.com/registry.json');
      expect(cached).not.toBeNull();
      expect(cached!.data).toBe(testData);
      expect(cached!.etag).toBe('etag-123');
      expect(cached!.registryUrl).toBe('https://example.com/registry.json');
    });

    it('getCachedRegistry returns null for missing URL', () => {
      const cached = getCachedRegistry(db, 'https://nonexistent.com/registry.json');
      expect(cached).toBeNull();
    });

    it('getCachedRegistry returns null for expired entries', () => {
      // Insert with 0 hour TTL (already expired)
      db.prepare(`
        INSERT INTO wave_hub_cache (registry_url, data, expires_at)
        VALUES (?, ?, datetime('now', '-1 hours'))
      `).run('https://expired.com/registry.json', '{}');

      const cached = getCachedRegistry(db, 'https://expired.com/registry.json');
      expect(cached).toBeNull();
    });

    it('setCachedRegistry upserts on same URL', () => {
      setCachedRegistry(db, 'https://example.com/r.json', 'first', 24);
      setCachedRegistry(db, 'https://example.com/r.json', 'second', 24);

      const cached = getCachedRegistry(db, 'https://example.com/r.json');
      expect(cached).not.toBeNull();
      expect(cached!.data).toBe('second');
    });

    it('getCachedEtag returns stored ETag', () => {
      setCachedRegistry(db, 'https://example.com/r.json', '{}', 24, 'my-etag');

      const etag = getCachedEtag(db, 'https://example.com/r.json');
      expect(etag).toBe('my-etag');
    });

    it('getCachedEtag returns null for missing URL', () => {
      const etag = getCachedEtag(db, 'https://nonexistent.com');
      expect(etag).toBeNull();
    });
  });

  describe('wave ratings', () => {
    it('rateWave stores a rating', () => {
      rateWave(db, 'web-search', 5, 'Excellent!');

      const rating = getWaveRating(db, 'web-search');
      expect(rating).not.toBeNull();
      expect(rating!.waveName).toBe('web-search');
      expect(rating!.rating).toBe(5);
      expect(rating!.comment).toBe('Excellent!');
    });

    it('rateWave upserts on same wave name', () => {
      rateWave(db, 'web-search', 3);
      rateWave(db, 'web-search', 5, 'Changed rating');

      const rating = getWaveRating(db, 'web-search');
      expect(rating).not.toBeNull();
      expect(rating!.rating).toBe(5);
      expect(rating!.comment).toBe('Changed rating');
    });

    it('rateWave rejects invalid ratings', () => {
      expect(() => rateWave(db, 'test', 0)).toThrow('Rating must be an integer between 1 and 5');
      expect(() => rateWave(db, 'test', 6)).toThrow('Rating must be an integer between 1 and 5');
      expect(() => rateWave(db, 'test', 2.5)).toThrow('Rating must be an integer between 1 and 5');
    });

    it('getWaveRating returns null for unrated wave', () => {
      const rating = getWaveRating(db, 'unrated-wave');
      expect(rating).toBeNull();
    });

    it('rateWave stores rating without comment', () => {
      rateWave(db, 'test-wave', 4);

      const rating = getWaveRating(db, 'test-wave');
      expect(rating).not.toBeNull();
      expect(rating!.rating).toBe(4);
      expect(rating!.comment).toBeNull();
    });

    it('getAllWaveRatings returns all ratings', () => {
      rateWave(db, 'wave-a', 5);
      rateWave(db, 'wave-b', 3);
      rateWave(db, 'wave-c', 4);

      const ratings = getAllWaveRatings(db);
      expect(ratings).toHaveLength(3);
    });

    it('getAllWaveRatings returns empty array when no ratings exist', () => {
      const ratings = getAllWaveRatings(db);
      expect(ratings).toHaveLength(0);
    });
  });
});
