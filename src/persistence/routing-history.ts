/**
 * Routing history data access layer.
 * Provides functions to record routing decisions, quality feedback,
 * and query model quality statistics for quality-aware routing.
 * See S3.R.2 for details.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Input for recording a routing decision. */
export interface RecordRoutingInput {
  taskId: string;
  model: string;
  provider: string;
  tier: string;
  taskType?: string;
  inputLength?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** A single routing history row from the database. */
export interface RoutingHistoryEntry {
  id: number;
  taskId: string;
  model: string;
  provider: string;
  tier: string;
  taskType: string;
  qualityScore: number | null;
  feedback: string | null;
  inputLength: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

/** Quality statistics for a model. */
export interface ModelQualityStats {
  model: string;
  avgScore: number;
  ratingCount: number;
  taskType: string | null;
}

/** Raw row shape from the routing_history table. */
interface RoutingHistoryDbRow {
  id: number;
  task_id: string;
  model: string;
  provider: string;
  tier: string;
  task_type: string;
  quality_score: number | null;
  feedback: string | null;
  input_length: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

/** Raw row shape for quality statistics queries. */
interface QualityStatsDbRow {
  model: string;
  avg_score: number;
  rating_count: number;
  task_type: string | null;
}

/**
 * Map a raw database row to the application-level RoutingHistoryEntry.
 * @param row - Raw SQLite row from the routing_history table.
 * @returns A typed RoutingHistoryEntry object.
 */
function mapRow(row: RoutingHistoryDbRow): RoutingHistoryEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    model: row.model,
    provider: row.provider,
    tier: row.tier,
    taskType: row.task_type,
    qualityScore: row.quality_score,
    feedback: row.feedback,
    inputLength: row.input_length,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}

/**
 * Record a new routing decision in the history table.
 * @param db - The better-sqlite3 Database instance.
 * @param input - The routing decision data to record.
 * @returns The newly created RoutingHistoryEntry.
 * @throws {PersistenceError} If the insert fails.
 */
export function recordRoutingDecision(
  db: BetterSqlite3.Database,
  input: RecordRoutingInput,
): RoutingHistoryEntry {
  try {
    const insertResult = db.prepare(
      `INSERT INTO routing_history (task_id, model, provider, tier, task_type, input_length, output_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.taskId,
      input.model,
      input.provider,
      input.tier,
      input.taskType ?? 'chat',
      input.inputLength ?? 0,
      input.outputTokens ?? 0,
      input.costUsd ?? 0,
    );

    persistenceLogger.debug({ taskId: input.taskId, model: input.model }, 'Routing decision recorded');

    const row = db.prepare(
      'SELECT * FROM routing_history WHERE id = ?',
    ).get(insertResult.lastInsertRowid) as RoutingHistoryDbRow;

    return mapRow(row);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to record routing decision: ${message}`);
  }
}

/**
 * Record quality feedback for a previously recorded routing decision.
 * Updates the quality_score and feedback fields for the entry matching the task ID.
 * @param db - The better-sqlite3 Database instance.
 * @param taskId - The task ID to update.
 * @param score - Quality score between 0.0 and 1.0.
 * @param feedback - Optional textual feedback.
 * @returns True if the entry was updated, false if no matching entry was found.
 * @throws {PersistenceError} If the update fails.
 */
export function recordQualityFeedback(
  db: BetterSqlite3.Database,
  taskId: string,
  score: number,
  feedback?: string,
): boolean {
  try {
    const updateResult = db.prepare(
      `UPDATE routing_history SET quality_score = ?, feedback = ? WHERE task_id = ?`,
    ).run(score, feedback ?? null, taskId);

    const updated = updateResult.changes > 0;

    if (updated) {
      persistenceLogger.debug({ taskId, score }, 'Quality feedback recorded');
    }

    return updated;
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to record quality feedback: ${message}`);
  }
}

/**
 * Get quality statistics for a specific model, optionally filtered by task type.
 * Only considers entries that have a non-null quality_score.
 * @param db - The better-sqlite3 Database instance.
 * @param model - The model identifier to query.
 * @param taskType - Optional task type filter.
 * @returns Quality statistics including average score and rating count.
 * @throws {PersistenceError} If the query fails.
 */
export function getModelQualityStats(
  db: BetterSqlite3.Database,
  model: string,
  taskType?: string,
): ModelQualityStats {
  try {
    let row: QualityStatsDbRow;

    if (taskType) {
      row = db.prepare(
        `SELECT model, AVG(quality_score) AS avg_score, COUNT(quality_score) AS rating_count, task_type
         FROM routing_history
         WHERE model = ? AND task_type = ? AND quality_score IS NOT NULL
         GROUP BY model, task_type`,
      ).get(model, taskType) as QualityStatsDbRow | undefined ?? {
        model,
        avg_score: 0,
        rating_count: 0,
        task_type: taskType,
      };
    } else {
      row = db.prepare(
        `SELECT model, AVG(quality_score) AS avg_score, COUNT(quality_score) AS rating_count, NULL AS task_type
         FROM routing_history
         WHERE model = ? AND quality_score IS NOT NULL
         GROUP BY model`,
      ).get(model) as QualityStatsDbRow | undefined ?? {
        model,
        avg_score: 0,
        rating_count: 0,
        task_type: null,
      };
    }

    return {
      model: row.model,
      avgScore: row.avg_score,
      ratingCount: row.rating_count,
      taskType: row.task_type,
    };
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get model quality stats: ${message}`);
  }
}

/**
 * Get recent routing history entries, ordered by most recent first.
 * @param db - The better-sqlite3 Database instance.
 * @param limit - Maximum number of entries to return (default: 50).
 * @returns An array of RoutingHistoryEntry objects.
 * @throws {PersistenceError} If the query fails.
 */
export function getRecentRoutingHistory(
  db: BetterSqlite3.Database,
  limit: number = 50,
): RoutingHistoryEntry[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM routing_history ORDER BY id DESC LIMIT ?',
    ).all(limit) as RoutingHistoryDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get recent routing history: ${message}`);
  }
}
