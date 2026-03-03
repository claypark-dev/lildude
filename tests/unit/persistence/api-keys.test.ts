import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import {
  generateApiKey,
  hashApiKey,
  storeApiKey,
  findApiKeyByHash,
  touchApiKey,
  revokeApiKey,
  listApiKeys,
  ensureDefaultApiKey,
} from '../../../src/persistence/api-keys.js';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

describe('api-keys', () => {
  let manager: DatabaseManager;

  beforeEach(() => {
    manager = createTestDb();
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {
      // best-effort cleanup
    }
  });

  describe('generateApiKey', () => {
    it('generates a key with ld_ prefix', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^ld_/);
    });

    it('generates 35-character keys', () => {
      const key = generateApiKey();
      expect(key.length).toBe(35); // 3 prefix + 32 random
    });

    it('generates unique keys', () => {
      const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
      expect(keys.size).toBe(100);
    });
  });

  describe('hashApiKey', () => {
    it('returns consistent hash for same input', () => {
      const key = 'ld_test123';
      expect(hashApiKey(key)).toBe(hashApiKey(key));
    });

    it('returns different hashes for different inputs', () => {
      expect(hashApiKey('key_a')).not.toBe(hashApiKey('key_b'));
    });

    it('returns a 64-char hex string (SHA-256)', () => {
      const hash = hashApiKey('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('storeApiKey', () => {
    it('stores a key and returns a record', () => {
      const record = storeApiKey(manager.db, 'ld_testkey', 'my-label');

      expect(record.id).toBeDefined();
      expect(record.label).toBe('my-label');
      expect(record.keyHash).toBe(hashApiKey('ld_testkey'));
      expect(record.createdAt).toBeDefined();
      expect(record.revokedAt).toBeNull();
    });

    it('uses default label when not specified', () => {
      const record = storeApiKey(manager.db, 'ld_testkey');

      expect(record.label).toBe('default');
    });

    it('rejects duplicate labels', () => {
      storeApiKey(manager.db, 'ld_key1', 'unique-label');

      expect(() => {
        storeApiKey(manager.db, 'ld_key2', 'unique-label');
      }).toThrow();
    });
  });

  describe('findApiKeyByHash', () => {
    it('finds an active key by hash', () => {
      const rawKey = 'ld_findme';
      storeApiKey(manager.db, rawKey, 'find-test');

      const found = findApiKeyByHash(manager.db, hashApiKey(rawKey));

      expect(found).toBeDefined();
      expect(found!.label).toBe('find-test');
    });

    it('returns undefined for unknown hash', () => {
      const found = findApiKeyByHash(manager.db, hashApiKey('nonexistent'));

      expect(found).toBeUndefined();
    });

    it('does not find revoked keys', () => {
      const rawKey = 'ld_revokeme';
      const record = storeApiKey(manager.db, rawKey, 'revoke-test');
      revokeApiKey(manager.db, record.id);

      const found = findApiKeyByHash(manager.db, hashApiKey(rawKey));

      expect(found).toBeUndefined();
    });
  });

  describe('touchApiKey', () => {
    it('updates last_used_at timestamp', () => {
      const record = storeApiKey(manager.db, 'ld_touchme', 'touch-test');

      expect(record.lastUsedAt).toBeNull();

      touchApiKey(manager.db, record.id);

      const updated = findApiKeyByHash(manager.db, hashApiKey('ld_touchme'));
      expect(updated).toBeDefined();
      expect(updated!.lastUsedAt).not.toBeNull();
    });
  });

  describe('revokeApiKey', () => {
    it('revokes an active key', () => {
      const record = storeApiKey(manager.db, 'ld_revoke', 'revoke-test2');

      const result = revokeApiKey(manager.db, record.id);

      expect(result).toBe(true);
    });

    it('returns false for already-revoked key', () => {
      const record = storeApiKey(manager.db, 'ld_double', 'double-revoke');
      revokeApiKey(manager.db, record.id);

      const result = revokeApiKey(manager.db, record.id);

      expect(result).toBe(false);
    });

    it('returns false for nonexistent key', () => {
      const result = revokeApiKey(manager.db, 'nonexistent-id');

      expect(result).toBe(false);
    });
  });

  describe('listApiKeys', () => {
    it('returns all keys', () => {
      storeApiKey(manager.db, 'ld_a', 'label-a');
      storeApiKey(manager.db, 'ld_b', 'label-b');
      storeApiKey(manager.db, 'ld_c', 'label-c');

      const keys = listApiKeys(manager.db);

      expect(keys).toHaveLength(3);
    });

    it('returns empty array when no keys exist', () => {
      const keys = listApiKeys(manager.db);

      expect(keys).toHaveLength(0);
    });

    it('includes revoked keys', () => {
      const record = storeApiKey(manager.db, 'ld_revoked', 'revoked-list');
      revokeApiKey(manager.db, record.id);

      const keys = listApiKeys(manager.db);

      expect(keys).toHaveLength(1);
      expect(keys[0].revokedAt).not.toBeNull();
    });
  });

  describe('ensureDefaultApiKey', () => {
    it('creates a default key on first call', () => {
      const rawKey = ensureDefaultApiKey(manager.db);

      expect(rawKey).toBeDefined();
      expect(rawKey).toMatch(/^ld_/);
    });

    it('returns undefined on subsequent calls', () => {
      ensureDefaultApiKey(manager.db);
      const secondCall = ensureDefaultApiKey(manager.db);

      expect(secondCall).toBeUndefined();
    });

    it('created key is findable by hash', () => {
      const rawKey = ensureDefaultApiKey(manager.db);

      expect(rawKey).toBeDefined();
      const found = findApiKeyByHash(manager.db, hashApiKey(rawKey!));
      expect(found).toBeDefined();
      expect(found!.label).toBe('default');
    });

    it('creates new key after default is revoked', () => {
      const firstKey = ensureDefaultApiKey(manager.db);
      expect(firstKey).toBeDefined();

      // Revoke the default key
      const keys = listApiKeys(manager.db);
      const defaultKey = keys.find((k) => k.label === 'default');
      expect(defaultKey).toBeDefined();
      revokeApiKey(manager.db, defaultKey!.id);

      // Should create a new default key
      const secondKey = ensureDefaultApiKey(manager.db);
      expect(secondKey).toBeDefined();
      expect(secondKey).not.toBe(firstKey);
    });
  });
});
