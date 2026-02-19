import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import {
  setConfigValue,
  getConfigValue,
  deleteConfigValue,
  getAllConfig,
} from '../../../src/persistence/config-store.js';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

describe('config-store', () => {
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

  it('setConfigValue stores a value', () => {
    setConfigValue(manager.db, 'theme', 'dark');

    const row = manager.db
      .prepare('SELECT value FROM config_store WHERE key = ?')
      .get('theme') as { value: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.value).toBe('dark');
  });

  it('getConfigValue retrieves the stored value', () => {
    setConfigValue(manager.db, 'language', 'en');

    const value = getConfigValue(manager.db, 'language');

    expect(value).toBe('en');
  });

  it('getConfigValue returns undefined for missing key', () => {
    const value = getConfigValue(manager.db, 'nonexistent');

    expect(value).toBeUndefined();
  });

  it('setConfigValue updates existing key (upsert)', () => {
    setConfigValue(manager.db, 'color', 'blue');
    setConfigValue(manager.db, 'color', 'red');

    const value = getConfigValue(manager.db, 'color');

    expect(value).toBe('red');
  });

  it('deleteConfigValue removes a value', () => {
    setConfigValue(manager.db, 'toDelete', 'bye');

    const deleted = deleteConfigValue(manager.db, 'toDelete');

    expect(deleted).toBe(true);
    expect(getConfigValue(manager.db, 'toDelete')).toBeUndefined();
  });

  it('deleteConfigValue returns false for missing key', () => {
    const deleted = deleteConfigValue(manager.db, 'nonexistent');

    expect(deleted).toBe(false);
  });

  it('getAllConfig returns all key-value pairs', () => {
    setConfigValue(manager.db, 'alpha', '1');
    setConfigValue(manager.db, 'beta', '2');
    setConfigValue(manager.db, 'gamma', '3');

    const configs = getAllConfig(manager.db);

    expect(configs).toHaveLength(3);

    const keys = configs.map((c) => c.key);
    expect(keys).toContain('alpha');
    expect(keys).toContain('beta');
    expect(keys).toContain('gamma');

    for (const config of configs) {
      expect(config.key).toBeDefined();
      expect(config.value).toBeDefined();
      expect(config.updatedAt).toBeDefined();
    }
  });
});
