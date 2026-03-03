/**
 * Wave install counts DAL.
 * Tracks how many times each wave has been installed locally.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level install count entry. */
export interface WaveInstallCount {
  waveName: string;
  installCount: number;
  firstInstalledAt: Date;
  lastInstalledAt: Date;
}

/** Raw DB row. */
interface InstallCountDbRow {
  wave_name: string;
  install_count: number;
  first_installed_at: string;
  last_installed_at: string;
}

/**
 * Map a raw DB row to an application-level WaveInstallCount.
 * @param row - The raw database row.
 * @returns The mapped WaveInstallCount.
 */
function mapRow(row: InstallCountDbRow): WaveInstallCount {
  return {
    waveName: row.wave_name,
    installCount: row.install_count,
    firstInstalledAt: new Date(row.first_installed_at),
    lastInstalledAt: new Date(row.last_installed_at),
  };
}

/**
 * Increment the install count for a wave.
 * Creates a new record if none exists.
 * @param db - Database connection.
 * @param waveName - The wave name.
 */
export function incrementInstallCount(
  db: BetterSqlite3.Database,
  waveName: string,
): void {
  try {
    const existing = db.prepare(
      'SELECT wave_name FROM wave_install_counts WHERE wave_name = ?',
    ).get(waveName) as { wave_name: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE wave_install_counts
         SET install_count = install_count + 1, last_installed_at = datetime('now')
         WHERE wave_name = ?`,
      ).run(waveName);
    } else {
      db.prepare(
        `INSERT INTO wave_install_counts (wave_name, install_count)
         VALUES (?, 1)`,
      ).run(waveName);
    }

    persistenceLogger.debug({ waveName }, 'Install count incremented');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to increment install count: ${message}`);
  }
}

/**
 * Get the install count for a wave.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @returns The install count, or 0 if not tracked.
 */
export function getInstallCount(
  db: BetterSqlite3.Database,
  waveName: string,
): number {
  try {
    const row = db.prepare(
      'SELECT install_count FROM wave_install_counts WHERE wave_name = ?',
    ).get(waveName) as { install_count: number } | undefined;
    return row?.install_count ?? 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get install count: ${message}`);
  }
}

/**
 * Get the top installed waves by count.
 * @param db - Database connection.
 * @param limit - Maximum results (default 10).
 * @returns Array of install count entries, sorted by count descending.
 */
export function getTopInstalled(
  db: BetterSqlite3.Database,
  limit: number = 10,
): WaveInstallCount[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM wave_install_counts ORDER BY install_count DESC LIMIT ?',
    ).all(limit) as InstallCountDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get top installed waves: ${message}`);
  }
}

/**
 * Get install count for a specific wave.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @returns The full install count entry, or null if not tracked.
 */
export function getInstallCountEntry(
  db: BetterSqlite3.Database,
  waveName: string,
): WaveInstallCount | null {
  try {
    const row = db.prepare(
      'SELECT * FROM wave_install_counts WHERE wave_name = ?',
    ).get(waveName) as InstallCountDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get install count entry: ${message}`);
  }
}
