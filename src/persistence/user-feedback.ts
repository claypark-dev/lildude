/**
 * User feedback data access layer.
 * Provides functions to record thumbs up/down feedback,
 * query feedback by task/model, and aggregate feedback stats.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Input for recording user feedback. */
export interface RecordFeedbackInput {
  taskId: string;
  conversationId?: string;
  rating: -1 | 1;
  comment?: string;
  model?: string;
  provider?: string;
  waveName?: string;
}

/** A single user feedback entry from the database. */
export interface UserFeedbackEntry {
  id: number;
  taskId: string;
  conversationId: string | null;
  rating: -1 | 1;
  comment: string | null;
  model: string | null;
  provider: string | null;
  waveName: string | null;
  createdAt: string;
}

/** Aggregated feedback stats for a model or wave. */
export interface FeedbackStats {
  totalCount: number;
  positiveCount: number;
  negativeCount: number;
  positiveRate: number;
}

/** Raw row shape from the user_feedback table. */
interface FeedbackDbRow {
  id: number;
  task_id: string;
  conversation_id: string | null;
  rating: number;
  comment: string | null;
  model: string | null;
  provider: string | null;
  wave_name: string | null;
  created_at: string;
}

/**
 * Record thumbs up/down feedback for a completed task.
 * @param db - The database instance.
 * @param input - The feedback data to store.
 * @returns The inserted feedback ID.
 */
export function recordFeedback(
  db: BetterSqlite3.Database,
  input: RecordFeedbackInput,
): number {
  try {
    const stmt = db.prepare(`
      INSERT INTO user_feedback (task_id, conversation_id, rating, comment, model, provider, wave_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      input.taskId,
      input.conversationId ?? null,
      input.rating,
      input.comment ?? null,
      input.model ?? null,
      input.provider ?? null,
      input.waveName ?? null,
    );

    persistenceLogger.debug(
      { taskId: input.taskId, rating: input.rating },
      'User feedback recorded',
    );

    return Number(result.lastInsertRowid);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to record feedback: ${message}`);
  }
}

/**
 * Get feedback for a specific task.
 * @param db - The database instance.
 * @param taskId - The task ID to look up.
 * @returns The feedback entry, or null if none exists.
 */
export function getFeedbackByTask(
  db: BetterSqlite3.Database,
  taskId: string,
): UserFeedbackEntry | null {
  try {
    const row = db.prepare(
      'SELECT * FROM user_feedback WHERE task_id = ? ORDER BY id DESC LIMIT 1',
    ).get(taskId) as FeedbackDbRow | undefined;

    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get feedback: ${message}`);
  }
}

/**
 * Get aggregated feedback stats for a model.
 * @param db - The database instance.
 * @param model - The model name to query.
 * @returns Aggregated stats with positive rate.
 */
export function getModelFeedbackStats(
  db: BetterSqlite3.Database,
  model: string,
): FeedbackStats {
  try {
    const row = db.prepare(`
      SELECT
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0) as positive_count,
        COALESCE(SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END), 0) as negative_count
      FROM user_feedback
      WHERE model = ?
    `).get(model) as { total_count: number; positive_count: number; negative_count: number };

    const totalCount = row.total_count;
    const positiveCount = row.positive_count;
    const negativeCount = row.negative_count;

    return {
      totalCount,
      positiveCount,
      negativeCount,
      positiveRate: totalCount > 0 ? positiveCount / totalCount : 0,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get model feedback stats: ${message}`);
  }
}

/**
 * Get aggregated feedback stats for a wave.
 * @param db - The database instance.
 * @param waveName - The wave name to query.
 * @returns Aggregated stats with positive rate.
 */
export function getWaveFeedbackStats(
  db: BetterSqlite3.Database,
  waveName: string,
): FeedbackStats {
  try {
    const row = db.prepare(`
      SELECT
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0) as positive_count,
        COALESCE(SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END), 0) as negative_count
      FROM user_feedback
      WHERE wave_name = ?
    `).get(waveName) as { total_count: number; positive_count: number; negative_count: number };

    const totalCount = row.total_count;
    const positiveCount = row.positive_count;
    const negativeCount = row.negative_count;

    return {
      totalCount,
      positiveCount,
      negativeCount,
      positiveRate: totalCount > 0 ? positiveCount / totalCount : 0,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get wave feedback stats: ${message}`);
  }
}

/**
 * Get feedback counts for a date range (for learning journal).
 * @param db - The database instance.
 * @param date - The date string (YYYY-MM-DD).
 * @returns Positive and negative counts for the day.
 */
export function getDailyFeedbackCounts(
  db: BetterSqlite3.Database,
  date: string,
): { positiveCount: number; negativeCount: number } {
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0) as positive_count,
        COALESCE(SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END), 0) as negative_count
      FROM user_feedback
      WHERE DATE(created_at) = ?
    `).get(date) as { positive_count: number | null; negative_count: number | null };

    return {
      positiveCount: row.positive_count ?? 0,
      negativeCount: row.negative_count ?? 0,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get daily feedback counts: ${message}`);
  }
}

/** Map a raw DB row to a typed UserFeedbackEntry. */
function mapRow(row: FeedbackDbRow): UserFeedbackEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    conversationId: row.conversation_id,
    rating: row.rating as -1 | 1,
    comment: row.comment,
    model: row.model,
    provider: row.provider,
    waveName: row.wave_name,
    createdAt: row.created_at,
  };
}
