/**
 * Wave package hashes DAL.
 * Stores and verifies SHA-256 hashes for installed community waves.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level package hash entry. */
export interface PackageHashEntry {
  waveName: string;
  version: string;
  packageHash: string;
  verifiedAt: Date;
}

/** Raw DB row. */
interface HashDbRow {
  wave_name: string;
  version: string;
  package_hash: string;
  verified_at: string;
}

/**
 * Map a raw DB row to an application-level PackageHashEntry.
 * @param row - The raw database row.
 * @returns The mapped PackageHashEntry.
 */
function mapRow(row: HashDbRow): PackageHashEntry {
  return {
    waveName: row.wave_name,
    version: row.version,
    packageHash: row.package_hash,
    verifiedAt: new Date(row.verified_at),
  };
}

/**
 * Store a package hash for a wave.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @param version - The wave version.
 * @param packageHash - The SHA-256 hash of the package contents.
 */
export function storePackageHash(
  db: BetterSqlite3.Database,
  waveName: string,
  version: string,
  packageHash: string,
): void {
  try {
    db.prepare(
      `INSERT INTO wave_package_hashes (wave_name, version, package_hash, verified_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(wave_name) DO UPDATE SET
         version = excluded.version,
         package_hash = excluded.package_hash,
         verified_at = datetime('now')`,
    ).run(waveName, version, packageHash);

    persistenceLogger.debug({ waveName, version }, 'Package hash stored');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to store package hash: ${message}`);
  }
}

/**
 * Get the stored package hash for a wave.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @returns The hash entry, or null if not found.
 */
export function getPackageHash(
  db: BetterSqlite3.Database,
  waveName: string,
): PackageHashEntry | null {
  try {
    const row = db.prepare(
      'SELECT * FROM wave_package_hashes WHERE wave_name = ?',
    ).get(waveName) as HashDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get package hash: ${message}`);
  }
}

/**
 * Verify a wave's package hash against the stored value.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @param hash - The hash to verify.
 * @returns true if the hash matches, false if mismatch, null if no stored hash.
 */
export function verifyPackageHash(
  db: BetterSqlite3.Database,
  waveName: string,
  hash: string,
): boolean | null {
  try {
    const entry = getPackageHash(db, waveName);
    if (!entry) return null;
    return entry.packageHash === hash;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to verify package hash: ${message}`);
  }
}

/**
 * Delete a stored package hash.
 * @param db - Database connection.
 * @param waveName - The wave name.
 */
export function deletePackageHash(
  db: BetterSqlite3.Database,
  waveName: string,
): void {
  try {
    db.prepare('DELETE FROM wave_package_hashes WHERE wave_name = ?').run(waveName);
    persistenceLogger.debug({ waveName }, 'Package hash deleted');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete package hash: ${message}`);
  }
}
