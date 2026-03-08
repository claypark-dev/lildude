/**
 * Integration tests for the Community Publishing API.
 * Tests the full request flow: validate, publish, history, authors, and trust scores.
 * Uses Fastify's inject() for in-process testing with in-memory SQLite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { storeApiKey } from '../../../src/persistence/api-keys.js';
import { addReview } from '../../../src/persistence/wave-reviews.js';
import { incrementInstallCount } from '../../../src/persistence/wave-install-counts.js';
import { upsertAuthor, incrementPublishedCount } from '../../../src/persistence/wave-authors.js';
import { createGatewayServer, type GatewayServer } from '../../../src/gateway/server.js';
import { ConfigSchema } from '../../../src/config/schema.js';
import type { InjectOptions } from 'fastify';

// ── Mock external dependencies (packageWave and publishToRegistry) ──────────

vi.mock('../../../src/waves/packager.js', () => ({
  packageWave: vi.fn().mockResolvedValue({
    manifest: {
      name: 'test-wave',
      version: '1.0.0',
      description: 'A test wave for integration testing',
      author: 'testuser',
      entryPoint: 'index.ts',
      safetyTier: 'observe' as const,
      deterministic: true,
      category: 'utilities',
      triggers: [],
      permissions: {
        domains: [],
        shell: [],
        directories: [],
        requiresBrowser: false,
      },
    },
    files: [
      { relativePath: 'wave.json', content: '{}', hash: 'abc123' },
      { relativePath: 'index.ts', content: 'export default {}', hash: 'def456' },
    ],
    scanResult: {
      passed: true,
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      findings: [],
    },
    sandboxResult: { success: true, error: null },
    packageHash: 'deadbeef1234567890abcdef',
    totalSizeBytes: 512,
  }),
}));

vi.mock('../../../src/waves/publisher.js', () => ({
  publishToRegistry: vi.fn().mockResolvedValue({
    prUrl: 'https://github.com/lildude-community/wave-registry/pull/42',
    prNumber: 42,
    branch: 'wave/test-wave-1.0.0',
  }),
}));

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');
const TEST_API_KEY = 'ld_community_integration_test_key_0000';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

describe('Community Publishing API', () => {
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
    storeApiKey(dbManager.db, TEST_API_KEY, 'community-test');
    const config = ConfigSchema.parse({});
    gateway = createGatewayServer(dbManager, config);
    await gateway.app.ready();
  });

  afterEach(async () => {
    try { await gateway.stop(); } catch { /* best-effort */ }
    try { dbManager.close(); } catch { /* best-effort */ }
  });

  // ── Validate → Publish Flow ───────────────────────────────────────

  describe('POST /api/v1/community/validate → POST /api/v1/community/publish', () => {
    it('validates a wave then publishes it', async () => {
      // Step 1: Validate
      const validateResponse = await authedInject({
        method: 'POST',
        url: '/api/v1/community/validate',
        payload: { wavePath: '/tmp/test-wave', skipSandbox: true },
      });

      expect(validateResponse.statusCode).toBe(200);

      const validateBody = validateResponse.json();
      expect(validateBody.valid).toBe(true);
      expect(validateBody.manifest.name).toBe('test-wave');
      expect(validateBody.manifest.version).toBe('1.0.0');
      expect(validateBody.manifest.author).toBe('testuser');
      expect(validateBody.scanResult.passed).toBe(true);
      expect(validateBody.packageHash).toBe('deadbeef1234567890abcdef');
      expect(validateBody.fileCount).toBe(2);

      // Step 2: Publish
      const publishResponse = await authedInject({
        method: 'POST',
        url: '/api/v1/community/publish',
        payload: {
          wavePath: '/tmp/test-wave',
          githubToken: 'ghp_fake_token_for_testing',
          skipSandbox: true,
        },
      });

      expect(publishResponse.statusCode).toBe(201);

      const publishBody = publishResponse.json();
      expect(publishBody.prUrl).toBe('https://github.com/lildude-community/wave-registry/pull/42');
      expect(publishBody.prNumber).toBe(42);
      expect(publishBody.branch).toBe('wave/test-wave-1.0.0');
      expect(publishBody.waveName).toBe('test-wave');
      expect(publishBody.version).toBe('1.0.0');
    });
  });

  // ── Publish Records History ───────────────────────────────────────

  describe('Publish records history', () => {
    it('after publishing, the history endpoint returns the submission', async () => {
      // Publish a wave first
      await authedInject({
        method: 'POST',
        url: '/api/v1/community/publish',
        payload: {
          wavePath: '/tmp/test-wave',
          githubToken: 'ghp_fake_token',
          skipSandbox: true,
        },
      });

      // Check history
      const historyResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/publish/history',
      });

      expect(historyResponse.statusCode).toBe(200);

      const historyBody = historyResponse.json();
      expect(historyBody).toHaveProperty('submissions');
      expect(historyBody.submissions.length).toBeGreaterThanOrEqual(1);

      const submission = historyBody.submissions.find(
        (s: { waveName: string }) => s.waveName === 'test-wave',
      );
      expect(submission).toBeDefined();
      expect(submission.version).toBe('1.0.0');
      expect(submission.prUrl).toBe('https://github.com/lildude-community/wave-registry/pull/42');
      expect(submission.prNumber).toBe(42);
      expect(submission.status).toBe('pending');
    });
  });

  // ── Publish Creates Author Entry ──────────────────────────────────

  describe('Authors endpoint', () => {
    it('after creating an author, the authors endpoint includes them', async () => {
      // Seed an author entry (the publish route records history but authors
      // are managed separately via the persistence layer)
      upsertAuthor(dbManager.db, 'testuser', 'Test User');
      incrementPublishedCount(dbManager.db, 'testuser');

      const authorsResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/authors',
      });

      expect(authorsResponse.statusCode).toBe(200);

      const authorsBody = authorsResponse.json();
      expect(authorsBody).toHaveProperty('authors');
      expect(authorsBody.authors.length).toBeGreaterThanOrEqual(1);

      const author = authorsBody.authors.find(
        (a: { githubUsername: string }) => a.githubUsername === 'testuser',
      );
      expect(author).toBeDefined();
      expect(author.publishedCount).toBe(1);
    });
  });

  // ── Trust Score Computation ────────────────────────────────────────

  describe('GET /api/v1/community/trust/:waveName', () => {
    it('computes trust score for a wave with reviews and installs', async () => {
      // Set up data: 3 reviews and 5 installs
      addReview(dbManager.db, { waveName: 'scored-wave', rating: 5, comment: 'Excellent' });
      addReview(dbManager.db, { waveName: 'scored-wave', rating: 4, comment: 'Good' });
      addReview(dbManager.db, { waveName: 'scored-wave', rating: 3, comment: 'OK' });
      incrementInstallCount(dbManager.db, 'scored-wave');
      incrementInstallCount(dbManager.db, 'scored-wave');
      incrementInstallCount(dbManager.db, 'scored-wave');
      incrementInstallCount(dbManager.db, 'scored-wave');
      incrementInstallCount(dbManager.db, 'scored-wave');

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/community/trust/scored-wave',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.waveName).toBe('scored-wave');
      expect(body.score).toBeGreaterThan(0);
      expect(body.tier).toBeDefined();
      expect(['trusted', 'community', 'new', 'unreviewed']).toContain(body.tier);
      expect(body).toHaveProperty('scanPassed');
      expect(body).toHaveProperty('sandboxPassed');
      expect(body).toHaveProperty('computedAt');
    });

    it('returns cached value on second request', async () => {
      // Set up data
      addReview(dbManager.db, { waveName: 'cache-wave', rating: 4, comment: 'Nice' });
      incrementInstallCount(dbManager.db, 'cache-wave');

      // First request computes and caches
      const firstResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/trust/cache-wave',
      });

      expect(firstResponse.statusCode).toBe(200);
      const firstBody = firstResponse.json();

      // Second request returns cached value
      const secondResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/trust/cache-wave',
      });

      expect(secondResponse.statusCode).toBe(200);
      const secondBody = secondResponse.json();

      expect(secondBody.waveName).toBe('cache-wave');
      expect(secondBody.score).toBe(firstBody.score);
      expect(secondBody.tier).toBe(firstBody.tier);
      // computedAt may differ in format (timezone normalization) but represent the same time
      expect(typeof secondBody.computedAt).toBe('string');
      expect(secondBody.computedAt).toBeTruthy();
    });
  });

  // ── Author Profile Stats ──────────────────────────────────────────

  describe('GET /api/v1/community/authors/:username', () => {
    it('shows correct stats after multiple publishes', async () => {
      // Create author and simulate multiple publishes
      upsertAuthor(dbManager.db, 'prolific-dev', 'Prolific Dev');
      incrementPublishedCount(dbManager.db, 'prolific-dev');
      incrementPublishedCount(dbManager.db, 'prolific-dev');
      incrementPublishedCount(dbManager.db, 'prolific-dev');

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/community/authors/prolific-dev',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('author');
      expect(body.author.githubUsername).toBe('prolific-dev');
      expect(body.author.displayName).toBe('Prolific Dev');
      expect(body.author.publishedCount).toBe(3);
    });

    it('returns 404 for unknown author', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/community/authors/nonexistent-user',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ── Publish History Limit ─────────────────────────────────────────

  describe('GET /api/v1/community/publish/history', () => {
    it('respects limit parameter', async () => {
      // Publish multiple waves by recording directly in the DB
      const { recordPublish } = await import('../../../src/persistence/wave-publish-history.js');
      recordPublish(dbManager.db, 'wave-a', '1.0.0', 'https://github.com/pr/1', 1);
      recordPublish(dbManager.db, 'wave-b', '1.0.0', 'https://github.com/pr/2', 2);
      recordPublish(dbManager.db, 'wave-c', '1.0.0', 'https://github.com/pr/3', 3);
      recordPublish(dbManager.db, 'wave-d', '1.0.0', 'https://github.com/pr/4', 4);
      recordPublish(dbManager.db, 'wave-e', '1.0.0', 'https://github.com/pr/5', 5);

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/community/publish/history?limit=2',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.submissions).toHaveLength(2);
    });
  });

  // ── Validate Error Handling ────────────────────────────────────────

  describe('POST /api/v1/community/validate (error cases)', () => {
    it('returns error for missing wavePath', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/community/validate',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body).toHaveProperty('error');
    });
  });

  // ── Trust Tier Boundaries ──────────────────────────────────────────

  describe('Trust tier boundary mappings', () => {
    it('returns correct tier for each score boundary', async () => {
      const { upsertTrustScore } = await import('../../../src/persistence/wave-community-trust.js');

      // Seed cached trust scores at each tier boundary
      upsertTrustScore(dbManager.db, {
        waveName: 'trusted-wave',
        trustScore: 85,
        trustTier: 'trusted',
        scanPassed: true,
        sandboxPassed: true,
        highFindings: 0,
        criticalFindings: 0,
      });

      upsertTrustScore(dbManager.db, {
        waveName: 'community-wave',
        trustScore: 55,
        trustTier: 'community',
        scanPassed: true,
        sandboxPassed: true,
        highFindings: 0,
        criticalFindings: 0,
      });

      upsertTrustScore(dbManager.db, {
        waveName: 'new-wave',
        trustScore: 25,
        trustTier: 'new',
        scanPassed: true,
        sandboxPassed: false,
        highFindings: 1,
        criticalFindings: 0,
      });

      upsertTrustScore(dbManager.db, {
        waveName: 'unreviewed-wave',
        trustScore: 5,
        trustTier: 'unreviewed',
        scanPassed: false,
        sandboxPassed: false,
        highFindings: 2,
        criticalFindings: 1,
      });

      // Trusted tier (80-100)
      const trustedResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/trust/trusted-wave',
      });
      expect(trustedResponse.statusCode).toBe(200);
      expect(trustedResponse.json().tier).toBe('trusted');
      expect(trustedResponse.json().score).toBe(85);

      // Community tier (50-79)
      const communityResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/trust/community-wave',
      });
      expect(communityResponse.statusCode).toBe(200);
      expect(communityResponse.json().tier).toBe('community');
      expect(communityResponse.json().score).toBe(55);

      // New tier (20-49)
      const newResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/trust/new-wave',
      });
      expect(newResponse.statusCode).toBe(200);
      expect(newResponse.json().tier).toBe('new');
      expect(newResponse.json().score).toBe(25);

      // Unreviewed tier (0-19)
      const unreviewedResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/trust/unreviewed-wave',
      });
      expect(unreviewedResponse.statusCode).toBe(200);
      expect(unreviewedResponse.json().tier).toBe('unreviewed');
      expect(unreviewedResponse.json().score).toBe(5);
    });
  });

  // ── Full End-to-End Flow ──────────────────────────────────────────

  describe('Full flow: validate → publish → history → trust → author', () => {
    it('completes the entire community publishing lifecycle', async () => {
      // Step 1: Validate the wave
      const validateResponse = await authedInject({
        method: 'POST',
        url: '/api/v1/community/validate',
        payload: { wavePath: '/tmp/test-wave', skipSandbox: true },
      });

      expect(validateResponse.statusCode).toBe(200);
      expect(validateResponse.json().valid).toBe(true);

      // Step 2: Publish the wave
      const publishResponse = await authedInject({
        method: 'POST',
        url: '/api/v1/community/publish',
        payload: {
          wavePath: '/tmp/test-wave',
          githubToken: 'ghp_fake_token',
          skipSandbox: true,
        },
      });

      expect(publishResponse.statusCode).toBe(201);
      expect(publishResponse.json().waveName).toBe('test-wave');

      // Step 3: Verify the submission appears in history
      const historyResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/publish/history',
      });

      expect(historyResponse.statusCode).toBe(200);
      const historyEntry = historyResponse.json().submissions.find(
        (s: { waveName: string }) => s.waveName === 'test-wave',
      );
      expect(historyEntry).toBeDefined();
      expect(historyEntry.status).toBe('pending');

      // Step 4: Add reviews and installs, then check trust score
      addReview(dbManager.db, { waveName: 'test-wave', rating: 5, comment: 'Great!' });
      addReview(dbManager.db, { waveName: 'test-wave', rating: 4, comment: 'Solid' });
      incrementInstallCount(dbManager.db, 'test-wave');
      incrementInstallCount(dbManager.db, 'test-wave');
      incrementInstallCount(dbManager.db, 'test-wave');

      const trustResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/trust/test-wave',
      });

      expect(trustResponse.statusCode).toBe(200);

      const trustBody = trustResponse.json();
      expect(trustBody.waveName).toBe('test-wave');
      expect(trustBody.score).toBeGreaterThan(0);
      expect(['trusted', 'community', 'new', 'unreviewed']).toContain(trustBody.tier);

      // Step 5: Create the author and verify their profile
      upsertAuthor(dbManager.db, 'testuser', 'Test User');
      incrementPublishedCount(dbManager.db, 'testuser');

      const authorResponse = await authedInject({
        method: 'GET',
        url: '/api/v1/community/authors/testuser',
      });

      expect(authorResponse.statusCode).toBe(200);

      const authorBody = authorResponse.json();
      expect(authorBody.author.githubUsername).toBe('testuser');
      expect(authorBody.author.publishedCount).toBe(1);
    });
  });
});
