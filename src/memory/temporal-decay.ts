/**
 * Temporal decay for knowledge relevance scoring.
 * Recent knowledge ranks higher than stale knowledge.
 * Uses exponential decay: score * 0.98^(days_since_access).
 * See Sprint 1: Enhanced Memory & Learning.
 */

/** Daily decay rate. 0.98 means ~18% loss after 10 days, ~45% after 30 days. */
const DECAY_RATE = 0.98;

/** Maximum decay (floor). Even very old entries keep 10% of their score. */
const MIN_DECAY_FACTOR = 0.1;

/** Milliseconds per day. */
const MS_PER_DAY = 86_400_000;

/**
 * Calculate the temporal decay factor for a knowledge entry.
 * Returns a multiplier between MIN_DECAY_FACTOR and 1.0.
 *
 * @param lastAccessed - The date the entry was last accessed or updated.
 * @param now - Current timestamp (defaults to Date.now(), injectable for testing).
 * @returns Decay factor between MIN_DECAY_FACTOR and 1.0.
 */
export function applyTemporalDecay(
  lastAccessed: Date,
  now: number = Date.now(),
): number {
  const daysSinceAccess = Math.max(0, (now - lastAccessed.getTime()) / MS_PER_DAY);
  const decayFactor = Math.pow(DECAY_RATE, daysSinceAccess);
  return Math.max(MIN_DECAY_FACTOR, decayFactor);
}
