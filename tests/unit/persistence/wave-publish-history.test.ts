import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  recordPublish,
  updatePublishStatus,
  getPublishHistory,
  listPublishHistory,
} from '../../../src/persistence/wave-publish-history.js';

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

describe('wave-publish-history', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('recordPublish', () => {
    it('records a publish attempt with PR info', () => {
      const entry = recordPublish(db, 'my-wave', '1.0.0', 'https://github.com/pr/1', 1);
      expect(entry.waveName).toBe('my-wave');
      expect(entry.version).toBe('1.0.0');
      expect(entry.prUrl).toBe('https://github.com/pr/1');
      expect(entry.prNumber).toBe(1);
      expect(entry.status).toBe('pending');
      expect(entry.id).toMatch(/^pub_/);
    });

    it('records a publish attempt without PR (dry run)', () => {
      const entry = recordPublish(db, 'my-wave', '1.0.0', null, null);
      expect(entry.prUrl).toBeNull();
      expect(entry.prNumber).toBeNull();
    });
  });

  describe('updatePublishStatus', () => {
    it('updates the status of a publish entry', () => {
      const entry = recordPublish(db, 'my-wave', '1.0.0', 'https://pr', 1);
      updatePublishStatus(db, entry.id, 'merged');

      const history = getPublishHistory(db, 'my-wave');
      expect(history[0].status).toBe('merged');
    });
  });

  describe('getPublishHistory', () => {
    it('returns entries for a specific wave', () => {
      recordPublish(db, 'wave-a', '1.0.0', null, null);
      recordPublish(db, 'wave-b', '1.0.0', null, null);
      recordPublish(db, 'wave-a', '1.1.0', null, null);

      const history = getPublishHistory(db, 'wave-a');
      expect(history.length).toBe(2);
      expect(history.every((e) => e.waveName === 'wave-a')).toBe(true);
    });

    it('returns empty array for unknown wave', () => {
      expect(getPublishHistory(db, 'unknown')).toEqual([]);
    });
  });

  describe('listPublishHistory', () => {
    it('returns all entries ordered by date descending', () => {
      recordPublish(db, 'wave-a', '1.0.0', null, null);
      recordPublish(db, 'wave-b', '1.0.0', null, null);

      const all = listPublishHistory(db);
      expect(all.length).toBe(2);
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        recordPublish(db, `wave-${i}`, '1.0.0', null, null);
      }
      expect(listPublishHistory(db, 3).length).toBe(3);
    });
  });
});
