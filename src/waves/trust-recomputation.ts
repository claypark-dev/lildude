/**
 * Trust score recomputation job.
 * Periodically fetches all waves from the hub registry, gathers each wave's
 * trust factors (reviews, installs, scan results, author data, publish age),
 * computes a fresh trust score via `computeTrustScore`, and persists the result.
 *
 * Designed to run as a background job so cached trust scores stay up-to-date
 * even when no user is actively browsing the hub.
 */

import type BetterSqlite3 from 'better-sqlite3';
import {
  computeTrustScore,
  getTrustTier,
  emptyTrustFactors,
  type TrustFactors,
} from './community-trust.js';
import { upsertTrustScore } from '../persistence/wave-community-trust.js';
import { getAverageRating } from '../persistence/wave-reviews.js';
import { getInstallCount } from '../persistence/wave-install-counts.js';
import { getAuthor } from '../persistence/wave-authors.js';
import { fetchRegistry } from './hub-registry.js';
import type { WaveRegistryEntry } from './hub-helpers.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('trust-recomputation');

/** Default recomputation interval: 1 hour (in milliseconds). */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/** Result of a trust score recomputation run. */
export interface RecomputeResult {
  /** Total number of waves processed (attempted). */
  processed: number;
  /** Number of waves whose trust scores were successfully updated. */
  updated: number;
  /** Error messages for waves that failed during recomputation. */
  errors: string[];
}

/**
 * Build a `TrustFactors` object for a single wave by combining data from
 * the registry entry, local review/install databases, and author profiles.
 *
 * @param db - Database connection.
 * @param entry - The wave's registry entry.
 * @returns A fully populated TrustFactors for score computation.
 */
function buildTrustFactors(
  db: BetterSqlite3.Database,
  entry: WaveRegistryEntry,
): TrustFactors {
  const factors = emptyTrustFactors();

  // --- Scan results (from registry metadata) ---
  factors.scanPassed = entry.scanPassed ?? false;
  factors.sandboxPassed = entry.sandboxPassed ?? false;
  // The registry does not currently provide per-finding counts,
  // so we infer: if the scan failed, assume at least one high finding.
  factors.highFindings = factors.scanPassed ? 0 : 1;
  factors.criticalFindings = 0;

  // --- Reviews (from local DB) ---
  const ratingAggregate = getAverageRating(db, entry.name);
  if (ratingAggregate) {
    factors.reviewCount = ratingAggregate.ratingCount;
    factors.averageRating = ratingAggregate.averageRating;
  }

  // --- Installs (local DB takes precedence, fall back to registry) ---
  const localInstalls = getInstallCount(db, entry.name);
  factors.installCount = localInstalls > 0
    ? localInstalls
    : (entry.installCount ?? 0);

  // --- Author history ---
  const author = getAuthor(db, entry.author);
  if (author) {
    factors.authorPublishedCount = author.publishedCount;
  }

  // --- Publish age ---
  if (entry.publishedAt) {
    const publishDate = new Date(entry.publishedAt);
    const now = new Date();
    const diffMs = now.getTime() - publishDate.getTime();
    factors.daysSincePublish = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  return factors;
}

/**
 * Recompute trust scores for all waves in the hub registry.
 *
 * For each wave the job:
 * 1. Gathers trust factors from the registry entry, local reviews, installs,
 *    and author data.
 * 2. Computes a 0-100 trust score via `computeTrustScore`.
 * 3. Derives the trust tier via `getTrustTier`.
 * 4. Upserts the result into the `wave_community_trust` table.
 *
 * If a single wave fails, the error is captured and processing continues
 * with the remaining waves.
 *
 * @param db - Database connection.
 * @returns A summary of processed, updated, and failed waves.
 */
export async function recomputeTrustScores(
  db: BetterSqlite3.Database,
): Promise<RecomputeResult> {
  const result: RecomputeResult = {
    processed: 0,
    updated: 0,
    errors: [],
  };

  let waves: WaveRegistryEntry[];
  try {
    waves = await fetchRegistry(db);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Failed to fetch registry for trust recomputation');
    result.errors.push(`Registry fetch failed: ${message}`);
    return result;
  }

  logger.info({ waveCount: waves.length }, 'Starting trust score recomputation');

  for (const entry of waves) {
    result.processed++;

    try {
      const factors = buildTrustFactors(db, entry);
      const trustScore = computeTrustScore(factors);
      const trustTier = getTrustTier(trustScore);

      upsertTrustScore(db, {
        waveName: entry.name,
        trustScore,
        trustTier,
        scanPassed: factors.scanPassed,
        sandboxPassed: factors.sandboxPassed,
        highFindings: factors.highFindings,
        criticalFindings: factors.criticalFindings,
      });

      result.updated++;

      logger.debug(
        { waveName: entry.name, trustScore, trustTier },
        'Trust score recomputed',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const errorDetail = `[${entry.name}] ${message}`;
      result.errors.push(errorDetail);
      logger.warn(
        { waveName: entry.name, error: message },
        'Failed to recompute trust score for wave',
      );
    }
  }

  logger.info(
    {
      processed: result.processed,
      updated: result.updated,
      errorCount: result.errors.length,
    },
    'Trust score recomputation complete',
  );

  return result;
}

/**
 * Start a periodic background job that recomputes trust scores at a
 * fixed interval.
 *
 * The first recomputation runs immediately (on the next event-loop tick),
 * then repeats every `intervalMs` milliseconds.
 *
 * @param db - Database connection.
 * @param intervalMs - Milliseconds between runs (default: 1 hour).
 * @returns A `NodeJS.Timeout` handle that can be passed to
 *          `stopPeriodicRecomputation` to cancel the job.
 */
export function startPeriodicRecomputation(
  db: BetterSqlite3.Database,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): NodeJS.Timeout {
  logger.info(
    { intervalMs },
    'Starting periodic trust score recomputation',
  );

  // Fire an immediate run without blocking the caller.
  recomputeTrustScores(db).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Unhandled error in initial trust recomputation');
  });

  const timer = setInterval(() => {
    recomputeTrustScores(db).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Unhandled error in periodic trust recomputation');
    });
  }, intervalMs);

  // Allow the Node.js process to exit even if the timer is still active.
  timer.unref();

  return timer;
}

/**
 * Stop a previously started periodic recomputation job.
 *
 * @param timer - The timeout handle returned by `startPeriodicRecomputation`.
 */
export function stopPeriodicRecomputation(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  logger.info('Stopped periodic trust score recomputation');
}
