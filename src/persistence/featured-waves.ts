/**
 * Featured waves DAL.
 * Manages which waves are highlighted/featured in the Waves Hub.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level featured wave entry. */
export interface FeaturedWave {
  waveName: string;
  featuredAt: Date;
  reason: string | null;
}

/** Raw DB row. */
interface FeaturedWaveDbRow {
  wave_name: string;
  featured_at: string;
  reason: string | null;
}

/**
 * Map a raw DB row to an application-level FeaturedWave.
 * @param row - The raw database row.
 * @returns The mapped FeaturedWave.
 */
function mapRow(row: FeaturedWaveDbRow): FeaturedWave {
  return {
    waveName: row.wave_name,
    featuredAt: new Date(row.featured_at),
    reason: row.reason,
  };
}

/**
 * Feature a wave in the hub.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @param reason - Optional reason for featuring.
 */
export function featureWave(
  db: BetterSqlite3.Database,
  waveName: string,
  reason?: string,
): void {
  try {
    db.prepare(
      `INSERT OR REPLACE INTO featured_waves (wave_name, featured_at, reason)
       VALUES (?, datetime('now'), ?)`,
    ).run(waveName, reason || null);

    persistenceLogger.debug({ waveName }, 'Wave featured');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to feature wave: ${message}`);
  }
}

/**
 * Remove a wave from featured list.
 * @param db - Database connection.
 * @param waveName - The wave name.
 */
export function unfeatureWave(
  db: BetterSqlite3.Database,
  waveName: string,
): void {
  try {
    db.prepare('DELETE FROM featured_waves WHERE wave_name = ?').run(waveName);
    persistenceLogger.debug({ waveName }, 'Wave unfeatured');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to unfeature wave: ${message}`);
  }
}

/**
 * Get all featured waves.
 * @param db - Database connection.
 * @returns Array of featured wave entries, most recently featured first.
 */
export function getFeaturedWaves(
  db: BetterSqlite3.Database,
): FeaturedWave[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM featured_waves ORDER BY featured_at DESC',
    ).all() as FeaturedWaveDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get featured waves: ${message}`);
  }
}

/**
 * Check if a wave is featured.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @returns True if the wave is featured.
 */
export function isWaveFeatured(
  db: BetterSqlite3.Database,
  waveName: string,
): boolean {
  try {
    const row = db.prepare(
      'SELECT wave_name FROM featured_waves WHERE wave_name = ?',
    ).get(waveName) as { wave_name: string } | undefined;
    return !!row;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to check if wave is featured: ${message}`);
  }
}
