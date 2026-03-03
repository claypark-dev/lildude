/**
 * Contact permission checking.
 * Determines what a contact is allowed to do based on their trust level.
 *
 * Trust level capabilities:
 * - owner:   Full access to all waves and features
 * - trusted: Any wave except destroy/execute safety tier
 * - known:   observe-tier waves only
 * - unknown: Messages only (no wave triggering)
 */

import type { Contact, TrustLevel, WaveSafetyTier } from '../types/index.js';
import { securityLogger } from '../utils/logger.js';

/** Permission check result. */
export interface PermissionResult {
  /** Whether the action is allowed. */
  allowed: boolean;
  /** Human-readable reason for the decision. */
  reason: string;
}

/** Safety tiers allowed per trust level. */
const TRUST_LEVEL_ALLOWED_TIERS: Record<TrustLevel, WaveSafetyTier[]> = {
  owner: ['observe', 'create', 'modify', 'destroy', 'execute'],
  trusted: ['observe', 'create', 'modify'],
  known: ['observe'],
  unknown: [],
};

/**
 * Check if a contact can trigger a specific wave.
 * Considers trust level, safety tier, and per-contact wave permissions.
 *
 * @param contact - The contact attempting the action.
 * @param waveName - The name of the wave being triggered.
 * @param safetyTier - The safety tier of the wave.
 * @returns A PermissionResult indicating whether the action is allowed.
 */
export function canTriggerWave(
  contact: Contact,
  waveName: string,
  safetyTier: WaveSafetyTier,
): PermissionResult {
  // Owner always has full access
  if (contact.trustLevel === 'owner') {
    return { allowed: true, reason: 'Owner has full access' };
  }

  // Unknown contacts cannot trigger any waves
  if (contact.trustLevel === 'unknown') {
    securityLogger.info(
      { contactId: contact.id, waveName },
      'Unknown contact blocked from wave',
    );
    return { allowed: false, reason: 'Unknown contacts cannot trigger waves' };
  }

  // Check if safety tier is allowed for this trust level
  const allowedTiers = TRUST_LEVEL_ALLOWED_TIERS[contact.trustLevel];
  if (!allowedTiers.includes(safetyTier)) {
    securityLogger.info(
      { contactId: contact.id, trustLevel: contact.trustLevel, safetyTier, waveName },
      'Contact trust level insufficient for wave safety tier',
    );
    return {
      allowed: false,
      reason: `${contact.trustLevel} contacts cannot use ${safetyTier}-tier waves`,
    };
  }

  // Check per-contact wave allowlist (if configured)
  if (contact.permittedWaves.length > 0 && !contact.permittedWaves.includes(waveName)) {
    securityLogger.info(
      { contactId: contact.id, waveName, permitted: contact.permittedWaves },
      'Wave not in contact permitted list',
    );
    return {
      allowed: false,
      reason: `Wave "${waveName}" is not in this contact's permitted list`,
    };
  }

  return { allowed: true, reason: 'Contact has permission for this wave' };
}

/**
 * Check if a contact can send messages (basic interaction).
 * All trust levels can send messages, but unknown contacts are rate-limited.
 *
 * @param contact - The contact attempting to send a message.
 * @returns A PermissionResult.
 */
export function canSendMessage(_contact: Contact): PermissionResult {
  return { allowed: true, reason: 'All contacts can send messages' };
}

/**
 * Get the maximum allowed safety tiers for a trust level.
 *
 * @param trustLevel - The trust level to check.
 * @returns An array of allowed WaveSafetyTier values.
 */
export function getAllowedTiers(trustLevel: TrustLevel): WaveSafetyTier[] {
  return [...TRUST_LEVEL_ALLOWED_TIERS[trustLevel]];
}

/**
 * Check if a trust level change is valid (security guard).
 * Only owner can promote to trusted. Nobody can promote to owner after initial setup.
 *
 * @param currentLevel - The current trust level.
 * @param newLevel - The proposed new trust level.
 * @param actorIsOwner - Whether the actor making the change is the owner.
 * @returns A PermissionResult.
 */
export function canChangeTrustLevel(
  currentLevel: TrustLevel,
  newLevel: TrustLevel,
  actorIsOwner: boolean,
): PermissionResult {
  // Cannot change owner's trust level
  if (currentLevel === 'owner') {
    return { allowed: false, reason: 'Cannot change owner trust level' };
  }

  // Cannot promote anyone to owner
  if (newLevel === 'owner') {
    return { allowed: false, reason: 'Cannot promote to owner' };
  }

  // Only owner can change trust levels
  if (!actorIsOwner) {
    return { allowed: false, reason: 'Only the owner can change trust levels' };
  }

  return { allowed: true, reason: 'Trust level change permitted' };
}
