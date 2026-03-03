/**
 * Failure patterns data access layer.
 * Records and queries recurring failure patterns for learning.
 * When a tool or wave fails, patterns are upserted — incrementing
 * occurrence_count on duplicates. This allows the agent loop to
 * check for known failure patterns before attempting similar actions.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Input for recording a failure pattern. */
export interface RecordFailureInput {
  intent: string;
  toolName?: string;
  waveName?: string;
  errorType: string;
  errorMessage: string;
  model?: string;
  provider?: string;
}

/** A single failure pattern entry from the database. */
export interface FailurePatternEntry {
  id: number;
  intent: string;
  toolName: string | null;
  waveName: string | null;
  errorType: string;
  errorMessage: string;
  model: string | null;
  provider: string | null;
  resolution: string | null;
  occurrenceCount: number;
  lastOccurredAt: string;
  createdAt: string;
}

/** Top failure type for learning journal. */
export interface TopFailureType {
  type: string;
  count: number;
}

/** Raw row shape from the failure_patterns table. */
interface FailureDbRow {
  id: number;
  intent: string;
  tool_name: string | null;
  wave_name: string | null;
  error_type: string;
  error_message: string;
  model: string | null;
  provider: string | null;
  resolution: string | null;
  occurrence_count: number;
  last_occurred_at: string;
  created_at: string;
}

/**
 * Record a failure pattern, upserting on intent + error_type match.
 * If the same intent + error_type already exists, increments occurrence_count.
 *
 * @param db - The database instance.
 * @param input - The failure data to record.
 * @returns The failure pattern ID.
 */
export function recordFailurePattern(
  db: BetterSqlite3.Database,
  input: RecordFailureInput,
): number {
  try {
    // Check for existing pattern with same intent + error_type
    const existing = db.prepare(`
      SELECT id, occurrence_count FROM failure_patterns
      WHERE intent = ? AND error_type = ?
      LIMIT 1
    `).get(input.intent, input.errorType) as { id: number; occurrence_count: number } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE failure_patterns
        SET occurrence_count = occurrence_count + 1,
            last_occurred_at = datetime('now'),
            error_message = ?,
            model = COALESCE(?, model),
            provider = COALESCE(?, provider),
            tool_name = COALESCE(?, tool_name),
            wave_name = COALESCE(?, wave_name)
        WHERE id = ?
      `).run(
        input.errorMessage,
        input.model ?? null,
        input.provider ?? null,
        input.toolName ?? null,
        input.waveName ?? null,
        existing.id,
      );

      persistenceLogger.debug(
        { id: existing.id, occurrenceCount: existing.occurrence_count + 1 },
        'Failure pattern updated',
      );

      return existing.id;
    }

    const result = db.prepare(`
      INSERT INTO failure_patterns (intent, tool_name, wave_name, error_type, error_message, model, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.intent,
      input.toolName ?? null,
      input.waveName ?? null,
      input.errorType,
      input.errorMessage,
      input.model ?? null,
      input.provider ?? null,
    );

    persistenceLogger.debug(
      { intent: input.intent, errorType: input.errorType },
      'New failure pattern recorded',
    );

    return Number(result.lastInsertRowid);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to record failure pattern: ${message}`);
  }
}

/**
 * Find known failure patterns matching an intent.
 * Ordered by occurrence count descending (most common first).
 *
 * @param db - The database instance.
 * @param intent - The user intent to check against.
 * @param limit - Maximum patterns to return.
 * @returns Matching failure patterns.
 */
export function findFailurePatterns(
  db: BetterSqlite3.Database,
  intent: string,
  limit = 5,
): FailurePatternEntry[] {
  try {
    const rows = db.prepare(`
      SELECT * FROM failure_patterns
      WHERE intent = ?
      ORDER BY occurrence_count DESC
      LIMIT ?
    `).all(intent, limit) as FailureDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to find failure patterns: ${message}`);
  }
}

/**
 * Record a resolution for a failure pattern.
 * Used when a previously-failing task succeeds with a different approach.
 *
 * @param db - The database instance.
 * @param patternId - The failure pattern ID.
 * @param resolution - Description of what resolved the failure.
 */
export function recordResolution(
  db: BetterSqlite3.Database,
  patternId: number,
  resolution: string,
): void {
  try {
    db.prepare(
      'UPDATE failure_patterns SET resolution = ? WHERE id = ?',
    ).run(resolution, patternId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to record resolution: ${message}`);
  }
}

/**
 * Get top failure types for a date range (for learning journal).
 *
 * @param db - The database instance.
 * @param date - The date string (YYYY-MM-DD).
 * @param limit - Maximum types to return.
 * @returns Top failure types by occurrence count.
 */
export function getTopFailureTypes(
  db: BetterSqlite3.Database,
  date: string,
  limit = 5,
): TopFailureType[] {
  try {
    const rows = db.prepare(`
      SELECT error_type as type, SUM(occurrence_count) as count
      FROM failure_patterns
      WHERE DATE(last_occurred_at) = ?
      GROUP BY error_type
      ORDER BY count DESC
      LIMIT ?
    `).all(date, limit) as Array<{ type: string; count: number }>;

    return rows;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get top failure types: ${message}`);
  }
}

/** Map a raw DB row to a typed FailurePatternEntry. */
function mapRow(row: FailureDbRow): FailurePatternEntry {
  return {
    id: row.id,
    intent: row.intent,
    toolName: row.tool_name,
    waveName: row.wave_name,
    errorType: row.error_type,
    errorMessage: row.error_message,
    model: row.model,
    provider: row.provider,
    resolution: row.resolution,
    occurrenceCount: row.occurrence_count,
    lastOccurredAt: row.last_occurred_at,
    createdAt: row.created_at,
  };
}
