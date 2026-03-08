/**
 * Wave community trust DAL.
 * Caches computed trust scores for community waves.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';
import type { TrustTier } from '../waves/community-trust.js';

/** Application-level trust entry. */
export interface WaveTrustEntry {
  waveName: string;
  trustScore: number;
  trustTier: TrustTier;
  scanPassed: boolean;
  sandboxPassed: boolean;
  highFindings: number;
  criticalFindings: number;
  computedAt: Date;
}

/** Raw DB row. */
interface TrustDbRow {
  wave_name: string;
  trust_score: number;
  trust_tier: string;
  scan_passed: number;
  sandbox_passed: number;
  high_findings: number;
  critical_findings: number;
  computed_at: string;
}

/**
 * Map a raw DB row to an application-level WaveTrustEntry.
 * @param row - The raw database row.
 * @returns The mapped WaveTrustEntry.
 */
function mapRow(row: TrustDbRow): WaveTrustEntry {
  return {
    waveName: row.wave_name,
    trustScore: row.trust_score,
    trustTier: row.trust_tier as TrustTier,
    scanPassed: row.scan_passed === 1,
    sandboxPassed: row.sandbox_passed === 1,
    highFindings: row.high_findings,
    criticalFindings: row.critical_findings,
    computedAt: new Date(row.computed_at),
  };
}

/**
 * Store or update a wave's trust score.
 * @param db - Database connection.
 * @param entry - The trust data to store.
 */
export function upsertTrustScore(
  db: BetterSqlite3.Database,
  entry: Omit<WaveTrustEntry, 'computedAt'>,
): void {
  try {
    db.prepare(
      `INSERT INTO wave_community_trust
         (wave_name, trust_score, trust_tier, scan_passed, sandbox_passed,
          high_findings, critical_findings, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(wave_name) DO UPDATE SET
         trust_score = excluded.trust_score,
         trust_tier = excluded.trust_tier,
         scan_passed = excluded.scan_passed,
         sandbox_passed = excluded.sandbox_passed,
         high_findings = excluded.high_findings,
         critical_findings = excluded.critical_findings,
         computed_at = datetime('now')`,
    ).run(
      entry.waveName,
      entry.trustScore,
      entry.trustTier,
      entry.scanPassed ? 1 : 0,
      entry.sandboxPassed ? 1 : 0,
      entry.highFindings,
      entry.criticalFindings,
    );

    persistenceLogger.debug({ waveName: entry.waveName, trustScore: entry.trustScore }, 'Trust score upserted');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to upsert trust score: ${message}`);
  }
}

/**
 * Get a wave's cached trust score.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @returns The trust entry, or null if not cached.
 */
export function getTrustScore(
  db: BetterSqlite3.Database,
  waveName: string,
): WaveTrustEntry | null {
  try {
    const row = db.prepare(
      'SELECT * FROM wave_community_trust WHERE wave_name = ?',
    ).get(waveName) as TrustDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get trust score: ${message}`);
  }
}

/**
 * Get trust scores for multiple waves at once.
 * @param db - Database connection.
 * @param waveNames - Array of wave names.
 * @returns Map of wave name to trust entry.
 */
export function getTrustScoresBatch(
  db: BetterSqlite3.Database,
  waveNames: string[],
): Map<string, WaveTrustEntry> {
  try {
    if (waveNames.length === 0) return new Map();

    const placeholders = waveNames.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM wave_community_trust WHERE wave_name IN (${placeholders})`,
    ).all(...waveNames) as TrustDbRow[];

    const result = new Map<string, WaveTrustEntry>();
    for (const row of rows) {
      result.set(row.wave_name, mapRow(row));
    }
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get trust scores batch: ${message}`);
  }
}

/**
 * List all trust scores, ordered by score descending.
 * @param db - Database connection.
 * @param limit - Maximum results (default 100).
 * @returns Array of trust entries.
 */
export function listTrustScores(
  db: BetterSqlite3.Database,
  limit: number = 100,
): WaveTrustEntry[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM wave_community_trust ORDER BY trust_score DESC LIMIT ?',
    ).all(limit) as TrustDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list trust scores: ${message}`);
  }
}

/**
 * Delete a wave's trust score entry.
 * @param db - Database connection.
 * @param waveName - The wave name.
 */
export function deleteTrustScore(
  db: BetterSqlite3.Database,
  waveName: string,
): void {
  try {
    db.prepare('DELETE FROM wave_community_trust WHERE wave_name = ?').run(waveName);
    persistenceLogger.debug({ waveName }, 'Trust score deleted');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete trust score: ${message}`);
  }
}
