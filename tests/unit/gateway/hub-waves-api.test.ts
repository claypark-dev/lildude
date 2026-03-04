/**
 * Tests for the enhanced Waves Hub API routes (hub-waves.ts).
 * Covers categories, featured, browse, wave detail, reviews, and stats endpoints.
 *
 * fetchRegistry and listWaves are mocked so no network or filesystem I/O occurs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerHubWavesRoutes } from '../../../src/gateway/api/hub-waves.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../src/waves/hub-registry.js', () => ({
  fetchRegistry: vi.fn().mockResolvedValue([
    {
      name: 'weather-checker',
      description: 'Check weather',
      author: 'community',
      source: 'github:claypark-dev/weather-checker',
      triggers: ['weather'],
      version: '1.2.0',
      category: 'utilities',
      tags: ['weather'],
      waveCategory: 'personal',
      safetyTier: 'observe',
      deterministic: true,
      installCount: 342,
      averageRating: 4.5,
      ratingCount: 28,
      verified: true,
    },
    {
      name: 'code-reviewer',
      description: 'Review code',
      author: 'community',
      source: 'github:claypark-dev/code-reviewer',
      triggers: ['review'],
      version: '2.0.1',
      category: 'developer',
      tags: ['code'],
      waveCategory: 'personal',
      safetyTier: 'observe',
      deterministic: false,
      installCount: 189,
      averageRating: 4.7,
      ratingCount: 42,
      verified: true,
    },
  ]),
  searchRegistry: vi.fn(),
}));

vi.mock('../../../src/waves/hub.js', () => ({
  listWaves: vi.fn().mockReturnValue([]),
}));

// ── Migration helper ───────────────────────────────────────────────────────

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '003_waves_foundation.sql',
    '007_wave_hub.sql',
    '014_waves_hub_enhanced.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('hub waves API', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);

    app = Fastify({ logger: false });
    registerHubWavesRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  // ── GET /api/v1/hub/categories ────────────────────────────────────────

  describe('GET /api/v1/hub/categories', () => {
    it('returns 200 with the 9 seeded categories', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/categories',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { categories: unknown[] };
      expect(Array.isArray(body.categories)).toBe(true);
      expect(body.categories).toHaveLength(9);
    });

    it('each category has the expected shape', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/categories',
      });

      const body = JSON.parse(response.body) as {
        categories: Array<{ id: string; name: string; displayName: string }>;
      };
      const first = body.categories[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('displayName');
    });
  });

  // ── GET /api/v1/hub/featured ──────────────────────────────────────────

  describe('GET /api/v1/hub/featured', () => {
    it('returns 200 with an array (empty initially)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/featured',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { featured: unknown[] };
      expect(Array.isArray(body.featured)).toBe(true);
      expect(body.featured).toHaveLength(0);
    });
  });

  // ── POST /api/v1/hub/featured ─────────────────────────────────────────

  describe('POST /api/v1/hub/featured', () => {
    it('features a wave and returns 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/featured',
        payload: { waveName: 'weather-checker', reason: 'Great tool' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { message: string };
      expect(body.message).toContain('weather-checker');
    });

    it('featured wave appears in GET /api/v1/hub/featured', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/hub/featured',
        payload: { waveName: 'weather-checker' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/featured',
      });

      const body = JSON.parse(response.body) as { featured: Array<{ name: string }> };
      expect(body.featured.some((w) => w.name === 'weather-checker')).toBe(true);
    });

    it('returns 400 when waveName is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/featured',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('waveName');
    });
  });

  // ── DELETE /api/v1/hub/featured/:name ────────────────────────────────

  describe('DELETE /api/v1/hub/featured/:name', () => {
    it('unfeatures a wave and returns 200', async () => {
      // Feature first
      await app.inject({
        method: 'POST',
        url: '/api/v1/hub/featured',
        payload: { waveName: 'code-reviewer' },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/hub/featured/code-reviewer',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { message: string };
      expect(body.message).toBeTruthy();
    });

    it('wave is removed from featured list after deletion', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/hub/featured',
        payload: { waveName: 'code-reviewer' },
      });

      await app.inject({
        method: 'DELETE',
        url: '/api/v1/hub/featured/code-reviewer',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/featured',
      });

      const body = JSON.parse(response.body) as { featured: Array<{ name: string }> };
      expect(body.featured.some((w) => w.name === 'code-reviewer')).toBe(false);
    });
  });

  // ── GET /api/v1/hub/browse ────────────────────────────────────────────

  describe('GET /api/v1/hub/browse', () => {
    it('returns 200 with wave cards', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/browse',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { waves: unknown[]; total: number };
      expect(Array.isArray(body.waves)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('returns 2 waves from the mocked registry', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/browse',
      });

      const body = JSON.parse(response.body) as { waves: unknown[]; total: number };
      expect(body.total).toBe(2);
    });

    it('filters by category query parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/browse?category=utilities',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { waves: Array<{ name: string }>; total: number };
      expect(body.total).toBe(1);
      expect(body.waves[0]?.name).toBe('weather-checker');
    });
  });

  // ── GET /api/v1/hub/waves/:name/detail ───────────────────────────────

  describe('GET /api/v1/hub/waves/:name/detail', () => {
    it('returns wave detail for a known wave', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/waves/weather-checker/detail',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        wave: { name: string };
        reviews: unknown[];
      };
      expect(body.wave.name).toBe('weather-checker');
      expect(Array.isArray(body.reviews)).toBe(true);
    });

    it('returns 404 for an unknown wave name', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/waves/totally-unknown-wave/detail',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('not found');
    });
  });

  // ── GET /api/v1/hub/waves/:name/reviews ──────────────────────────────

  describe('GET /api/v1/hub/waves/:name/reviews', () => {
    it('returns 200 with empty reviews for a new wave', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/waves/weather-checker/reviews',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        reviews: unknown[];
        averageRating: number;
        ratingCount: number;
      };
      expect(body.reviews).toHaveLength(0);
      expect(body.averageRating).toBe(0);
      expect(body.ratingCount).toBe(0);
    });
  });

  // ── POST /api/v1/hub/waves/:name/reviews ─────────────────────────────

  describe('POST /api/v1/hub/waves/:name/reviews', () => {
    it('creates a review and returns 201 with the new review', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/waves/weather-checker/reviews',
        payload: { rating: 5, comment: 'Excellent wave!', reviewer: 'alice' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        id: string;
        waveName: string;
        rating: number;
        comment: string;
      };
      expect(body.waveName).toBe('weather-checker');
      expect(body.rating).toBe(5);
      expect(body.comment).toBe('Excellent wave!');
      expect(body.id).toBeTruthy();
    });

    it('review appears in subsequent GET /reviews', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/hub/waves/code-reviewer/reviews',
        payload: { rating: 4, comment: 'Good tool' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/waves/code-reviewer/reviews',
      });

      const body = JSON.parse(response.body) as {
        reviews: Array<{ rating: number }>;
        ratingCount: number;
      };
      expect(body.reviews).toHaveLength(1);
      expect(body.ratingCount).toBe(1);
    });

    it('returns 400 when rating is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/waves/weather-checker/reviews',
        payload: { comment: 'No rating given' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeTruthy();
    });

    it('returns 400 when rating is out of range (0 is invalid)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/waves/weather-checker/reviews',
        payload: { rating: 0 },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when rating exceeds 5', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/hub/waves/weather-checker/reviews',
        payload: { rating: 6 },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── GET /api/v1/hub/stats ─────────────────────────────────────────────

  describe('GET /api/v1/hub/stats', () => {
    it('returns 200 with a stats object', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/stats',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { stats: Record<string, unknown> };
      expect(body.stats).toBeDefined();
    });

    it('stats includes registryCount from the mocked registry', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/stats',
      });

      const body = JSON.parse(response.body) as {
        stats: { registryCount: number };
      };
      expect(body.stats.registryCount).toBe(2);
    });

    it('stats includes required numeric fields', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/stats',
      });

      const body = JSON.parse(response.body) as {
        stats: {
          registryCount: number;
          installedCount: number;
          categoryCount: number;
          featuredCount: number;
        };
      };
      expect(typeof body.stats.registryCount).toBe('number');
      expect(typeof body.stats.installedCount).toBe('number');
      expect(typeof body.stats.categoryCount).toBe('number');
      expect(typeof body.stats.featuredCount).toBe('number');
    });

    it('stats includes topInstalled and topRated arrays', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/stats',
      });

      const body = JSON.parse(response.body) as {
        stats: { topInstalled: unknown[]; topRated: unknown[] };
      };
      expect(Array.isArray(body.stats.topInstalled)).toBe(true);
      expect(Array.isArray(body.stats.topRated)).toBe(true);
    });
  });
});
