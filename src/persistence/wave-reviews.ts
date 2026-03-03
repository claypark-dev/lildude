/**
 * Wave reviews DAL.
 * Manages multi-review rating system for the Waves Hub.
 * Unlike wave-hub-cache.ts single ratings, this supports multiple reviews per wave.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level wave review. */
export interface WaveReview {
  id: string;
  waveName: string;
  rating: number;
  comment: string | null;
  reviewer: string;
  createdAt: Date;
}

/** Input for creating a wave review. */
export interface CreateWaveReviewInput {
  waveName: string;
  rating: number;
  comment?: string;
  reviewer?: string;
}

/** Aggregate rating info for a wave. */
export interface WaveRatingAggregate {
  waveName: string;
  averageRating: number;
  ratingCount: number;
}

/** Raw DB row. */
interface WaveReviewDbRow {
  id: string;
  wave_name: string;
  rating: number;
  comment: string | null;
  reviewer: string;
  created_at: string;
}

/**
 * Map a raw DB row to an application-level WaveReview.
 * @param row - The raw database row.
 * @returns The mapped WaveReview.
 */
function mapRow(row: WaveReviewDbRow): WaveReview {
  return {
    id: row.id,
    waveName: row.wave_name,
    rating: row.rating,
    comment: row.comment,
    reviewer: row.reviewer,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Add a review for a wave.
 * @param db - Database connection.
 * @param input - Review details.
 * @returns The created review.
 */
export function addReview(
  db: BetterSqlite3.Database,
  input: CreateWaveReviewInput,
): WaveReview {
  try {
    if (input.rating < 1 || input.rating > 5 || !Number.isInteger(input.rating)) {
      throw new PersistenceError('Rating must be an integer between 1 and 5');
    }

    const id = `rev_${nanoid()}`;
    db.prepare(
      `INSERT INTO wave_reviews (id, wave_name, rating, comment, reviewer)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.waveName,
      input.rating,
      input.comment || null,
      input.reviewer || 'owner',
    );

    persistenceLogger.debug({ reviewId: id, waveName: input.waveName }, 'Wave review added');

    const row = db.prepare('SELECT * FROM wave_reviews WHERE id = ?').get(id) as WaveReviewDbRow;
    return mapRow(row);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to add wave review: ${message}`);
  }
}

/**
 * Get all reviews for a wave.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @param limit - Maximum results (default 50).
 * @returns Array of reviews, most recent first.
 */
export function getReviews(
  db: BetterSqlite3.Database,
  waveName: string,
  limit: number = 50,
): WaveReview[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM wave_reviews WHERE wave_name = ? ORDER BY created_at DESC LIMIT ?',
    ).all(waveName, limit) as WaveReviewDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get wave reviews: ${message}`);
  }
}

/**
 * Get the average rating for a wave.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @returns Aggregate rating info, or null if no reviews exist.
 */
export function getAverageRating(
  db: BetterSqlite3.Database,
  waveName: string,
): WaveRatingAggregate | null {
  try {
    const row = db.prepare(
      `SELECT wave_name, AVG(rating) AS avg_rating, COUNT(*) AS count
       FROM wave_reviews WHERE wave_name = ? GROUP BY wave_name`,
    ).get(waveName) as { wave_name: string; avg_rating: number; count: number } | undefined;

    if (!row) return null;

    return {
      waveName: row.wave_name,
      averageRating: Math.round(row.avg_rating * 10) / 10,
      ratingCount: row.count,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get average rating: ${message}`);
  }
}

/**
 * Get aggregate ratings for all reviewed waves.
 * @param db - Database connection.
 * @returns Array of aggregate rating info.
 */
export function getAllAverageRatings(
  db: BetterSqlite3.Database,
): WaveRatingAggregate[] {
  try {
    const rows = db.prepare(
      `SELECT wave_name, AVG(rating) AS avg_rating, COUNT(*) AS count
       FROM wave_reviews GROUP BY wave_name ORDER BY avg_rating DESC`,
    ).all() as Array<{ wave_name: string; avg_rating: number; count: number }>;

    return rows.map((row) => ({
      waveName: row.wave_name,
      averageRating: Math.round(row.avg_rating * 10) / 10,
      ratingCount: row.count,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get all average ratings: ${message}`);
  }
}
