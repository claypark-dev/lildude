/**
 * Wave effectiveness data access layer.
 * Tracks wave usage counts and success rates in the generated_waves table.
 * Also computes effectiveness scores for wave ranking in matchWave().
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Effectiveness stats for a wave. */
export interface WaveEffectivenessStats {
  waveName: string;
  usageCount: number;
  successCount: number;
  successRate: number;
  lastUsedAt: string | null;
}

/** Top wave for learning journal. */
export interface TopWaveUsage {
  name: string;
  count: number;
}

/**
 * Record a wave execution result (success or failure).
 * Increments usage_count and optionally success_count.
 *
 * @param db - The database instance.
 * @param waveName - The wave name.
 * @param success - Whether the execution succeeded.
 */
export function recordWaveExecution(
  db: BetterSqlite3.Database,
  waveName: string,
  success: boolean,
): void {
  try {
    const successIncrement = success ? 1 : 0;
    const updated = db.prepare(`
      UPDATE generated_waves
      SET usage_count = usage_count + 1,
          success_count = success_count + ?,
          last_used_at = datetime('now'),
          updated_at = datetime('now')
      WHERE name = ?
    `).run(successIncrement, waveName);

    if (updated.changes === 0) {
      persistenceLogger.debug(
        { waveName },
        'Wave not in generated_waves table (bundled wave), skipping effectiveness tracking',
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    persistenceLogger.warn(
      { waveName, error: message },
      'Failed to record wave execution',
    );
  }
}

/**
 * Get effectiveness stats for a wave.
 *
 * @param db - The database instance.
 * @param waveName - The wave name.
 * @returns Stats or null if wave not found.
 */
export function getWaveEffectiveness(
  db: BetterSqlite3.Database,
  waveName: string,
): WaveEffectivenessStats | null {
  try {
    const row = db.prepare(`
      SELECT name, usage_count, success_count, last_used_at
      FROM generated_waves
      WHERE name = ?
    `).get(waveName) as {
      name: string;
      usage_count: number;
      success_count: number;
      last_used_at: string | null;
    } | undefined;

    if (!row) return null;

    return {
      waveName: row.name,
      usageCount: row.usage_count,
      successCount: row.success_count,
      successRate: row.usage_count > 0 ? row.success_count / row.usage_count : 0,
      lastUsedAt: row.last_used_at,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get wave effectiveness: ${message}`);
  }
}

/**
 * Compute an effectiveness score (0-1) for wave ranking.
 * Uses a Bayesian average to handle waves with few uses.
 *
 * @param db - The database instance.
 * @param waveName - The wave name.
 * @returns Score between 0 and 1, or null if wave not tracked.
 */
export function computeEffectivenessScore(
  db: BetterSqlite3.Database,
  waveName: string,
): number | null {
  const stats = getWaveEffectiveness(db, waveName);
  if (!stats) return null;

  // Bayesian average: (successes + prior) / (total + prior_weight)
  // Prior assumes 70% success rate with weight of 3
  const priorSuccessRate = 0.7;
  const priorWeight = 3;
  return (stats.successCount + priorWeight * priorSuccessRate) /
    (stats.usageCount + priorWeight);
}

/**
 * Get top waves by usage for a date range (for learning journal).
 *
 * @param db - The database instance.
 * @param limit - Maximum waves to return.
 * @returns Top waves by usage count.
 */
export function getTopWavesByUsage(
  db: BetterSqlite3.Database,
  limit = 5,
): TopWaveUsage[] {
  try {
    const rows = db.prepare(`
      SELECT name, usage_count as count
      FROM generated_waves
      WHERE usage_count > 0
      ORDER BY usage_count DESC
      LIMIT ?
    `).all(limit) as Array<{ name: string; count: number }>;

    return rows;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get top waves: ${message}`);
  }
}
