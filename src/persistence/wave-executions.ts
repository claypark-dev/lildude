/**
 * Wave executions data access layer.
 * Tracks ALL wave executions (bundled, installed, and generated)
 * for comprehensive analytics across the Skills Hub.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Source type for a wave execution. */
export type WaveSourceType = 'bundled' | 'installed' | 'generated';

/**
 * Look up a wave's source type from the waves_registry table.
 *
 * @param db - The database instance.
 * @param waveName - The wave name to look up.
 * @returns The source type, defaulting to 'bundled' if not found.
 */
export function getWaveSource(
  db: BetterSqlite3.Database,
  waveName: string,
): WaveSourceType {
  try {
    const row = db.prepare(
      'SELECT source FROM waves_registry WHERE name = ? LIMIT 1',
    ).get(waveName) as { source: string } | undefined;

    if (!row) return 'bundled';

    const source = row.source as WaveSourceType;
    return ['bundled', 'installed', 'generated'].includes(source) ? source : 'bundled';
  } catch {
    return 'bundled';
  }
}

/** Parameters for recording a wave execution. */
export interface RecordExecutionParams {
  waveName: string;
  waveSource: WaveSourceType;
  waveCategory?: string;
  contactId?: string;
  success: boolean;
  executionTimeMs?: number;
  errorMessage?: string;
}

/** A single wave execution record. */
export interface WaveExecutionRecord {
  id: string;
  waveName: string;
  waveSource: WaveSourceType;
  waveCategory: string | null;
  contactId: string | null;
  success: boolean;
  executionTimeMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

/** Aggregate execution stats for a wave. */
export interface WaveExecutionStats {
  waveName: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgExecutionTimeMs: number | null;
  lastExecutedAt: string | null;
}

/**
 * Record a wave execution (any source: bundled, installed, or generated).
 *
 * @param db - The database instance.
 * @param params - Execution details.
 * @returns The generated execution ID.
 */
export function recordExecution(
  db: BetterSqlite3.Database,
  params: RecordExecutionParams,
): string {
  try {
    const id = nanoid();
    db.prepare(`
      INSERT INTO wave_executions (id, wave_name, wave_source, wave_category, contact_id, success, execution_time_ms, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.waveName,
      params.waveSource,
      params.waveCategory ?? null,
      params.contactId ?? null,
      params.success ? 1 : 0,
      params.executionTimeMs ?? null,
      params.errorMessage ?? null,
    );
    return id;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    persistenceLogger.warn(
      { waveName: params.waveName, error: message },
      'Failed to record wave execution',
    );
    throw new PersistenceError(`Failed to record wave execution: ${message}`);
  }
}

/**
 * Get execution stats for a specific wave.
 *
 * @param db - The database instance.
 * @param waveName - The wave name.
 * @returns Aggregated stats or null if no executions found.
 */
export function getExecutionStats(
  db: BetterSqlite3.Database,
  waveName: string,
): WaveExecutionStats | null {
  try {
    const row = db.prepare(`
      SELECT
        wave_name,
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count,
        AVG(execution_time_ms) as avg_time,
        MAX(created_at) as last_executed
      FROM wave_executions
      WHERE wave_name = ?
    `).get(waveName) as {
      wave_name: string | null;
      total: number;
      success_count: number;
      failure_count: number;
      avg_time: number | null;
      last_executed: string | null;
    } | undefined;

    if (!row || row.total === 0) return null;

    return {
      waveName,
      totalExecutions: row.total,
      successCount: row.success_count,
      failureCount: row.failure_count,
      successRate: row.total > 0 ? row.success_count / row.total : 0,
      avgExecutionTimeMs: row.avg_time ? Math.round(row.avg_time) : null,
      lastExecutedAt: row.last_executed,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get execution stats: ${message}`);
  }
}

/**
 * Get top executed waves across all sources.
 *
 * @param db - The database instance.
 * @param limit - Maximum number of results.
 * @returns Top waves by execution count.
 */
export function getTopExecutedWaves(
  db: BetterSqlite3.Database,
  limit = 10,
): Array<{ waveName: string; waveSource: WaveSourceType; executionCount: number; successRate: number }> {
  try {
    const rows = db.prepare(`
      SELECT
        wave_name,
        wave_source,
        COUNT(*) as execution_count,
        CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
      FROM wave_executions
      GROUP BY wave_name
      ORDER BY execution_count DESC
      LIMIT ?
    `).all(limit) as Array<{
      wave_name: string;
      wave_source: string;
      execution_count: number;
      success_rate: number;
    }>;

    return rows.map((row) => ({
      waveName: row.wave_name,
      waveSource: row.wave_source as WaveSourceType,
      executionCount: row.execution_count,
      successRate: row.success_rate,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get top executed waves: ${message}`);
  }
}

/**
 * Get recent wave executions with optional filters.
 *
 * @param db - The database instance.
 * @param options - Filter options.
 * @returns Recent execution records.
 */
export function getRecentExecutions(
  db: BetterSqlite3.Database,
  options: {
    waveName?: string;
    waveSource?: WaveSourceType;
    limit?: number;
    successOnly?: boolean;
  } = {},
): WaveExecutionRecord[] {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.waveName) {
      conditions.push('wave_name = ?');
      params.push(options.waveName);
    }
    if (options.waveSource) {
      conditions.push('wave_source = ?');
      params.push(options.waveSource);
    }
    if (options.successOnly) {
      conditions.push('success = 1');
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = options.limit ?? 50;
    params.push(limit);

    const rows = db.prepare(`
      SELECT id, wave_name, wave_source, wave_category, contact_id, success, execution_time_ms, error_message, created_at
      FROM wave_executions
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params) as Array<{
      id: string;
      wave_name: string;
      wave_source: string;
      wave_category: string | null;
      contact_id: string | null;
      success: number;
      execution_time_ms: number | null;
      error_message: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      waveName: row.wave_name,
      waveSource: row.wave_source as WaveSourceType,
      waveCategory: row.wave_category,
      contactId: row.contact_id,
      success: row.success === 1,
      executionTimeMs: row.execution_time_ms,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get recent executions: ${message}`);
  }
}

/**
 * Get execution counts grouped by source type.
 *
 * @param db - The database instance.
 * @returns Execution counts per source type.
 */
export function getExecutionCountsBySource(
  db: BetterSqlite3.Database,
): Record<WaveSourceType, number> {
  try {
    const rows = db.prepare(`
      SELECT wave_source, COUNT(*) as count
      FROM wave_executions
      GROUP BY wave_source
    `).all() as Array<{ wave_source: string; count: number }>;

    const counts: Record<WaveSourceType, number> = {
      bundled: 0,
      installed: 0,
      generated: 0,
    };

    for (const row of rows) {
      const source = row.wave_source as WaveSourceType;
      if (source in counts) {
        counts[source] = row.count;
      }
    }

    return counts;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get execution counts by source: ${message}`);
  }
}
