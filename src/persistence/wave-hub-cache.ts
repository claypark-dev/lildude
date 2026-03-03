/**
 * Wave Hub cache data access layer.
 * Stores and retrieves remote registry data with TTL-based invalidation.
 * Also manages wave ratings for installed waves.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** A cached registry entry. */
export interface CachedRegistry {
  registryUrl: string;
  data: string;
  etag: string | null;
  fetchedAt: string;
  expiresAt: string;
}

/** A wave rating entry. */
export interface WaveRating {
  waveName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

/**
 * Get a cached registry entry if it hasn't expired.
 *
 * @param db - The database instance.
 * @param registryUrl - The registry URL to look up.
 * @returns The cached data or null if expired/missing.
 */
export function getCachedRegistry(
  db: BetterSqlite3.Database,
  registryUrl: string,
): CachedRegistry | null {
  try {
    const row = db.prepare(`
      SELECT registry_url, data, etag, fetched_at, expires_at
      FROM wave_hub_cache
      WHERE registry_url = ? AND expires_at > datetime('now')
    `).get(registryUrl) as {
      registry_url: string;
      data: string;
      etag: string | null;
      fetched_at: string;
      expires_at: string;
    } | undefined;

    if (!row) return null;

    return {
      registryUrl: row.registry_url,
      data: row.data,
      etag: row.etag,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get cached registry: ${message}`);
  }
}

/**
 * Store or update a registry cache entry.
 *
 * @param db - The database instance.
 * @param registryUrl - The registry URL.
 * @param data - The JSON data to cache.
 * @param ttlHours - Cache TTL in hours (default 24).
 * @param etag - Optional ETag header for conditional fetching.
 */
export function setCachedRegistry(
  db: BetterSqlite3.Database,
  registryUrl: string,
  data: string,
  ttlHours = 24,
  etag?: string,
): void {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO wave_hub_cache (registry_url, data, etag, fetched_at, expires_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now', '+' || ? || ' hours'))
    `).run(registryUrl, data, etag ?? null, ttlHours);

    persistenceLogger.debug(
      { registryUrl, ttlHours },
      'Registry cache updated',
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to set cached registry: ${message}`);
  }
}

/**
 * Get the ETag for a cached registry entry (for conditional fetching).
 *
 * @param db - The database instance.
 * @param registryUrl - The registry URL.
 * @returns The ETag or null.
 */
export function getCachedEtag(
  db: BetterSqlite3.Database,
  registryUrl: string,
): string | null {
  try {
    const row = db.prepare(
      'SELECT etag FROM wave_hub_cache WHERE registry_url = ?',
    ).get(registryUrl) as { etag: string | null } | undefined;

    return row?.etag ?? null;
  } catch {
    return null;
  }
}

/**
 * Rate an installed wave (1-5 stars). Upserts per wave name.
 *
 * @param db - The database instance.
 * @param waveName - The wave name.
 * @param rating - Rating from 1 to 5.
 * @param comment - Optional comment.
 */
export function rateWave(
  db: BetterSqlite3.Database,
  waveName: string,
  rating: number,
  comment?: string,
): void {
  if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    throw new PersistenceError('Rating must be an integer between 1 and 5');
  }

  try {
    db.prepare(`
      INSERT INTO wave_ratings (wave_name, rating, comment)
      VALUES (?, ?, ?)
      ON CONFLICT(wave_name) DO UPDATE SET
        rating = excluded.rating,
        comment = excluded.comment,
        created_at = CURRENT_TIMESTAMP
    `).run(waveName, rating, comment ?? null);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to rate wave: ${message}`);
  }
}

/**
 * Get the rating for a wave.
 *
 * @param db - The database instance.
 * @param waveName - The wave name.
 * @returns The rating entry or null.
 */
export function getWaveRating(
  db: BetterSqlite3.Database,
  waveName: string,
): WaveRating | null {
  try {
    const row = db.prepare(
      'SELECT wave_name, rating, comment, created_at FROM wave_ratings WHERE wave_name = ?',
    ).get(waveName) as {
      wave_name: string;
      rating: number;
      comment: string | null;
      created_at: string;
    } | undefined;

    if (!row) return null;

    return {
      waveName: row.wave_name,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.created_at,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get wave rating: ${message}`);
  }
}

/**
 * Get all wave ratings.
 *
 * @param db - The database instance.
 * @returns All rating entries.
 */
export function getAllWaveRatings(
  db: BetterSqlite3.Database,
): WaveRating[] {
  try {
    const rows = db.prepare(
      'SELECT wave_name, rating, comment, created_at FROM wave_ratings ORDER BY created_at DESC',
    ).all() as Array<{
      wave_name: string;
      rating: number;
      comment: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      waveName: row.wave_name,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.created_at,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get wave ratings: ${message}`);
  }
}
