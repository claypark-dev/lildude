/**
 * API keys data access layer.
 * Provides CRUD operations for the api_keys table used by gateway auth.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level API key record. */
export interface ApiKeyRecord {
  id: string;
  label: string;
  keyHash: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Raw database row from the api_keys table. */
interface ApiKeyDbRow {
  id: string;
  label: string;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/**
 * Hash an API key using SHA-256.
 * @param key - The raw API key to hash.
 * @returns The hex-encoded SHA-256 hash.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key with a `ld_` prefix for easy identification.
 * @returns A 35-character API key string (3 prefix + 32 random).
 */
export function generateApiKey(): string {
  return `ld_${nanoid(32)}`;
}

/**
 * Map a raw database row to an application-level ApiKeyRecord.
 */
function mapRow(row: ApiKeyDbRow): ApiKeyRecord {
  return {
    id: row.id,
    label: row.label,
    keyHash: row.key_hash,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * Store a new API key (hashed) in the database.
 * @param db - The better-sqlite3 Database instance.
 * @param key - The raw API key to store (will be hashed).
 * @param label - A human-readable label for the key.
 * @returns The created ApiKeyRecord.
 */
export function storeApiKey(
  db: BetterSqlite3.Database,
  key: string,
  label: string = 'default',
): ApiKeyRecord {
  try {
    const id = nanoid();
    const keyHash = hashApiKey(key);

    db.prepare(
      `INSERT INTO api_keys (id, label, key_hash) VALUES (?, ?, ?)`,
    ).run(id, label, keyHash);

    persistenceLogger.info({ label }, 'API key stored');

    const row = db.prepare(
      'SELECT * FROM api_keys WHERE id = ?',
    ).get(id) as ApiKeyDbRow;

    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to store API key: ${message}`);
  }
}

/**
 * Find an active (non-revoked) API key by its hash.
 * @param db - The better-sqlite3 Database instance.
 * @param keyHash - The SHA-256 hash of the API key.
 * @returns The matching ApiKeyRecord, or undefined if not found.
 */
export function findApiKeyByHash(
  db: BetterSqlite3.Database,
  keyHash: string,
): ApiKeyRecord | undefined {
  try {
    const row = db.prepare(
      'SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
    ).get(keyHash) as ApiKeyDbRow | undefined;

    return row ? mapRow(row) : undefined;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to find API key: ${message}`);
  }
}

/**
 * Update the last_used_at timestamp for an API key.
 * @param db - The better-sqlite3 Database instance.
 * @param id - The API key record ID.
 */
export function touchApiKey(db: BetterSqlite3.Database, id: string): void {
  try {
    db.prepare(
      'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(id);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to touch API key: ${message}`);
  }
}

/**
 * Revoke an API key by setting its revoked_at timestamp.
 * @param db - The better-sqlite3 Database instance.
 * @param id - The API key record ID.
 * @returns True if the key was revoked, false if not found.
 */
export function revokeApiKey(db: BetterSqlite3.Database, id: string): boolean {
  try {
    const result = db.prepare(
      'UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL',
    ).run(id);

    if (result.changes > 0) {
      persistenceLogger.info({ id }, 'API key revoked');
    }

    return result.changes > 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to revoke API key: ${message}`);
  }
}

/**
 * List all API keys (excluding the raw key hash for security).
 * @param db - The better-sqlite3 Database instance.
 * @returns An array of ApiKeyRecord objects.
 */
export function listApiKeys(db: BetterSqlite3.Database): ApiKeyRecord[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM api_keys ORDER BY created_at DESC',
    ).all() as ApiKeyDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list API keys: ${message}`);
  }
}

/**
 * Get or create the default API key.
 * If no 'default' key exists, generates one, stores it, and returns the raw key.
 * If one already exists, returns undefined (the raw key is not retrievable after creation).
 * @param db - The better-sqlite3 Database instance.
 * @returns The raw API key if newly created, or undefined if already exists.
 */
export function ensureDefaultApiKey(db: BetterSqlite3.Database): string | undefined {
  try {
    const existing = db.prepare(
      "SELECT id FROM api_keys WHERE label = 'default' AND revoked_at IS NULL",
    ).get() as { id: string } | undefined;

    if (existing) {
      return undefined;
    }

    // Remove any revoked default key to avoid UNIQUE constraint violation
    db.prepare(
      "DELETE FROM api_keys WHERE label = 'default' AND revoked_at IS NOT NULL",
    ).run();

    const rawKey = generateApiKey();
    storeApiKey(db, rawKey, 'default');
    persistenceLogger.info('Default API key generated');
    return rawKey;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to ensure default API key: ${message}`);
  }
}
