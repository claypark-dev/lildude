/**
 * Token-bucket rate limiter middleware for the Fastify gateway.
 * Tracks request counts per IP address with configurable limits.
 * Stale entries are automatically cleaned up to prevent memory growth.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { gatewayLogger } from '../../utils/logger.js';

const log = gatewayLogger;

/** Rate limit state for a single IP address. */
interface BucketEntry {
  /** Number of requests remaining in the current window. */
  tokens: number;
  /** Timestamp (ms) when the bucket was last refilled. */
  lastRefill: number;
}

/** Configuration for the rate limiter. */
export interface RateLimiterConfig {
  /** Maximum requests per minute per IP. */
  maxPerMinute: number;
}

/** Rate limiter instance returned by createRateLimiter. */
export interface RateLimiter {
  /**
   * Check if a request from the given IP is allowed.
   * Consumes a token if allowed.
   * @param ip - The client IP address.
   * @returns True if the request is allowed, false if rate-limited.
   */
  consume(ip: string): boolean;

  /** Get remaining tokens for an IP (for X-RateLimit-Remaining header). */
  remaining(ip: string): number;

  /** Get the configured limit (for X-RateLimit-Limit header). */
  readonly limit: number;

  /** Remove stale entries older than the given age (ms). */
  cleanup(maxAgeMs?: number): number;

  /** Get current number of tracked IPs (for monitoring). */
  readonly size: number;
}

/**
 * Create a token-bucket rate limiter.
 * Tokens refill linearly based on elapsed time since last request.
 *
 * @param config - Rate limiter configuration.
 * @returns A {@link RateLimiter} instance.
 */
export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const buckets = new Map<string, BucketEntry>();
  const { maxPerMinute } = config;
  const windowMs = 60_000;

  /** Refill tokens based on elapsed time. */
  function refill(entry: BucketEntry, now: number): void {
    const elapsed = now - entry.lastRefill;
    if (elapsed >= windowMs) {
      // Full window has passed — reset to max
      entry.tokens = maxPerMinute;
      entry.lastRefill = now;
    } else {
      // Partial refill: add tokens proportional to elapsed time
      const tokensToAdd = Math.floor((elapsed / windowMs) * maxPerMinute);
      if (tokensToAdd > 0) {
        entry.tokens = Math.min(maxPerMinute, entry.tokens + tokensToAdd);
        entry.lastRefill = now;
      }
    }
  }

  function getOrCreateBucket(ip: string, now: number): BucketEntry {
    let entry = buckets.get(ip);
    if (!entry) {
      entry = { tokens: maxPerMinute, lastRefill: now };
      buckets.set(ip, entry);
    }
    return entry;
  }

  return {
    consume(ip: string): boolean {
      const now = Date.now();
      const entry = getOrCreateBucket(ip, now);
      refill(entry, now);

      if (entry.tokens > 0) {
        entry.tokens -= 1;
        return true;
      }

      return false;
    },

    remaining(ip: string): number {
      const now = Date.now();
      const entry = buckets.get(ip);
      if (!entry) {
        return maxPerMinute;
      }
      refill(entry, now);
      return entry.tokens;
    },

    get limit(): number {
      return maxPerMinute;
    },

    cleanup(maxAgeMs: number = 300_000): number {
      const cutoff = Date.now() - maxAgeMs;
      let removed = 0;
      for (const [ip, entry] of buckets.entries()) {
        if (entry.lastRefill < cutoff) {
          buckets.delete(ip);
          removed += 1;
        }
      }
      return removed;
    },

    get size(): number {
      return buckets.size;
    },
  };
}

/**
 * Register the rate limiter middleware on the Fastify instance.
 * Adds rate limit headers to every response and returns 429 when exceeded.
 *
 * @param app - The Fastify server instance.
 * @param limiter - The rate limiter instance.
 */
export function registerRateLimiterMiddleware(
  app: FastifyInstance,
  limiter: RateLimiter,
): void {
  // Periodic cleanup every 5 minutes to prevent memory growth
  const cleanupInterval = setInterval(() => {
    const removed = limiter.cleanup();
    if (removed > 0) {
      log.debug({ removed }, 'Rate limiter cleanup');
    }
  }, 300_000);
  cleanupInterval.unref();

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only rate-limit API routes
    if (!request.url.startsWith('/api/')) {
      return;
    }

    // Skip rate limiting for health check
    if (request.url.startsWith('/api/v1/health')) {
      return;
    }

    const ip = request.ip;
    const allowed = limiter.consume(ip);

    // Always add rate limit headers
    reply.header('X-RateLimit-Limit', limiter.limit);
    reply.header('X-RateLimit-Remaining', limiter.remaining(ip));

    if (!allowed) {
      log.warn({ ip, url: request.url }, 'Rate limit exceeded');
      reply.header('Retry-After', '60');
      return reply.status(429).send({
        error: 'Too Many Requests',
        detail: `Rate limit of ${limiter.limit} requests per minute exceeded`,
      });
    }
  });

  log.info({ maxPerMinute: limiter.limit }, 'Rate limiter middleware registered');
}
