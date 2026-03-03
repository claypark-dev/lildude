/**
 * Wave safety tier enforcement.
 * Implements the security level × safety tier × model tier decision matrix
 * that determines whether a wave can be executed, needs confirmation, or is blocked.
 * See Sprint 0: Small Model Safeguards.
 */

import { orchestratorLogger } from '../utils/logger.js';
import type { ModelTier, WaveSafetyTier } from '../types/index.js';

/** The possible outcomes of a safety check. */
export type SafetyDecision = 'allow' | 'confirm' | 'block';

/** Result of a wave safety check. */
export interface WaveSafetyResult {
  decision: SafetyDecision;
  reason: string;
  /** If blocked, the minimum model tier that could execute this wave. */
  requiredTier?: ModelTier;
}

/**
 * Numeric ordering for safety tiers (higher = more dangerous).
 * Used for matrix lookups and comparisons.
 */
const SAFETY_TIER_LEVEL: Record<WaveSafetyTier, number> = {
  observe: 0,
  create: 1,
  modify: 2,
  destroy: 3,
  execute: 4,
};

/**
 * The core decision matrix.
 * Indexed by [safetyTier][securityLevel][isSmallModel] → SafetyDecision.
 *
 * Security levels: 1 (Tin Foil Hat) through 5 (YOLO)
 *
 * Matrix from the sprint plan:
 *                    Security Level
 * Safety Tier    1 (Tin Foil)  2 (Careful)  3 (Balanced)  4 (Trusting)  5 (YOLO)
 * ─────────────────────────────────────────────────────────────────────────────────
 * observe
 *   small model  confirm       auto         auto          auto          auto
 *   any model    confirm       auto         auto          auto          auto
 * create
 *   small model  confirm       confirm      confirm       auto          auto
 *   any model    confirm       confirm      auto          auto          auto
 * modify
 *   small model  block         block        confirm       confirm       auto
 *   any model    block         confirm      confirm       auto          auto
 * destroy
 *   small model  block         block        block         confirm       confirm
 *   any model    block         block        confirm       confirm       auto
 * execute
 *   small model  block         block        block         confirm       confirm
 *   any model    block         confirm      confirm       auto          auto
 */
type DecisionRow = [SafetyDecision, SafetyDecision, SafetyDecision, SafetyDecision, SafetyDecision];

const MATRIX_SMALL: Record<WaveSafetyTier, DecisionRow> = {
  observe:  ['confirm', 'allow',   'allow',   'allow',   'allow'],
  create:   ['confirm', 'confirm', 'confirm', 'allow',   'allow'],
  modify:   ['block',   'block',   'confirm', 'confirm', 'allow'],
  destroy:  ['block',   'block',   'block',   'confirm', 'confirm'],
  execute:  ['block',   'block',   'block',   'confirm', 'confirm'],
};

const MATRIX_OTHER: Record<WaveSafetyTier, DecisionRow> = {
  observe:  ['confirm', 'allow',   'allow',   'allow',   'allow'],
  create:   ['confirm', 'confirm', 'allow',   'allow',   'allow'],
  modify:   ['block',   'confirm', 'confirm', 'allow',   'allow'],
  destroy:  ['block',   'block',   'confirm', 'confirm', 'allow'],
  execute:  ['block',   'confirm', 'confirm', 'allow',   'allow'],
};

/**
 * Check whether a wave can be executed given the current security context.
 * Uses the security level × safety tier × model tier decision matrix.
 *
 * @param safetyTier - The wave's declared safety tier (observe, create, modify, destroy, execute).
 * @param modelTier - The current model tier (small, medium, large).
 * @param securityLevel - The user's security level (1-5).
 * @returns A WaveSafetyResult with the decision and reason.
 */
export function checkWaveSafety(
  safetyTier: WaveSafetyTier,
  modelTier: ModelTier,
  securityLevel: number,
): WaveSafetyResult {
  const clampedLevel = Math.max(1, Math.min(5, Math.round(securityLevel)));
  const levelIndex = clampedLevel - 1; // Convert 1-5 to 0-4 array index

  const matrix = modelTier === 'small' ? MATRIX_SMALL : MATRIX_OTHER;
  const decision = matrix[safetyTier][levelIndex];

  const reason = buildReason(decision, safetyTier, modelTier, clampedLevel);

  orchestratorLogger.debug(
    { safetyTier, modelTier, securityLevel: clampedLevel, decision },
    'Wave safety check',
  );

  const result: WaveSafetyResult = { decision, reason };

  // If blocked, suggest the minimum tier that would allow execution
  if (decision === 'block') {
    result.requiredTier = findMinimumTier(safetyTier, clampedLevel);
  }

  return result;
}

/**
 * Find the minimum model tier that would allow (not block) a wave at a given security level.
 * Returns 'medium' if medium would work, 'large' otherwise.
 *
 * @param safetyTier - The wave's safety tier.
 * @param securityLevel - The clamped security level (1-5).
 * @returns The minimum ModelTier that would unblock this wave, or undefined if no tier works.
 */
function findMinimumTier(safetyTier: WaveSafetyTier, securityLevel: number): ModelTier | undefined {
  const levelIndex = securityLevel - 1;

  // Check if medium/large tier would work
  const otherDecision = MATRIX_OTHER[safetyTier][levelIndex];
  if (otherDecision !== 'block') {
    return 'medium';
  }

  // Even large models can't help at this security level
  return undefined;
}

/**
 * Build a human-readable reason string for the safety decision.
 */
function buildReason(
  decision: SafetyDecision,
  safetyTier: WaveSafetyTier,
  modelTier: ModelTier,
  securityLevel: number,
): string {
  const tierLabel = `${safetyTier}-tier wave`;
  const modelLabel = `${modelTier} model`;
  const secLabel = `security level ${securityLevel}`;

  switch (decision) {
    case 'allow':
      return `${tierLabel} auto-allowed for ${modelLabel} at ${secLabel}`;
    case 'confirm':
      return `${tierLabel} requires user confirmation for ${modelLabel} at ${secLabel}`;
    case 'block':
      return `${tierLabel} blocked for ${modelLabel} at ${secLabel} — escalation or higher security level required`;
  }
}

/**
 * Get the default safety tier for a wave that doesn't declare one.
 * Defaults to 'observe' (most restrictive) for safety.
 *
 * @returns The default WaveSafetyTier.
 */
export function getDefaultSafetyTier(): WaveSafetyTier {
  return 'observe';
}

/**
 * Check if a safety tier is more dangerous than another.
 *
 * @param tier - The tier to check.
 * @param threshold - The threshold tier to compare against.
 * @returns True if tier is strictly more dangerous than threshold.
 */
export function isMoreDangerous(tier: WaveSafetyTier, threshold: WaveSafetyTier): boolean {
  return SAFETY_TIER_LEVEL[tier] > SAFETY_TIER_LEVEL[threshold];
}
