import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  createRateLimiter,
  registerRateLimiterMiddleware,
  type RateLimiter,
} from '../../../src/gateway/middleware/rate-limiter.js';

describe('rate-limiter', () => {
  describe('createRateLimiter', () => {
    let limiter: RateLimiter;

    beforeEach(() => {
      limiter = createRateLimiter({ maxPerMinute: 5 });
    });

    it('allows requests within limit', () => {
      for (let i = 0; i < 5; i++) {
        expect(limiter.consume('1.2.3.4')).toBe(true);
      }
    });

    it('blocks requests over limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.consume('1.2.3.4');
      }

      expect(limiter.consume('1.2.3.4')).toBe(false);
    });

    it('tracks IPs independently', () => {
      for (let i = 0; i < 5; i++) {
        limiter.consume('1.1.1.1');
      }

      // Different IP should still be allowed
      expect(limiter.consume('2.2.2.2')).toBe(true);
    });

    it('reports remaining tokens', () => {
      expect(limiter.remaining('3.3.3.3')).toBe(5);

      limiter.consume('3.3.3.3');
      limiter.consume('3.3.3.3');

      expect(limiter.remaining('3.3.3.3')).toBe(3);
    });

    it('reports limit', () => {
      expect(limiter.limit).toBe(5);
    });

    it('reports size', () => {
      limiter.consume('a');
      limiter.consume('b');
      limiter.consume('c');

      expect(limiter.size).toBe(3);
    });

    it('refills tokens after time passes', () => {
      vi.useFakeTimers();
      const timedLimiter = createRateLimiter({ maxPerMinute: 10 });

      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        timedLimiter.consume('refill-ip');
      }
      expect(timedLimiter.consume('refill-ip')).toBe(false);

      // Advance time by 1 minute
      vi.advanceTimersByTime(60_000);

      // Should have tokens again
      expect(timedLimiter.consume('refill-ip')).toBe(true);

      vi.useRealTimers();
    });

    it('partially refills based on elapsed time', () => {
      vi.useFakeTimers();
      const timedLimiter = createRateLimiter({ maxPerMinute: 100 });

      // Exhaust all tokens
      for (let i = 0; i < 100; i++) {
        timedLimiter.consume('partial-ip');
      }
      expect(timedLimiter.consume('partial-ip')).toBe(false);

      // Advance by 30 seconds (half a window)
      vi.advanceTimersByTime(30_000);

      // Should have approximately half the tokens back
      const remaining = timedLimiter.remaining('partial-ip');
      expect(remaining).toBeGreaterThanOrEqual(45);
      expect(remaining).toBeLessThanOrEqual(55);

      vi.useRealTimers();
    });

    describe('cleanup', () => {
      it('removes stale entries', () => {
        vi.useFakeTimers();
        const cleanLimiter = createRateLimiter({ maxPerMinute: 10 });

        cleanLimiter.consume('old-ip');

        // Advance past default cleanup age (5 minutes)
        vi.advanceTimersByTime(310_000);

        const removed = cleanLimiter.cleanup();
        expect(removed).toBe(1);
        expect(cleanLimiter.size).toBe(0);

        vi.useRealTimers();
      });

      it('keeps fresh entries', () => {
        const cleanLimiter = createRateLimiter({ maxPerMinute: 10 });

        cleanLimiter.consume('fresh-ip');

        const removed = cleanLimiter.cleanup();
        expect(removed).toBe(0);
        expect(cleanLimiter.size).toBe(1);
      });
    });
  });

  describe('registerRateLimiterMiddleware', () => {
    let app: FastifyInstance;
    let limiter: RateLimiter;

    beforeEach(async () => {
      app = Fastify({ logger: false });
      limiter = createRateLimiter({ maxPerMinute: 3 });
      registerRateLimiterMiddleware(app, limiter);

      app.get('/api/v1/health', async () => ({ status: 'ok' }));
      app.get('/api/v1/data', async () => ({ data: 'value' }));
      app.get('/static', async () => ({ page: 'html' }));

      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it('allows requests within limit', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/data' });

      expect(response.statusCode).toBe(200);
    });

    it('returns 429 when limit exceeded', async () => {
      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        await app.inject({ method: 'GET', url: '/api/v1/data' });
      }

      const response = await app.inject({ method: 'GET', url: '/api/v1/data' });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Too Many Requests');
    });

    it('adds rate limit headers', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/data' });

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    });

    it('adds Retry-After header on 429', async () => {
      for (let i = 0; i < 3; i++) {
        await app.inject({ method: 'GET', url: '/api/v1/data' });
      }

      const response = await app.inject({ method: 'GET', url: '/api/v1/data' });

      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('60');
    });

    it('skips rate limiting for health check', async () => {
      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        await app.inject({ method: 'GET', url: '/api/v1/data' });
      }

      // Health check should still work
      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(response.statusCode).toBe(200);
    });

    it('skips rate limiting for non-API routes', async () => {
      // Exhaust the limit on API routes
      for (let i = 0; i < 3; i++) {
        await app.inject({ method: 'GET', url: '/api/v1/data' });
      }

      // Static route should still work
      const response = await app.inject({ method: 'GET', url: '/static' });
      expect(response.statusCode).toBe(200);
    });
  });
});
