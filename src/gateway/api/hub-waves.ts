/**
 * Enhanced Waves Hub API routes.
 * Categories, featured, advanced search, wave detail, reviews, and stats.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { listCategories, getCategoriesWithCounts } from '../../persistence/wave-categories.js';
import { getFeaturedWaves, featureWave, unfeatureWave } from '../../persistence/featured-waves.js';
import { addReview, getReviews, getAverageRating, getAllAverageRatings } from '../../persistence/wave-reviews.js';
import { getInstallCount, getTopInstalled } from '../../persistence/wave-install-counts.js';
import { fetchRegistry } from '../../waves/hub-registry.js';
import { searchRegistryAdvanced, type RegistrySortOption } from '../../waves/hub-helpers.js';
import {
  registryEntryToWaveCard,
  type LocalWaveData,
} from '../../waves/wave-card-mapper.js';
import { listWaves } from '../../waves/hub.js';
import {
  getExecutionStats,
  getTopExecutedWaves,
  getExecutionCountsBySource,
} from '../../persistence/wave-executions.js';
import { getTrustScoresBatch } from '../../persistence/wave-community-trust.js';
import { getAuthor } from '../../persistence/wave-authors.js';
import { createModuleLogger } from '../../utils/logger.js';

const hubWavesLogger = createModuleLogger('hub-waves-api');

/**
 * Register enhanced Waves Hub API endpoints.
 * These extend the existing hub routes (in hub.ts) with marketplace features.
 *
 * @param app - The Fastify instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerHubWavesRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
): void {
  // ── GET /api/v1/hub/categories — list categories with counts ──────
  app.get('/api/v1/hub/categories', async (_request, reply) => {
    try {
      const registryWaves = await fetchRegistry(db);
      const categoryCounts = new Map<string, number>();

      for (const wave of registryWaves) {
        const cat = wave.category ?? 'uncategorized';
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
      }

      const categories = getCategoriesWithCounts(db, categoryCounts);
      return reply.send({ categories });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      hubWavesLogger.error({ error: message }, 'Failed to list categories');
      return reply.status(500).send({ error: 'Failed to list categories' } as never);
    }
  });

  // ── GET /api/v1/hub/featured — featured waves as WaveCards ────────
  app.get('/api/v1/hub/featured', async (_request, reply) => {
    try {
      const featured = getFeaturedWaves(db);
      const registryWaves = await fetchRegistry(db);
      const featuredNames = new Set(featured.map((f) => f.waveName));

      // Also include waves marked featured in the registry
      for (const wave of registryWaves) {
        if (wave.featured) featuredNames.add(wave.name);
      }

      const featuredCards = registryWaves
        .filter((w) => featuredNames.has(w.name))
        .map((entry) => registryEntryToWaveCard(entry, { installed: false, featured: true }));

      return reply.send({ featured: featuredCards });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      hubWavesLogger.error({ error: message }, 'Failed to get featured waves');
      return reply.status(500).send({ error: 'Failed to get featured waves' } as never);
    }
  });

  // ── POST /api/v1/hub/featured — feature a wave ────────────────────
  app.post<{
    Body: { waveName: string; reason?: string };
  }>('/api/v1/hub/featured', async (request, reply) => {
    try {
      const { waveName, reason } = request.body;
      if (!waveName) {
        return reply.status(400).send({ error: 'waveName is required' } as never);
      }
      featureWave(db, waveName, reason);
      return reply.status(201).send({ message: `Wave "${waveName}" featured` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // ── DELETE /api/v1/hub/featured/:name — unfeature a wave ──────────
  app.delete<{
    Params: { name: string };
  }>('/api/v1/hub/featured/:name', async (request, reply) => {
    try {
      unfeatureWave(db, request.params.name);
      return reply.send({ message: 'Wave unfeatured' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // ── GET /api/v1/hub/browse — enhanced registry browse with filters ─
  app.get<{
    Querystring: {
      q?: string;
      category?: string;
      tags?: string;
      sort?: string;
      party?: string;
      limit?: string;
      offset?: string;
      trust?: string;
      author?: string;
      minRating?: string;
    };
  }>('/api/v1/hub/browse', async (request, reply) => {
    try {
      const registryWaves = await fetchRegistry(db);
      const localWaves = listWaves(db);
      const { q, category, tags, sort, party, limit, offset, trust, author, minRating } = request.query;

      const filteredWaves = searchRegistryAdvanced(registryWaves, {
        query: q,
        category,
        tags: tags ? tags.split(',') : undefined,
        sort: (sort as RegistrySortOption) || 'popular',
        isPartyWave: party === 'true' ? true : party === 'false' ? false : undefined,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
        trust,
        author,
        minRating: minRating ? parseFloat(minRating) : undefined,
      });

      // Merge with local data and trust scores
      const localDataMap = new Map<string, LocalWaveData>();
      for (const wave of localWaves) {
        localDataMap.set(wave.name, { installed: true });
      }

      // Batch-fetch trust scores for all waves in results
      const waveNames = filteredWaves.map((w) => w.name);
      const trustScores = getTrustScoresBatch(db, waveNames);

      const cards = filteredWaves.map((entry) => {
        const localData = localDataMap.get(entry.name) ?? { installed: false };
        const trustEntry = trustScores.get(entry.name);
        return registryEntryToWaveCard(entry, {
          ...localData,
          trustScore: trustEntry?.trustScore ?? entry.communityTrust ?? null,
          trustTier: trustEntry?.trustTier ?? null,
        });
      });

      return reply.send({ waves: cards, total: cards.length });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      hubWavesLogger.error({ error: message }, 'Failed to browse waves');
      return reply.status(500).send({ error: 'Failed to browse waves' } as never);
    }
  });

  // ── GET /api/v1/hub/waves/:name/detail — full wave detail ─────────
  app.get<{
    Params: { name: string };
  }>('/api/v1/hub/waves/:name/detail', async (request, reply) => {
    try {
      const { name } = request.params;
      const registryWaves = await fetchRegistry(db);
      const localWaves = listWaves(db);

      const entry = registryWaves.find((w) => w.name === name);
      if (!entry) {
        return reply.status(404).send({ error: `Wave "${name}" not found in registry` } as never);
      }

      const isInstalled = localWaves.some((w) => w.name === name);
      const installCount = getInstallCount(db, name);
      const ratingAggregate = getAverageRating(db, name);
      const reviews = getReviews(db, name, 10);

      const execStats = getExecutionStats(db, name);

      // Fetch trust and author data
      const trustScoreMap = getTrustScoresBatch(db, [name]);
      const trustEntry = trustScoreMap.get(name);
      const authorProfile = entry.author ? getAuthor(db, entry.author) : null;

      const card = registryEntryToWaveCard(entry, {
        installed: isInstalled,
        localInstallCount: installCount,
        localAverageRating: ratingAggregate?.averageRating,
        localRatingCount: ratingAggregate?.ratingCount,
        executionCount: execStats?.totalExecutions,
        successRate: execStats?.successRate,
        lastExecutedAt: execStats?.lastExecutedAt,
        trustScore: trustEntry?.trustScore ?? entry.communityTrust ?? null,
        trustTier: trustEntry?.trustTier ?? null,
        authorProfile: authorProfile ? {
          githubUsername: authorProfile.githubUsername,
          displayName: authorProfile.displayName,
          avatarUrl: authorProfile.avatarUrl,
        } : null,
      });

      return reply.send({
        wave: card,
        reviews,
        executionStats: execStats ? {
          totalExecutions: execStats.totalExecutions,
          successCount: execStats.successCount,
          failureCount: execStats.failureCount,
          successRate: execStats.successRate,
          avgExecutionTimeMs: execStats.avgExecutionTimeMs,
          lastExecutedAt: execStats.lastExecutedAt,
        } : null,
        trust: trustEntry ? {
          score: trustEntry.trustScore,
          tier: trustEntry.trustTier,
          scanPassed: trustEntry.scanPassed,
          sandboxPassed: trustEntry.sandboxPassed,
          highFindings: trustEntry.highFindings,
          criticalFindings: trustEntry.criticalFindings,
          computedAt: trustEntry.computedAt.toISOString(),
        } : null,
        author: authorProfile ? {
          githubUsername: authorProfile.githubUsername,
          displayName: authorProfile.displayName,
          avatarUrl: authorProfile.avatarUrl,
          publishedCount: authorProfile.publishedCount,
          totalInstalls: authorProfile.totalInstalls,
          averageRating: authorProfile.averageRating,
        } : null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // ── GET /api/v1/hub/waves/:name/reviews — reviews for a wave ──────
  app.get<{
    Params: { name: string };
    Querystring: { limit?: string };
  }>('/api/v1/hub/waves/:name/reviews', async (request, reply) => {
    try {
      const { name } = request.params;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const reviews = getReviews(db, name, limit);
      const aggregate = getAverageRating(db, name);

      return reply.send({
        reviews,
        averageRating: aggregate?.averageRating ?? 0,
        ratingCount: aggregate?.ratingCount ?? 0,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // ── POST /api/v1/hub/waves/:name/reviews — add a review ──────────
  app.post<{
    Params: { name: string };
    Body: { rating: number; comment?: string; reviewer?: string };
  }>('/api/v1/hub/waves/:name/reviews', async (request, reply) => {
    try {
      const { name } = request.params;
      const { rating, comment, reviewer } = request.body;

      if (!rating || rating < 1 || rating > 5) {
        return reply.status(400).send({
          error: 'rating must be an integer between 1 and 5',
        } as never);
      }

      const review = addReview(db, {
        waveName: name,
        rating,
        comment,
        reviewer,
      });

      return reply.status(201).send(review);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message } as never);
    }
  });

  // ── GET /api/v1/hub/stats — aggregate hub stats ───────────────────
  app.get('/api/v1/hub/stats', async (_request, reply) => {
    try {
      const registryWaves = await fetchRegistry(db);
      const localWaves = listWaves(db);
      const topInstalled = getTopInstalled(db, 5);
      const allRatings = getAllAverageRatings(db);
      const categories = listCategories(db);
      const featured = getFeaturedWaves(db);
      const topExecuted = getTopExecutedWaves(db, 5);
      const executionsBySource = getExecutionCountsBySource(db);
      const totalExecutions = executionsBySource.bundled
        + executionsBySource.installed
        + executionsBySource.generated;

      return reply.send({
        stats: {
          registryCount: registryWaves.length,
          installedCount: localWaves.length,
          categoryCount: categories.length,
          featuredCount: featured.length,
          totalExecutions,
          executionsBySource,
          topInstalled: topInstalled.map((t) => ({
            waveName: t.waveName,
            installCount: t.installCount,
          })),
          topRated: allRatings.slice(0, 5).map((r) => ({
            waveName: r.waveName,
            averageRating: r.averageRating,
            ratingCount: r.ratingCount,
          })),
          topExecuted: topExecuted.map((t) => ({
            waveName: t.waveName,
            executionCount: t.executionCount,
            successRate: t.successRate,
          })),
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      hubWavesLogger.error({ error: message }, 'Failed to get hub stats');
      return reply.status(500).send({ error: 'Failed to get hub stats' } as never);
    }
  });
}
