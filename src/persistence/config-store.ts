/**
 * Key-value configuration store DAL.
 * Provides CRUD operations for the config_store table.
 * All functions accept a better-sqlite3 Database instance for dependency injection.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

interface ConfigRow {
  key: string;
  value: string;
  updated_at: string;
}

/**
 * Set a config value (upsert).
 * Inserts a new key-value pair or replaces an existing one.
 * @param db - The better-sqlite3 Database instance.
 * @param key - The configuration key.
 * @param value - The configuration value.
 * @throws {PersistenceError} If the database operation fails.
 */
export function setConfigValue(db: BetterSqlite3.Database, key: string, value: string): void {
  try {
    db.prepare(
      `INSERT OR REPLACE INTO config_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
    ).run(key, value);

    persistenceLogger.debug({ key }, 'Config value set');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to set config value for key "${key}": ${message}`);
  }
}

/**
 * Get a config value by key.
 * @param db - The better-sqlite3 Database instance.
 * @param key - The configuration key to look up.
 * @returns The config value string, or undefined if the key does not exist.
 * @throws {PersistenceError} If the database operation fails.
 */
export function getConfigValue(db: BetterSqlite3.Database, key: string): string | undefined {
  try {
    const row = db.prepare(
      `SELECT value FROM config_store WHERE key = ?`,
    ).get(key) as ConfigRow | undefined;

    return row?.value;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get config value for key "${key}": ${message}`);
  }
}

/**
 * Delete a config value by key.
 * @param db - The better-sqlite3 Database instance.
 * @param key - The configuration key to delete.
 * @returns True if a row was deleted, false if the key did not exist.
 * @throws {PersistenceError} If the database operation fails.
 */
export function deleteConfigValue(db: BetterSqlite3.Database, key: string): boolean {
  try {
    const result = db.prepare(
      `DELETE FROM config_store WHERE key = ?`,
    ).run(key);

    const deleted = result.changes > 0;

    if (deleted) {
      persistenceLogger.debug({ key }, 'Config value deleted');
    }

    return deleted;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete config value for key "${key}": ${message}`);
  }
}

/**
 * Get all config key-value pairs.
 * @param db - The better-sqlite3 Database instance.
 * @returns An array of objects containing key, value, and updatedAt for each config entry.
 * @throws {PersistenceError} If the database operation fails.
 */
export function getAllConfig(
  db: BetterSqlite3.Database,
): Array<{ key: string; value: string; updatedAt: string }> {
  try {
    const rows = db.prepare(
      `SELECT key, value, updated_at FROM config_store ORDER BY key`,
    ).all() as ConfigRow[];

    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get all config values: ${message}`);
  }
}
