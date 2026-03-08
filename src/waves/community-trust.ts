/**
 * Community trust scoring for published waves.
 * Computes a 0–100 trust score from multiple weighted factors,
 * then maps the score to a human-readable trust tier.
 *
 * Tiers:
 *   trusted (80–100)   — green badge, no warning on install
 *   community (50–79)  — blue badge, brief disclaimer
 *   new (20–49)        — yellow badge, safety warning
 *   unreviewed (0–19)  — red badge, strong warning + confirmation
 */

/** Trust tier labels for community waves. */
export type TrustTier = 'trusted' | 'community' | 'new' | 'unreviewed';

/** Factors used to compute a community trust score. */
export interface TrustFactors {
  /** Whether the security scan passed (no critical findings). */
  scanPassed: boolean;
  /** Number of high-severity findings from the scan. */
  highFindings: number;
  /** Number of critical-severity findings from the scan. */
  criticalFindings: number;
  /** Whether the sandbox execution passed without errors. */
  sandboxPassed: boolean;
  /** Total number of reviews for this wave. */
  reviewCount: number;
  /** Average user rating (1–5). */
  averageRating: number;
  /** Total install count across all instances. */
  installCount: number;
  /** Number of waves published by the same author. */
  authorPublishedCount: number;
  /** Days since the wave was first published. */
  daysSincePublish: number;
}

/**
 * Factor weights for the trust score computation.
 * Total weight sums to 100 for a 0–100 score range.
 */
const WEIGHTS = {
  securityScan: 30,
  sandboxPass: 15,
  reviewCount: 15,
  averageRating: 15,
  installCount: 10,
  authorHistory: 10,
  age: 5,
} as const;

/**
 * Compute a community trust score from weighted factors.
 * Returns a value between 0 and 100 (inclusive).
 *
 * @param factors - The trust factors to evaluate.
 * @returns A trust score between 0 and 100.
 */
export function computeTrustScore(factors: TrustFactors): number {
  // Security scan: 30 if clean, penalized for findings
  let scanScore = factors.scanPassed ? WEIGHTS.securityScan : 0;
  scanScore -= factors.highFindings * 10;
  scanScore -= factors.criticalFindings * 30;
  scanScore = Math.max(0, scanScore);

  // Sandbox pass: 15 if passed, 0 otherwise
  const sandboxScore = factors.sandboxPassed ? WEIGHTS.sandboxPass : 0;

  // Review count: up to 15 points (capped at 10 reviews)
  const reviewScore = Math.min(factors.reviewCount, 10) * 1.5;

  // Average rating: proportional to max (up to 15 points)
  const ratingScore = (factors.averageRating / 5) * WEIGHTS.averageRating;

  // Install count: logarithmic scaling (up to 10 points)
  const installScore = Math.min(
    Math.log10(factors.installCount + 1) * 5,
    WEIGHTS.installCount,
  );

  // Author history: 2 points per published wave (up to 10)
  const authorScore = Math.min(
    factors.authorPublishedCount * 2,
    WEIGHTS.authorHistory,
  );

  // Age: 1 point per 30 days (up to 5)
  const ageScore = Math.min(factors.daysSincePublish / 30, WEIGHTS.age);

  const rawScore = scanScore + sandboxScore + reviewScore
    + ratingScore + installScore + authorScore + ageScore;

  return Math.max(0, Math.min(100, Math.round(rawScore)));
}

/**
 * Map a numeric trust score to a human-readable tier.
 *
 * @param score - A trust score between 0 and 100.
 * @returns The corresponding TrustTier.
 */
export function getTrustTier(score: number): TrustTier {
  if (score >= 80) return 'trusted';
  if (score >= 50) return 'community';
  if (score >= 20) return 'new';
  return 'unreviewed';
}

/**
 * Build a default TrustFactors object with zero/false values.
 * Useful for new or unknown waves.
 *
 * @returns A TrustFactors object with all values at their minimum.
 */
export function emptyTrustFactors(): TrustFactors {
  return {
    scanPassed: false,
    highFindings: 0,
    criticalFindings: 0,
    sandboxPassed: false,
    reviewCount: 0,
    averageRating: 0,
    installCount: 0,
    authorPublishedCount: 0,
    daysSincePublish: 0,
  };
}
