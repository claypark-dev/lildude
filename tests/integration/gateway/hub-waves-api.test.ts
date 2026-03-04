/**
 * Integration tests for the enhanced Waves Hub API (Skills Hub).
 * Tests the full request flow: categories, featured, browse, reviews, and stats.
 * Uses Fastify's inject() for in-process testing with in-memory SQLite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { storeApiKey } from '../../../src/persistence/api-keys.js';
import { featureWave } from '../../../src/persistence/featured-waves.js';
import { addReview } from '../../../src/persistence/wave-reviews.js';
import { incrementInstallCount } from '../../../src/persistence/wave-install-counts.js';
import { createGatewayServer, type GatewayServer } from '../../../src/gateway/server.js';
import { ConfigSchema } from '../../../src/config/schema.js';
import type { InjectOptions } from 'fastify';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');
const TEST_API_KEY = 'ld_hub_integration_test_key_0000';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

describe('Hub Waves API (Skills Hub)', () => {
  let dbManager: DatabaseManager;
  let gateway: GatewayServer;

  function authedInject(opts: InjectOptions) {
    return gateway.app.inject({
      ...opts,
      headers: {
        ...opts.headers,
        authorization: `Bearer ${TEST_API_KEY}`,
      },
    });
  }

  beforeEach(async () => {
    dbManager = createTestDb();
    storeApiKey(dbManager.db, TEST_API_KEY, 'hub-test');
    const config = ConfigSchema.parse({});
    gateway = createGatewayServer(dbManager, config);
    await gateway.app.ready();
  });

  afterEach(async () => {
    try { await gateway.stop(); } catch { /* best-effort */ }
    try { dbManager.close(); } catch { /* best-effort */ }
  });

  // ── Categories ────────────────────────────────────────────────────

  describe('GET /api/v1/hub/categories', () => {
    it('returns seeded categories from migration 014', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/categories',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('categories');
      expect(body.categories.length).toBeGreaterThanOrEqual(9);

      const categoryNames = body.categories.map(
        (c: { name: string }) => c.name,
      );
      expect(categoryNames).toContain('productivity');
      expect(categoryNames).toContain('communication');
      expect(categoryNames).toContain('party');
      expect(categoryNames).toContain('developer');
    });

    it('each category has display_name and sort_order', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/categories',
      });

      const body = response.json();
      for (const cat of body.categories) {
        expect(cat).toHaveProperty('displayName');
        expect(typeof cat.displayName).toBe('string');
        expect(cat.displayName.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Featured ──────────────────────────────────────────────────────

  describe('POST /api/v1/hub/featured', () => {
    it('features a wave with a reason', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/hub/featured',
        payload: { waveName: 'weather-checker', reason: 'Great utility' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().message).toContain('weather-checker');
    });

    it('rejects feature without waveName', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/hub/featured',
        payload: { reason: 'No name' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/v1/hub/featured/:name', () => {
    it('unfeatures a previously featured wave', async () => {
      featureWave(dbManager.db, 'test-wave', 'Testing');

      const response = await authedInject({
        method: 'DELETE',
        url: '/api/v1/hub/featured/test-wave',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toContain('unfeatured');
    });
  });

  // ── Browse ────────────────────────────────────────────────────────

  describe('GET /api/v1/hub/browse', () => {
    it('returns waves sorted by popularity by default', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/browse',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('waves');
      expect(body).toHaveProperty('total');
      expect(body.waves.length).toBeGreaterThan(0);
    });

    it('supports category filter', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/browse?category=utilities',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      for (const wave of body.waves) {
        expect(wave.category).toBe('utilities');
      }
    });

    it('supports text search via q parameter', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/browse?q=weather',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.waves.length).toBeGreaterThan(0);
      // Weather-checker should be in results
      const weatherWave = body.waves.find(
        (w: { name: string }) => w.name === 'weather-checker',
      );
      expect(weatherWave).toBeDefined();
    });

    it('supports sort parameter', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/browse?sort=rated',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      // First item should have highest rating
      if (body.waves.length >= 2) {
        const firstRating = body.waves[0].averageRating ?? 0;
        const secondRating = body.waves[1].averageRating ?? 0;
        expect(firstRating).toBeGreaterThanOrEqual(secondRating);
      }
    });

    it('supports limit and offset for pagination', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/browse?limit=2&offset=0',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.waves.length).toBeLessThanOrEqual(2);
    });

    it('returns WaveCard-shaped objects', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/browse?limit=1',
      });

      const body = response.json();
      if (body.waves.length > 0) {
        const card = body.waves[0];
        expect(card).toHaveProperty('name');
        expect(card).toHaveProperty('displayName');
        expect(card).toHaveProperty('description');
        expect(card).toHaveProperty('author');
        expect(card).toHaveProperty('installed');
        expect(typeof card.installed).toBe('boolean');
      }
    });
  });

  // ── Wave Detail ───────────────────────────────────────────────────

  describe('GET /api/v1/hub/waves/:name/detail', () => {
    it('returns full detail for a known wave', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/waves/weather-checker/detail',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('wave');
      expect(body).toHaveProperty('reviews');
      expect(body.wave.name).toBe('weather-checker');
    });

    it('returns 404 for unknown wave', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/waves/nonexistent-wave/detail',
      });

      expect(response.statusCode).toBe(404);
    });

    it('includes local install count and ratings when available', async () => {
      // Set up local data
      incrementInstallCount(dbManager.db, 'weather-checker');
      incrementInstallCount(dbManager.db, 'weather-checker');
      addReview(dbManager.db, {
        waveName: 'weather-checker',
        rating: 5,
        comment: 'Excellent!',
      });

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/waves/weather-checker/detail',
      });

      const body = response.json();
      expect(body.wave.name).toBe('weather-checker');
      expect(body.reviews).toHaveLength(1);
      expect(body.reviews[0].rating).toBe(5);
    });
  });

  // ── Reviews ───────────────────────────────────────────────────────

  describe('Reviews API', () => {
    it('POST /api/v1/hub/waves/:name/reviews adds a review', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/hub/waves/weather-checker/reviews',
        payload: { rating: 4, comment: 'Good skill', reviewer: 'tester' },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.waveName).toBe('weather-checker');
      expect(body.rating).toBe(4);
      expect(body.comment).toBe('Good skill');
    });

    it('POST rejects invalid rating (out of range)', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/hub/waves/weather-checker/reviews',
        payload: { rating: 6, comment: 'Too high' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('POST rejects missing rating', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/hub/waves/weather-checker/reviews',
        payload: { comment: 'No rating' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('GET /api/v1/hub/waves/:name/reviews returns reviews with aggregate', async () => {
      addReview(dbManager.db, { waveName: 'code-reviewer', rating: 5, comment: 'Amazing' });
      addReview(dbManager.db, { waveName: 'code-reviewer', rating: 3, comment: 'OK' });

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/waves/code-reviewer/reviews',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('reviews');
      expect(body).toHaveProperty('averageRating');
      expect(body).toHaveProperty('ratingCount');
      expect(body.reviews).toHaveLength(2);
      expect(body.ratingCount).toBe(2);
      expect(body.averageRating).toBe(4.0);
    });

    it('GET returns empty reviews for wave with none', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/waves/no-reviews-wave/reviews',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.reviews).toHaveLength(0);
      expect(body.averageRating).toBe(0);
      expect(body.ratingCount).toBe(0);
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────

  describe('GET /api/v1/hub/stats', () => {
    it('returns aggregate hub statistics', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/stats',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('stats');
      expect(body.stats).toHaveProperty('registryCount');
      expect(body.stats).toHaveProperty('installedCount');
      expect(body.stats).toHaveProperty('categoryCount');
      expect(body.stats).toHaveProperty('featuredCount');
      expect(body.stats).toHaveProperty('topInstalled');
      expect(body.stats).toHaveProperty('topRated');
      expect(body.stats.registryCount).toBeGreaterThan(0);
      expect(body.stats.categoryCount).toBeGreaterThanOrEqual(9);
    });

    it('reflects featured and install counts in stats', async () => {
      featureWave(dbManager.db, 'weather-checker', 'Popular');
      incrementInstallCount(dbManager.db, 'weather-checker');
      incrementInstallCount(dbManager.db, 'weather-checker');
      incrementInstallCount(dbManager.db, 'weather-checker');

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/stats',
      });

      const body = response.json();
      expect(body.stats.featuredCount).toBeGreaterThanOrEqual(1);
      expect(body.stats.topInstalled.length).toBeGreaterThanOrEqual(1);

      const weatherEntry = body.stats.topInstalled.find(
        (t: { waveName: string }) => t.waveName === 'weather-checker',
      );
      expect(weatherEntry).toBeDefined();
      expect(weatherEntry.installCount).toBe(3);
    });
  });
});
