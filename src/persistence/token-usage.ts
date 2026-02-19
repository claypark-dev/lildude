/**
 * Token usage data access layer.
 * Provides functions to record and query LLM token usage and costs.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';
import type { TokenUsageRecord } from '../types/index.js';

/** Input for recording a single token usage entry. */
export interface RecordUsageInput {
  taskId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd: number;
  roundTripNumber?: number;
}

/** Raw row shape from the token_usage table. */
interface TokenUsageDbRow {
  id: number;
  task_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  round_trip_number: number;
  created_at: string;
}

/**
 * Map a raw database row to the application-level TokenUsageRecord.
 * @param row - Raw SQLite row from the token_usage table.
 * @returns A typed TokenUsageRecord object.
 */
function mapRow(row: TokenUsageDbRow): TokenUsageRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedTokens: row.cached_tokens,
    costUsd: row.cost_usd,
    roundTripNumber: row.round_trip_number,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Record a new token usage entry.
 * @param db - The better-sqlite3 Database instance.
 * @param input - The token usage data to record.
 * @returns The newly created TokenUsageRecord.
 * @throws {PersistenceError} If the insert fails.
 */
export function recordTokenUsage(
  db: BetterSqlite3.Database,
  input: RecordUsageInput,
): TokenUsageRecord {
  try {
    const result = db.prepare(
      `INSERT INTO token_usage (task_id, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, round_trip_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.taskId,
      input.provider,
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.cachedTokens ?? 0,
      input.costUsd,
      input.roundTripNumber ?? 1,
    );

    persistenceLogger.debug({ taskId: input.taskId }, 'Token usage recorded');

    const row = db.prepare(
      'SELECT * FROM token_usage WHERE id = ?',
    ).get(result.lastInsertRowid) as TokenUsageDbRow;

    return mapRow(row);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to record token usage: ${message}`);
  }
}

/**
 * Get all token usage records for a specific task.
 * @param db - The better-sqlite3 Database instance.
 * @param taskId - The task ID to query.
 * @returns An array of TokenUsageRecord objects for the given task.
 * @throws {PersistenceError} If the query fails.
 */
export function getUsageByTask(
  db: BetterSqlite3.Database,
  taskId: string,
): TokenUsageRecord[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM token_usage WHERE task_id = ? ORDER BY created_at ASC',
    ).all(taskId) as TokenUsageDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get usage by task: ${message}`);
  }
}

/**
 * Get token usage records filtered by model name.
 * @param db - The better-sqlite3 Database instance.
 * @param model - The model name to filter by.
 * @param limit - Maximum number of records to return (default: 100).
 * @returns An array of TokenUsageRecord objects for the given model.
 * @throws {PersistenceError} If the query fails.
 */
export function getUsageByModel(
  db: BetterSqlite3.Database,
  model: string,
  limit: number = 100,
): TokenUsageRecord[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM token_usage WHERE model = ? ORDER BY created_at DESC LIMIT ?',
    ).all(model, limit) as TokenUsageDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get usage by model: ${message}`);
  }
}

/**
 * Get the total cost for a specific day.
 * @param db - The better-sqlite3 Database instance.
 * @param date - The date in YYYY-MM-DD format. Defaults to today.
 * @returns The total cost in USD for the given day.
 * @throws {PersistenceError} If the query fails.
 */
export function getDailyTotalCost(
  db: BetterSqlite3.Database,
  date?: string,
): number {
  try {
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    const row = db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM token_usage WHERE DATE(created_at) = ?`,
    ).get(targetDate) as { total: number };

    return row.total;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get daily total cost: ${message}`);
  }
}

/**
 * Get the total cost for a specific month.
 * @param db - The better-sqlite3 Database instance.
 * @param yearMonth - The month in YYYY-MM format. Defaults to current month.
 * @returns The total cost in USD for the given month.
 * @throws {PersistenceError} If the query fails.
 */
export function getMonthlyTotalCost(
  db: BetterSqlite3.Database,
  yearMonth?: string,
): number {
  try {
    const targetMonth = yearMonth ?? new Date().toISOString().slice(0, 7);
    const row = db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM token_usage WHERE strftime('%Y-%m', created_at) = ?`,
    ).get(targetMonth) as { total: number };

    return row.total;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get monthly total cost: ${message}`);
  }
}

/**
 * Get the total cost for all usage records associated with a specific task.
 * @param db - The better-sqlite3 Database instance.
 * @param taskId - The task ID to query.
 * @returns The total cost in USD for the given task.
 * @throws {PersistenceError} If the query fails.
 */
export function getTaskTotalCost(
  db: BetterSqlite3.Database,
  taskId: string,
): number {
  try {
    const row = db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM token_usage WHERE task_id = ?`,
    ).get(taskId) as { total: number };

    return row.total;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get task total cost: ${message}`);
  }
}
