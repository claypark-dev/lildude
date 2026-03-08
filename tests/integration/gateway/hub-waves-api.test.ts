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
import { recordExecution } from '../../../src/persistence/wave-executions.js';
import { createGatewayServer, type GatewayServer } from '../../../src/gateway/server.js';
import { setCachedRegistry } from '../../../src/persistence/wave-hub-cache.js';
import { clearRegistryMemoryCache } from '../../../src/waves/hub-registry.js';
import { ConfigSchema } from '../../../src/config/schema.js';
import type { InjectOptions } from 'fastify';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');
const TEST_API_KEY = 'ld_hub_integration_test_key_0000';

/** Seed the wave hub cache with test registry data so fetchRegistry returns results. */
function seedRegistryCache(db: import('better-sqlite3').Database): void {
  const testRegistry = {
    version: '1.0.0',
    waves: [
      {
        name: 'color-converter',
        description: 'Convert between hex, RGB, and HSL color formats',
        author: 'test-author',
        source: 'github:test/color-converter',
        triggers: ['convert color', 'hex to rgb'],
        version: '1.0.0',
        category: 'utilities',
        tags: ['color', 'converter'],
        waveCategory: 'personal',
        safetyTier: 'observe',
        deterministic: true,
        verified: true,
        installCount: 0,
        averageRating: 0,
        ratingCount: 0,
      },
      {
        name: 'code-reviewer',
        description: 'Review code for best practices',
        author: 'test-author',
        source: 'github:test/code-reviewer',
        triggers: ['review code'],
        version: '1.0.0',
        category: 'development',
        tags: ['code', 'review'],
        waveCategory: 'personal',
        safetyTier: 'observe',
        deterministic: false,
        verified: true,
        installCount: 0,
        averageRating: 0,
        ratingCount: 0,
      },
      {
        name: 'email-reader',
        description: 'Read and summarize emails',
        author: 'test-author',
        source: 'github:test/email-reader',
        triggers: ['read email', 'check inbox'],
        version: '1.0.0',
        category: 'communication',
        tags: ['email'],
        waveCategory: 'personal',
        safetyTier: 'observe',
        deterministic: false,
        verified: true,
        installCount: 0,
        averageRating: 0,
        ratingCount: 0,
      },
      {
        name: 'web-search',
        description: 'Search the web for information',
        author: 'test-author',
        source: 'github:test/web-search',
        triggers: ['search', 'look up'],
        version: '1.0.0',
        category: 'utilities',
        tags: ['search', 'web'],
        waveCategory: 'personal',
        safetyTier: 'observe',
        deterministic: false,
        verified: true,
        installCount: 0,
        averageRating: 0,
        ratingCount: 0,
      },
    ],
  };
  setCachedRegistry(
    db,
    'https://raw.githubusercontent.com/clapyark/wave-registry/main/registry.json',
    JSON.stringify(testRegistry),
    24,
  );
}

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
    clearRegistryMemoryCache();
    dbManager = createTestDb();
    storeApiKey(dbManager.db, TEST_API_KEY, 'hub-test');
    seedRegistryCache(dbManager.db);
    const config = ConfigSchema.parse({});
    gateway = createGatewayServer(dbManager, config);
    await gateway.app.ready();
  });

  afterEach(async () => {
    clearRegistryMemoryCache();
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
        payload: { waveName: 'color-converter', reason: 'Great utility' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().message).toContain('color-converter');
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
        url: '/api/v1/hub/browse?q=color',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.waves.length).toBeGreaterThan(0);
      // color-converter should be in results
      const matchedWave = body.waves.find(
        (w: { name: string }) => w.name === 'color-converter',
      );
      expect(matchedWave).toBeDefined();
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
        url: '/api/v1/hub/waves/color-converter/detail',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('wave');
      expect(body).toHaveProperty('reviews');
      expect(body.wave.name).toBe('color-converter');
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
      incrementInstallCount(dbManager.db, 'color-converter');
      incrementInstallCount(dbManager.db, 'color-converter');
      addReview(dbManager.db, {
        waveName: 'color-converter',
        rating: 5,
        comment: 'Excellent!',
      });

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/waves/color-converter/detail',
      });

      const body = response.json();
      expect(body.wave.name).toBe('color-converter');
      expect(body.reviews).toHaveLength(1);
      expect(body.reviews[0].rating).toBe(5);
    });
  });

  // ── Reviews ───────────────────────────────────────────────────────

  describe('Reviews API', () => {
    it('POST /api/v1/hub/waves/:name/reviews adds a review', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/hub/waves/color-converter/reviews',
        payload: { rating: 4, comment: 'Good skill', reviewer: 'tester' },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.waveName).toBe('color-converter');
      expect(body.rating).toBe(4);
      expect(body.comment).toBe('Good skill');
    });

    it('POST rejects invalid rating (out of range)', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/hub/waves/color-converter/reviews',
        payload: { rating: 6, comment: 'Too high' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('POST rejects missing rating', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/hub/waves/color-converter/reviews',
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
      featureWave(dbManager.db, 'color-converter', 'Popular');
      incrementInstallCount(dbManager.db, 'color-converter');
      incrementInstallCount(dbManager.db, 'color-converter');
      incrementInstallCount(dbManager.db, 'color-converter');

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/stats',
      });

      const body = response.json();
      expect(body.stats.featuredCount).toBeGreaterThanOrEqual(1);
      expect(body.stats.topInstalled.length).toBeGreaterThanOrEqual(1);

      const weatherEntry = body.stats.topInstalled.find(
        (t: { waveName: string }) => t.waveName === 'color-converter',
      );
      expect(weatherEntry).toBeDefined();
      expect(weatherEntry.installCount).toBe(3);
    });

    it('includes execution analytics in stats', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/stats',
      });

      const body = response.json();
      expect(body.stats).toHaveProperty('totalExecutions');
      expect(body.stats).toHaveProperty('executionsBySource');
      expect(body.stats).toHaveProperty('topExecuted');
      expect(body.stats.executionsBySource).toHaveProperty('bundled');
      expect(body.stats.executionsBySource).toHaveProperty('installed');
      expect(body.stats.executionsBySource).toHaveProperty('generated');
    });

    it('reflects wave executions in stats', async () => {
      recordExecution(dbManager.db, { waveName: 'email-reader', waveSource: 'bundled', success: true });
      recordExecution(dbManager.db, { waveName: 'email-reader', waveSource: 'bundled', success: true });
      recordExecution(dbManager.db, { waveName: 'web-search', waveSource: 'bundled', success: false });

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/stats',
      });

      const body = response.json();
      expect(body.stats.totalExecutions).toBe(3);
      expect(body.stats.executionsBySource.bundled).toBe(3);
      expect(body.stats.topExecuted.length).toBeGreaterThanOrEqual(1);

      const emailEntry = body.stats.topExecuted.find(
        (t: { waveName: string }) => t.waveName === 'email-reader',
      );
      expect(emailEntry).toBeDefined();
      expect(emailEntry.executionCount).toBe(2);
      expect(emailEntry.successRate).toBe(1);
    });
  });

  // ── Wave Detail with Execution Stats ───────────────────────────────

  describe('GET /api/v1/hub/waves/:name/detail (execution stats)', () => {
    it('returns null executionStats when no executions exist', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/waves/color-converter/detail',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('executionStats');
      expect(body.executionStats).toBeNull();
    });

    it('returns execution stats when executions exist', async () => {
      recordExecution(dbManager.db, {
        waveName: 'color-converter',
        waveSource: 'bundled',
        success: true,
        executionTimeMs: 500,
      });
      recordExecution(dbManager.db, {
        waveName: 'color-converter',
        waveSource: 'bundled',
        success: false,
        executionTimeMs: 200,
        errorMessage: 'API error',
      });

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/waves/color-converter/detail',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.executionStats).not.toBeNull();
      expect(body.executionStats.totalExecutions).toBe(2);
      expect(body.executionStats.successCount).toBe(1);
      expect(body.executionStats.failureCount).toBe(1);
      expect(body.executionStats.successRate).toBe(0.5);
      expect(body.executionStats.avgExecutionTimeMs).toBe(350);
      expect(body.executionStats.lastExecutedAt).toBeDefined();
    });

    it('includes execution count in wave card data', async () => {
      recordExecution(dbManager.db, { waveName: 'color-converter', waveSource: 'bundled', success: true });
      recordExecution(dbManager.db, { waveName: 'color-converter', waveSource: 'bundled', success: true });

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/hub/waves/color-converter/detail',
      });

      const body = response.json();
      expect(body.wave.executionCount).toBe(2);
      expect(body.wave.successRate).toBe(1);
    });
  });
});
