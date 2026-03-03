/**
 * Abuse detection and auto-blocking.
 * Tracks injection attempts per contact/IP. After threshold attempts
 * within a time window, auto-blocks the contact to 'unknown' trust level.
 * Owner is notified of the block.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { createModuleLogger } from '../utils/logger.js';
import { appendSecurityLog } from '../persistence/security-log.js';

const abuseLogger = createModuleLogger('abuse-detector');

/** Abuse tracking configuration. */
export interface AbuseDetectorConfig {
  /** Max injection attempts before auto-block. Default: 3. */
  maxAttempts: number;
  /** Time window in milliseconds. Default: 1 hour. */
  windowMs: number;
  /** Whether to auto-block contacts (set to unknown). Default: true. */
  autoBlock: boolean;
}

/** Default configuration. */
const DEFAULT_CONFIG: AbuseDetectorConfig = {
  maxAttempts: 3,
  windowMs: 60 * 60 * 1000, // 1 hour
  autoBlock: true,
};

/** A recorded abuse event. */
interface AbuseEvent {
  timestamp: number;
  inputSnippet: string;
  classifiedAs: string;
}

/** Per-identifier abuse tracking state. */
interface AbuseTracker {
  events: AbuseEvent[];
  blocked: boolean;
  blockedAt?: number;
}

/** In-memory store keyed by contactId or IP. */
const abuseTrackers = new Map<string, AbuseTracker>();

/**
 * Record an injection attempt for a contact/IP.
 *
 * @param identifier - The contact ID or IP address.
 * @param inputSnippet - First 100 chars of the offending input.
 * @param classifiedAs - The classification result (e.g., "injection-attempt").
 * @param config - Optional configuration overrides.
 * @returns Whether the identifier is now blocked.
 */
export function recordInjectionAttempt(
  identifier: string,
  inputSnippet: string,
  classifiedAs: string,
  config: Partial<AbuseDetectorConfig> = {},
): boolean {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();

  let tracker = abuseTrackers.get(identifier);
  if (!tracker) {
    tracker = { events: [], blocked: false };
    abuseTrackers.set(identifier, tracker);
  }

  // Prune old events outside the window
  tracker.events = tracker.events.filter(
    (event) => now - event.timestamp < mergedConfig.windowMs,
  );

  // Record new event
  tracker.events.push({
    timestamp: now,
    inputSnippet: inputSnippet.slice(0, 100),
    classifiedAs,
  });

  abuseLogger.warn(
    {
      identifier,
      attemptCount: tracker.events.length,
      maxAttempts: mergedConfig.maxAttempts,
    },
    'Injection attempt recorded',
  );

  // Check if threshold exceeded
  if (tracker.events.length >= mergedConfig.maxAttempts && !tracker.blocked) {
    tracker.blocked = true;
    tracker.blockedAt = now;

    abuseLogger.error(
      {
        identifier,
        attemptCount: tracker.events.length,
      },
      'Auto-block triggered: injection attempt threshold exceeded',
    );

    return true;
  }

  return tracker.blocked;
}

/**
 * Auto-block a contact by setting their trust level to 'unknown'.
 * Logs the action to the security log.
 *
 * @param db - Database connection.
 * @param contactId - The contact to block.
 * @param reason - Reason for the block.
 */
export function autoBlockContact(
  db: BetterSqlite3.Database,
  contactId: string,
  reason: string,
): void {
  try {
    // Check if contact is owner — never auto-block owner
    const contact = db.prepare(
      'SELECT trust_level FROM contacts WHERE id = ?',
    ).get(contactId) as { trust_level: string } | undefined;

    if (!contact) {
      abuseLogger.warn({ contactId }, 'Cannot auto-block: contact not found');
      return;
    }

    if (contact.trust_level === 'owner') {
      abuseLogger.warn({ contactId }, 'Cannot auto-block owner');
      return;
    }

    // Downgrade to unknown
    db.prepare(
      `UPDATE contacts SET trust_level = 'unknown', updated_at = datetime('now') WHERE id = ?`,
    ).run(contactId);

    appendSecurityLog(db, {
      actionType: 'abuse_auto_block',
      actionDetail: `Contact ${contactId} auto-blocked to unknown: ${reason}`,
      allowed: false,
      securityLevel: 1,
      reason,
    });

    abuseLogger.info(
      { contactId, reason },
      'Contact auto-blocked to unknown trust level',
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    abuseLogger.error({ contactId, error: errorMessage }, 'Failed to auto-block contact');
  }
}

/**
 * Check if an identifier is currently blocked.
 *
 * @param identifier - The contact ID or IP address.
 * @returns True if blocked.
 */
export function isBlocked(identifier: string): boolean {
  const tracker = abuseTrackers.get(identifier);
  return tracker?.blocked ?? false;
}

/**
 * Get the number of injection attempts within the current window.
 *
 * @param identifier - The contact ID or IP address.
 * @param config - Optional config overrides.
 * @returns Number of recent attempts.
 */
export function getAttemptCount(
  identifier: string,
  config: Partial<AbuseDetectorConfig> = {},
): number {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const tracker = abuseTrackers.get(identifier);
  if (!tracker) return 0;

  const now = Date.now();
  return tracker.events.filter(
    (event) => now - event.timestamp < mergedConfig.windowMs,
  ).length;
}

/**
 * Unblock an identifier (used by owner to reverse auto-blocks).
 *
 * @param identifier - The contact ID or IP address.
 * @returns True if the identifier was previously blocked and is now unblocked.
 */
export function unblock(identifier: string): boolean {
  const tracker = abuseTrackers.get(identifier);
  if (!tracker || !tracker.blocked) return false;

  tracker.blocked = false;
  tracker.blockedAt = undefined;
  tracker.events = [];

  abuseLogger.info({ identifier }, 'Identifier unblocked');
  return true;
}

/**
 * Clear all abuse tracking state (for testing).
 */
export function clearAllAbuseTrackers(): void {
  abuseTrackers.clear();
}

/**
 * Get abuse tracking info for an identifier (for web panel display).
 *
 * @param identifier - The contact ID or IP address.
 * @returns Tracker state or null if not tracked.
 */
export function getAbuseInfo(identifier: string): {
  attemptCount: number;
  blocked: boolean;
  blockedAt: number | null;
  recentEvents: AbuseEvent[];
} | null {
  const tracker = abuseTrackers.get(identifier);
  if (!tracker) return null;

  return {
    attemptCount: tracker.events.length,
    blocked: tracker.blocked,
    blockedAt: tracker.blockedAt ?? null,
    recentEvents: [...tracker.events],
  };
}
