/**
 * Tests for the community publishing API routes (community.ts).
 * Covers validate, publish, publish history, authors, author profile,
 * and trust score endpoints.
 *
 * packageWave and publishToRegistry are mocked to avoid filesystem
 * and network I/O.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerCommunityRoutes } from '../../../src/gateway/api/community.js';
import { upsertAuthor } from '../../../src/persistence/wave-authors.js';
import { recordPublish } from '../../../src/persistence/wave-publish-history.js';
import { upsertTrustScore } from '../../../src/persistence/wave-community-trust.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../src/waves/packager.js', () => ({
  packageWave: vi.fn(),
}));

vi.mock('../../../src/waves/publisher.js', () => ({
  publishToRegistry: vi.fn(),
}));

import { packageWave } from '../../../src/waves/packager.js';
import { publishToRegistry } from '../../../src/waves/publisher.js';

const mockedPackageWave = vi.mocked(packageWave);
const mockedPublishToRegistry = vi.mocked(publishToRegistry);

// ── Migration helper ───────────────────────────────────────────────────────

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '003_waves_foundation.sql',
    '007_wave_hub.sql',
    '014_waves_hub_enhanced.sql',
    '017_wave_executions.sql',
    '018_community_publishing.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────

function validPackageResult() {
  return {
    manifest: {
      name: 'test-wave',
      version: '1.0.0',
      description: 'Test',
      author: 'tester',
      entryPoint: 'index.js',
      triggers: [],
      deterministic: true,
      safetyTier: 'observe',
      category: 'utilities',
      permissions: {
        domains: [],
        shell: [],
        directories: [],
        requiresBrowser: false,
      },
    },
    files: [{ relativePath: 'wave.json', content: '{}', hash: 'abc123' }],
    scanResult: {
      passed: true,
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      findings: [],
    },
    sandboxResult: { success: true, error: null },
    packageHash: 'hash123',
    totalSizeBytes: 500,
  };
}

function validPublishResult() {
  return {
    prUrl: 'https://github.com/lildude-community/wave-registry/pull/42',
    prNumber: 42,
    branch: 'wave/test-wave-1.0.0',
  };
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('community API', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);

    app = Fastify({ logger: false });
    registerCommunityRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    vi.restoreAllMocks();
  });

  // ── POST /api/v1/community/validate ──────────────────────────────────

  describe('POST /api/v1/community/validate', () => {
    it('returns 400 when wavePath is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/community/validate',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('wavePath');
    });

    it('returns validation result on success', async () => {
      mockedPackageWave.mockResolvedValueOnce(validPackageResult() as never);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/community/validate',
        payload: { wavePath: '/tmp/my-wave' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        valid: boolean;
        manifest: { name: string; version: string };
        scanResult: { passed: boolean };
        packageHash: string;
        totalSizeBytes: number;
        fileCount: number;
      };
      expect(body.valid).toBe(true);
      expect(body.manifest.name).toBe('test-wave');
      expect(body.manifest.version).toBe('1.0.0');
      expect(body.scanResult.passed).toBe(true);
      expect(body.packageHash).toBe('hash123');
      expect(body.totalSizeBytes).toBe(500);
      expect(body.fileCount).toBe(1);
    });

    it('returns 400 on validation error', async () => {
      mockedPackageWave.mockRejectedValueOnce(new Error('Invalid wave.json schema'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/community/validate',
        payload: { wavePath: '/tmp/bad-wave' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('Invalid wave.json schema');
    });
  });

  // ── POST /api/v1/community/publish ───────────────────────────────────

  describe('POST /api/v1/community/publish', () => {
    it('returns 400 when wavePath is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/community/publish',
        payload: { githubToken: 'ghp_abc123' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('wavePath');
    });

    it('returns 400 when githubToken is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/community/publish',
        payload: { wavePath: '/tmp/my-wave' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('githubToken');
    });

    it('returns 201 with PR info on success', async () => {
      mockedPackageWave.mockResolvedValueOnce(validPackageResult() as never);
      mockedPublishToRegistry.mockResolvedValueOnce(validPublishResult() as never);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/community/publish',
        payload: {
          wavePath: '/tmp/my-wave',
          githubToken: 'ghp_abc123',
          registryRepo: 'my-org/wave-registry',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        prUrl: string;
        prNumber: number;
        branch: string;
        waveName: string;
        version: string;
      };
      expect(body.prUrl).toBe('https://github.com/lildude-community/wave-registry/pull/42');
      expect(body.prNumber).toBe(42);
      expect(body.branch).toBe('wave/test-wave-1.0.0');
      expect(body.waveName).toBe('test-wave');
      expect(body.version).toBe('1.0.0');
    });

    it('returns 400 on publish error', async () => {
      mockedPackageWave.mockResolvedValueOnce(validPackageResult() as never);
      mockedPublishToRegistry.mockRejectedValueOnce(new Error('GitHub API rate limit exceeded'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/community/publish',
        payload: {
          wavePath: '/tmp/my-wave',
          githubToken: 'ghp_abc123',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('rate limit');
    });

    it('records publish history on success', async () => {
      mockedPackageWave.mockResolvedValueOnce(validPackageResult() as never);
      mockedPublishToRegistry.mockResolvedValueOnce(validPublishResult() as never);

      await app.inject({
        method: 'POST',
        url: '/api/v1/community/publish',
        payload: {
          wavePath: '/tmp/my-wave',
          githubToken: 'ghp_abc123',
        },
      });

      // Verify via the history endpoint
      const historyResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/community/publish/history',
      });

      expect(historyResponse.statusCode).toBe(200);
      const historyBody = JSON.parse(historyResponse.body) as {
        submissions: Array<{ waveName: string; version: string; prUrl: string }>;
      };
      expect(historyBody.submissions).toHaveLength(1);
      expect(historyBody.submissions[0].waveName).toBe('test-wave');
      expect(historyBody.submissions[0].version).toBe('1.0.0');
    });
  });

  // ── GET /api/v1/community/publish/history ────────────────────────────

  describe('GET /api/v1/community/publish/history', () => {
    it('returns empty history initially', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/publish/history',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { submissions: unknown[] };
      expect(body.submissions).toHaveLength(0);
    });

    it('returns history entries after recording', async () => {
      recordPublish(db, 'alpha-wave', '1.0.0', 'https://github.com/org/repo/pull/1', 1);
      recordPublish(db, 'beta-wave', '2.0.0', 'https://github.com/org/repo/pull/2', 2);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/publish/history',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        submissions: Array<{ waveName: string }>;
      };
      expect(body.submissions).toHaveLength(2);
    });

    it('respects limit parameter', async () => {
      recordPublish(db, 'wave-a', '1.0.0', null, null);
      recordPublish(db, 'wave-b', '1.0.0', null, null);
      recordPublish(db, 'wave-c', '1.0.0', null, null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/publish/history?limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { submissions: unknown[] };
      expect(body.submissions).toHaveLength(2);
    });
  });

  // ── GET /api/v1/community/authors ────────────────────────────────────

  describe('GET /api/v1/community/authors', () => {
    it('returns empty authors list initially', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/authors',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { authors: unknown[] };
      expect(body.authors).toHaveLength(0);
    });

    it('returns authors after inserting via upsertAuthor', async () => {
      upsertAuthor(db, 'alice', 'Alice Dev', 'https://avatars.example.com/alice');
      upsertAuthor(db, 'bob', 'Bob Builder');

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/authors',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        authors: Array<{ githubUsername: string; displayName: string | null }>;
      };
      expect(body.authors).toHaveLength(2);
      const usernames = body.authors.map((a) => a.githubUsername);
      expect(usernames).toContain('alice');
      expect(usernames).toContain('bob');
    });

    it('respects limit parameter', async () => {
      upsertAuthor(db, 'user1');
      upsertAuthor(db, 'user2');
      upsertAuthor(db, 'user3');

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/authors?limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { authors: unknown[] };
      expect(body.authors).toHaveLength(2);
    });
  });

  // ── GET /api/v1/community/authors/:username ──────────────────────────

  describe('GET /api/v1/community/authors/:username', () => {
    it('returns 404 for unknown username', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/authors/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('nonexistent');
    });

    it('returns author profile for existing author', async () => {
      upsertAuthor(db, 'carol', 'Carol Coder', 'https://avatars.example.com/carol');

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/authors/carol',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        author: {
          githubUsername: string;
          displayName: string;
          avatarUrl: string;
          publishedCount: number;
        };
      };
      expect(body.author.githubUsername).toBe('carol');
      expect(body.author.displayName).toBe('Carol Coder');
      expect(body.author.avatarUrl).toBe('https://avatars.example.com/carol');
      expect(body.author.publishedCount).toBe(0);
    });
  });

  // ── GET /api/v1/community/trust/:waveName ────────────────────────────

  describe('GET /api/v1/community/trust/:waveName', () => {
    it('computes and caches fresh trust score for unknown wave', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/trust/new-wave',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        waveName: string;
        score: number;
        tier: string;
        computedAt: string;
      };
      expect(body.waveName).toBe('new-wave');
      expect(typeof body.score).toBe('number');
      expect(body.score).toBeGreaterThanOrEqual(0);
      expect(body.score).toBeLessThanOrEqual(100);
      expect(typeof body.tier).toBe('string');
      expect(body.computedAt).toBeTruthy();
    });

    it('returns cached trust score if available', async () => {
      upsertTrustScore(db, {
        waveName: 'cached-wave',
        trustScore: 85,
        trustTier: 'trusted',
        scanPassed: true,
        sandboxPassed: true,
        highFindings: 0,
        criticalFindings: 0,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/trust/cached-wave',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        waveName: string;
        score: number;
        tier: string;
      };
      expect(body.waveName).toBe('cached-wave');
      expect(body.score).toBe(85);
      expect(body.tier).toBe('trusted');
    });

    it('returns correct tier based on score', async () => {
      // "unreviewed" tier: score 0-19
      upsertTrustScore(db, {
        waveName: 'unreviewed-wave',
        trustScore: 10,
        trustTier: 'unreviewed',
        scanPassed: false,
        sandboxPassed: false,
        highFindings: 2,
        criticalFindings: 1,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/trust/unreviewed-wave',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { tier: string; score: number };
      expect(body.tier).toBe('unreviewed');
      expect(body.score).toBe(10);
    });

    it('includes scan and sandbox information in response', async () => {
      upsertTrustScore(db, {
        waveName: 'detailed-wave',
        trustScore: 60,
        trustTier: 'community',
        scanPassed: true,
        sandboxPassed: false,
        highFindings: 1,
        criticalFindings: 0,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/community/trust/detailed-wave',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        scanPassed: boolean;
        sandboxPassed: boolean;
        highFindings: number;
        criticalFindings: number;
      };
      expect(body.scanPassed).toBe(true);
      expect(body.sandboxPassed).toBe(false);
      expect(body.highFindings).toBe(1);
      expect(body.criticalFindings).toBe(0);
    });
  });
});
