/**
 * Per-contact rate limiter.
 * In-memory sliding window rate limiting based on contact.rateLimitPerHour.
 * Prevents external users from overwhelming the system.
 */

import type { Contact } from '../types/index.js';
import { securityLogger } from '../utils/logger.js';

/** Result of a rate limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Remaining requests in the window. */
  remaining: number;
  /** Seconds until the oldest request expires. */
  retryAfterSeconds: number;
}

/** Sliding window entry: timestamp of each request. */
interface WindowEntry {
  timestamps: number[];
}

/** One hour in milliseconds. */
const ONE_HOUR_MS = 60 * 60 * 1000;

/** In-memory sliding window storage. */
const windows = new Map<string, WindowEntry>();

/**
 * Check if a contact is within their rate limit.
 * Uses a sliding window of 1 hour.
 *
 * @param contact - The contact making the request.
 * @returns RateLimitResult indicating if the request is allowed.
 */
export function checkContactRateLimit(contact: Contact): RateLimitResult {
  // Owner is never rate limited
  if (contact.trustLevel === 'owner') {
    return { allowed: true, remaining: Infinity, retryAfterSeconds: 0 };
  }

  const now = Date.now();
  const windowStart = now - ONE_HOUR_MS;

  // Get or create window
  let entry = windows.get(contact.id);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(contact.id, entry);
  }

  // Prune expired timestamps
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  const maxPerHour = contact.rateLimitPerHour;
  const currentCount = entry.timestamps.length;

  if (currentCount >= maxPerHour) {
    // Rate limited
    const oldestTs = entry.timestamps[0];
    const retryAfterMs = oldestTs + ONE_HOUR_MS - now;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

    securityLogger.info(
      { contactId: contact.id, name: contact.name, maxPerHour, currentCount },
      'Contact rate limited',
    );

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    };
  }

  // Record this request
  entry.timestamps.push(now);

  return {
    allowed: true,
    remaining: maxPerHour - currentCount - 1,
    retryAfterSeconds: 0,
  };
}

/**
 * Reset rate limit window for a contact.
 * Used in testing or when an admin wants to unblock someone.
 *
 * @param contactId - The contact ID to reset.
 */
export function resetContactRateLimit(contactId: string): void {
  windows.delete(contactId);
}

/**
 * Clean up all rate limit windows.
 * Called during shutdown or testing.
 */
export function clearAllRateLimits(): void {
  windows.clear();
}

/**
 * Get current rate limit state for a contact (for API/debug).
 *
 * @param contactId - The contact ID.
 * @returns Current count in the window or 0 if none.
 */
export function getRateLimitCount(contactId: string): number {
  const entry = windows.get(contactId);
  if (!entry) return 0;

  const windowStart = Date.now() - ONE_HOUR_MS;
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
  return entry.timestamps.length;
}
