/**
 * Community publishing API routes.
 * Provides endpoints for publishing waves, viewing publish history,
 * author profiles, and trust score breakdowns.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { packageWave } from '../../waves/packager.js';
import { publishToRegistry } from '../../waves/publisher.js';
import { computeTrustScore, getTrustTier, emptyTrustFactors } from '../../waves/community-trust.js';
import { getAuthor, listAuthors } from '../../persistence/wave-authors.js';
import { getTrustScore, upsertTrustScore } from '../../persistence/wave-community-trust.js';
import { recordPublish, listPublishHistory } from '../../persistence/wave-publish-history.js';
import { getAverageRating } from '../../persistence/wave-reviews.js';
import { getInstallCount } from '../../persistence/wave-install-counts.js';
import { createModuleLogger } from '../../utils/logger.js';

const communityLogger = createModuleLogger('community-api');

/**
 * Register community publishing API endpoints.
 *
 * @param app - The Fastify instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerCommunityRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
): void {
  // ── POST /api/v1/community/validate — validate a wave for publishing ──
  app.post<{
    Body: { wavePath: string; skipSandbox?: boolean };
  }>('/api/v1/community/validate', async (request, reply) => {
    try {
      const { wavePath, skipSandbox } = request.body;
      if (!wavePath) {
        return reply.status(400).send({ error: 'wavePath is required' } as never);
      }

      const result = await packageWave(wavePath, { skipSandbox });

      return reply.send({
        valid: true,
        manifest: {
          name: result.manifest.name,
          version: result.manifest.version,
          description: result.manifest.description,
          author: result.manifest.author,
          safetyTier: result.manifest.safetyTier ?? 'observe',
          deterministic: result.manifest.deterministic,
          category: result.manifest.category ?? 'uncategorized',
        },
        scanResult: {
          passed: result.scanResult.passed,
          summary: result.scanResult.summary,
          findingCount: result.scanResult.findings.length,
        },
        sandboxResult: result.sandboxResult
          ? { success: result.sandboxResult.success, error: result.sandboxResult.error }
          : null,
        packageHash: result.packageHash,
        totalSizeBytes: result.totalSizeBytes,
        fileCount: result.files.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      communityLogger.error({ error: message }, 'Validation failed');
      return reply.status(400).send({ error: message } as never);
    }
  });

  // ── POST /api/v1/community/publish — publish a wave via GitHub PR ─────
  app.post<{
    Body: { wavePath: string; githubToken: string; registryRepo?: string; skipSandbox?: boolean };
  }>('/api/v1/community/publish', async (request, reply) => {
    try {
      const { wavePath, githubToken, registryRepo, skipSandbox } = request.body;
      if (!wavePath || !githubToken) {
        return reply.status(400).send({
          error: 'wavePath and githubToken are required',
        } as never);
      }

      // Package the wave
      const pkg = await packageWave(wavePath, { skipSandbox });

      // Publish to registry
      const publishResult = await publishToRegistry(pkg, {
        githubToken,
        registryRepo,
      });

      // Record in publish history
      recordPublish(
        db,
        pkg.manifest.name,
        pkg.manifest.version,
        publishResult.prUrl,
        publishResult.prNumber,
      );

      return reply.status(201).send({
        prUrl: publishResult.prUrl,
        prNumber: publishResult.prNumber,
        branch: publishResult.branch,
        waveName: pkg.manifest.name,
        version: pkg.manifest.version,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      communityLogger.error({ error: message }, 'Publish failed');
      return reply.status(400).send({ error: message } as never);
    }
  });

  // ── GET /api/v1/community/publish/history — publish history ───────────
  app.get<{
    Querystring: { limit?: string };
  }>('/api/v1/community/publish/history', async (request, reply) => {
    try {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const history = listPublishHistory(db, limit);
      return reply.send({ submissions: history });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // ── GET /api/v1/community/authors — list community authors ────────────
  app.get<{
    Querystring: { limit?: string };
  }>('/api/v1/community/authors', async (request, reply) => {
    try {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const authors = listAuthors(db, limit);
      return reply.send({ authors });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // ── GET /api/v1/community/authors/:username — author profile ──────────
  app.get<{
    Params: { username: string };
  }>('/api/v1/community/authors/:username', async (request, reply) => {
    try {
      const { username } = request.params;
      const author = getAuthor(db, username);

      if (!author) {
        return reply.status(404).send({ error: `Author "${username}" not found` } as never);
      }

      return reply.send({ author });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // ── GET /api/v1/community/trust/:waveName — trust score breakdown ─────
  app.get<{
    Params: { waveName: string };
  }>('/api/v1/community/trust/:waveName', async (request, reply) => {
    try {
      const { waveName } = request.params;

      // Check for cached trust score
      const cached = getTrustScore(db, waveName);
      if (cached) {
        return reply.send({
          waveName,
          score: cached.trustScore,
          tier: cached.trustTier,
          scanPassed: cached.scanPassed,
          sandboxPassed: cached.sandboxPassed,
          highFindings: cached.highFindings,
          criticalFindings: cached.criticalFindings,
          computedAt: cached.computedAt.toISOString(),
        });
      }

      // Compute fresh from available data
      const ratingAggregate = getAverageRating(db, waveName);
      const installCount = getInstallCount(db, waveName);

      const factors = {
        ...emptyTrustFactors(),
        reviewCount: ratingAggregate?.ratingCount ?? 0,
        averageRating: ratingAggregate?.averageRating ?? 0,
        installCount,
      };

      const score = computeTrustScore(factors);
      const tier = getTrustTier(score);

      // Cache the result
      upsertTrustScore(db, {
        waveName,
        trustScore: score,
        trustTier: tier,
        scanPassed: factors.scanPassed,
        sandboxPassed: factors.sandboxPassed,
        highFindings: factors.highFindings,
        criticalFindings: factors.criticalFindings,
      });

      return reply.send({
        waveName,
        score,
        tier,
        scanPassed: factors.scanPassed,
        sandboxPassed: factors.sandboxPassed,
        highFindings: factors.highFindings,
        criticalFindings: factors.criticalFindings,
        computedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });
}
