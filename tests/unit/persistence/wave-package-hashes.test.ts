import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  storePackageHash,
  getPackageHash,
  verifyPackageHash,
  deletePackageHash,
} from '../../../src/persistence/wave-package-hashes.js';

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

describe('wave-package-hashes', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('storePackageHash', () => {
    it('stores a new hash', () => {
      storePackageHash(db, 'my-wave', '1.0.0', 'abc123');
      const entry = getPackageHash(db, 'my-wave');
      expect(entry).not.toBeNull();
      expect(entry!.waveName).toBe('my-wave');
      expect(entry!.version).toBe('1.0.0');
      expect(entry!.packageHash).toBe('abc123');
    });

    it('updates existing hash', () => {
      storePackageHash(db, 'my-wave', '1.0.0', 'old-hash');
      storePackageHash(db, 'my-wave', '1.1.0', 'new-hash');

      const entry = getPackageHash(db, 'my-wave');
      expect(entry!.version).toBe('1.1.0');
      expect(entry!.packageHash).toBe('new-hash');
    });
  });

  describe('getPackageHash', () => {
    it('returns null for nonexistent wave', () => {
      expect(getPackageHash(db, 'nonexistent')).toBeNull();
    });
  });

  describe('verifyPackageHash', () => {
    it('returns true for matching hash', () => {
      storePackageHash(db, 'my-wave', '1.0.0', 'correct-hash');
      expect(verifyPackageHash(db, 'my-wave', 'correct-hash')).toBe(true);
    });

    it('returns false for non-matching hash', () => {
      storePackageHash(db, 'my-wave', '1.0.0', 'correct-hash');
      expect(verifyPackageHash(db, 'my-wave', 'wrong-hash')).toBe(false);
    });

    it('returns null when no stored hash exists', () => {
      expect(verifyPackageHash(db, 'unknown', 'any-hash')).toBeNull();
    });
  });

  describe('deletePackageHash', () => {
    it('removes a stored hash', () => {
      storePackageHash(db, 'my-wave', '1.0.0', 'abc');
      deletePackageHash(db, 'my-wave');
      expect(getPackageHash(db, 'my-wave')).toBeNull();
    });

    it('does not throw for nonexistent wave', () => {
      expect(() => deletePackageHash(db, 'nonexistent')).not.toThrow();
    });
  });
});
