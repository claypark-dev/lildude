import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  upsertTrustScore,
  getTrustScore,
  getTrustScoresBatch,
  listTrustScores,
  deleteTrustScore,
} from '../../../src/persistence/wave-community-trust.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  const migrationSql = readFileSync(
    join(__dirname, '../../../src/persistence/migrations/018_community_publishing.sql'),
    'utf-8',
  );
  db.exec(migrationSql);
  return db;
}

describe('wave-community-trust', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('upsertTrustScore', () => {
    it('creates a new trust score entry', () => {
      upsertTrustScore(db, {
        waveName: 'test-wave',
        trustScore: 75,
        trustTier: 'community',
        scanPassed: true,
        sandboxPassed: true,
        highFindings: 1,
        criticalFindings: 0,
      });

      const entry = getTrustScore(db, 'test-wave');
      expect(entry).not.toBeNull();
      expect(entry!.trustScore).toBe(75);
      expect(entry!.trustTier).toBe('community');
      expect(entry!.scanPassed).toBe(true);
      expect(entry!.sandboxPassed).toBe(true);
      expect(entry!.highFindings).toBe(1);
      expect(entry!.criticalFindings).toBe(0);
    });

    it('updates an existing trust score', () => {
      upsertTrustScore(db, {
        waveName: 'test-wave',
        trustScore: 30,
        trustTier: 'new',
        scanPassed: true,
        sandboxPassed: false,
        highFindings: 0,
        criticalFindings: 0,
      });

      upsertTrustScore(db, {
        waveName: 'test-wave',
        trustScore: 85,
        trustTier: 'trusted',
        scanPassed: true,
        sandboxPassed: true,
        highFindings: 0,
        criticalFindings: 0,
      });

      const entry = getTrustScore(db, 'test-wave');
      expect(entry!.trustScore).toBe(85);
      expect(entry!.trustTier).toBe('trusted');
    });
  });

  describe('getTrustScore', () => {
    it('returns null for nonexistent wave', () => {
      expect(getTrustScore(db, 'nonexistent')).toBeNull();
    });
  });

  describe('getTrustScoresBatch', () => {
    it('returns scores for multiple waves', () => {
      upsertTrustScore(db, {
        waveName: 'wave-a',
        trustScore: 90,
        trustTier: 'trusted',
        scanPassed: true,
        sandboxPassed: true,
        highFindings: 0,
        criticalFindings: 0,
      });
      upsertTrustScore(db, {
        waveName: 'wave-b',
        trustScore: 40,
        trustTier: 'new',
        scanPassed: true,
        sandboxPassed: false,
        highFindings: 2,
        criticalFindings: 0,
      });

      const batch = getTrustScoresBatch(db, ['wave-a', 'wave-b', 'wave-c']);
      expect(batch.size).toBe(2);
      expect(batch.get('wave-a')!.trustScore).toBe(90);
      expect(batch.get('wave-b')!.trustScore).toBe(40);
      expect(batch.has('wave-c')).toBe(false);
    });

    it('returns empty map for empty input', () => {
      expect(getTrustScoresBatch(db, []).size).toBe(0);
    });
  });

  describe('listTrustScores', () => {
    it('returns scores ordered by score descending', () => {
      upsertTrustScore(db, {
        waveName: 'low',
        trustScore: 10,
        trustTier: 'unreviewed',
        scanPassed: false,
        sandboxPassed: false,
        highFindings: 0,
        criticalFindings: 0,
      });
      upsertTrustScore(db, {
        waveName: 'high',
        trustScore: 90,
        trustTier: 'trusted',
        scanPassed: true,
        sandboxPassed: true,
        highFindings: 0,
        criticalFindings: 0,
      });

      const scores = listTrustScores(db);
      expect(scores[0].waveName).toBe('high');
      expect(scores[1].waveName).toBe('low');
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        upsertTrustScore(db, {
          waveName: `wave-${i}`,
          trustScore: i * 20,
          trustTier: 'new',
          scanPassed: true,
          sandboxPassed: true,
          highFindings: 0,
          criticalFindings: 0,
        });
      }
      expect(listTrustScores(db, 3).length).toBe(3);
    });
  });

  describe('deleteTrustScore', () => {
    it('removes a trust score entry', () => {
      upsertTrustScore(db, {
        waveName: 'delete-me',
        trustScore: 50,
        trustTier: 'community',
        scanPassed: true,
        sandboxPassed: true,
        highFindings: 0,
        criticalFindings: 0,
      });
      expect(getTrustScore(db, 'delete-me')).not.toBeNull();

      deleteTrustScore(db, 'delete-me');
      expect(getTrustScore(db, 'delete-me')).toBeNull();
    });

    it('does not throw for nonexistent wave', () => {
      expect(() => deleteTrustScore(db, 'nonexistent')).not.toThrow();
    });
  });
});
