/**
 * Wave Hub API route handlers.
 * Exposes wave installation, uninstallation, listing, search,
 * rating, and MCP server management endpoints.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import type { SecurityLevel } from '../../security/permissions.js';
import { installWave, listWaves, uninstallWave } from '../../waves/hub.js';
import { fetchRegistry, searchRegistry } from '../../waves/hub-registry.js';
import {
  rateWave,
  getWaveRating,
  getAllWaveRatings,
} from '../../persistence/wave-hub-cache.js';
import {
  loadMcpServerConfigs,
  saveMcpServerConfig,
  deleteMcpServerConfig,
  type McpServerConfig,
} from '../../integrations/mcp-client.js';
import { createModuleLogger } from '../../utils/logger.js';

const hubApiLogger = createModuleLogger('hub-api');

/**
 * Register Wave Hub REST endpoints.
 *
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerHubRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
): void {
  // GET /api/v1/hub/waves — List installed waves
  app.get('/api/v1/hub/waves', async (_request, reply) => {
    try {
      const waves = listWaves(db);
      return reply.status(200).send({ waves });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      hubApiLogger.error({ error: message }, 'Failed to list waves');
      return reply.status(500).send({ error: 'Failed to list waves' } as never);
    }
  });

  // GET /api/v1/hub/registry — Browse the curated registry
  app.get<{ Querystring: { q?: string } }>(
    '/api/v1/hub/registry',
    async (request, reply) => {
      try {
        const allWaves = await fetchRegistry(db);
        const query = request.query.q;

        const waves = query ? searchRegistry(allWaves, query) : allWaves;
        return reply.status(200).send({ waves, total: waves.length });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        hubApiLogger.error({ error: message }, 'Failed to fetch registry');
        return reply.status(500).send({ error: 'Failed to fetch registry' } as never);
      }
    },
  );

  // POST /api/v1/hub/install — Install a wave from GitHub
  app.post<{
    Body: { source: string; securityLevel?: number };
  }>('/api/v1/hub/install', async (request, reply) => {
    try {
      const { source, securityLevel } = request.body;

      if (!source) {
        return reply.status(400).send({
          error: 'source is required (format: github:user/repo)',
        } as never);
      }

      const level = (securityLevel ?? 3) as SecurityLevel;
      const manifest = await installWave(db, source, level);

      hubApiLogger.info({ source, name: manifest.name }, 'Wave installed via API');

      return reply.status(201).send({
        message: `Wave "${manifest.name}" installed successfully`,
        name: manifest.name,
        version: manifest.version,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      hubApiLogger.error({ error: message }, 'Failed to install wave');
      const statusCode = message.includes('SecurityError') ? 403 : 400;
      return reply.status(statusCode).send({ error: message } as never);
    }
  });

  // DELETE /api/v1/hub/waves/:name — Uninstall a wave
  app.delete<{ Params: { name: string } }>(
    '/api/v1/hub/waves/:name',
    async (request, reply) => {
      try {
        const { name } = request.params;
        await uninstallWave(db, name);

        hubApiLogger.info({ name }, 'Wave uninstalled via API');

        return reply.status(200).send({
          message: `Wave "${name}" uninstalled successfully`,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        hubApiLogger.error({ error: message }, 'Failed to uninstall wave');
        return reply.status(400).send({ error: message } as never);
      }
    },
  );

  // POST /api/v1/hub/waves/:name/rate — Rate a wave
  app.post<{
    Params: { name: string };
    Body: { rating: number; comment?: string };
  }>('/api/v1/hub/waves/:name/rate', async (request, reply) => {
    try {
      const { name } = request.params;
      const { rating, comment } = request.body;

      if (!rating || rating < 1 || rating > 5) {
        return reply.status(400).send({
          error: 'rating must be an integer between 1 and 5',
        } as never);
      }

      rateWave(db, name, rating, comment);

      return reply.status(200).send({ message: 'Rating saved', name, rating });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // GET /api/v1/hub/waves/:name/rating — Get wave rating
  app.get<{ Params: { name: string } }>(
    '/api/v1/hub/waves/:name/rating',
    async (request, reply) => {
      try {
        const rating = getWaveRating(db, request.params.name);
        if (!rating) {
          return reply.status(404).send({ error: 'No rating found' } as never);
        }
        return reply.status(200).send(rating);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message } as never);
      }
    },
  );

  // GET /api/v1/hub/ratings — Get all wave ratings
  app.get('/api/v1/hub/ratings', async (_request, reply) => {
    try {
      const ratings = getAllWaveRatings(db);
      return reply.status(200).send({ ratings });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // GET /api/v1/hub/mcp — List MCP server configurations
  app.get('/api/v1/hub/mcp', async (_request, reply) => {
    try {
      const servers = loadMcpServerConfigs(db);
      return reply.status(200).send({ servers });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // POST /api/v1/hub/mcp — Add an MCP server
  app.post<{
    Body: McpServerConfig;
  }>('/api/v1/hub/mcp', async (request, reply) => {
    try {
      const config = request.body;

      if (!config.name || !config.transport) {
        return reply.status(400).send({
          error: 'name and transport are required',
        } as never);
      }

      saveMcpServerConfig(db, config);

      return reply.status(201).send({
        message: `MCP server "${config.name}" saved`,
        name: config.name,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message } as never);
    }
  });

  // DELETE /api/v1/hub/mcp/:name — Remove an MCP server
  app.delete<{ Params: { name: string } }>(
    '/api/v1/hub/mcp/:name',
    async (request, reply) => {
      try {
        const deleted = deleteMcpServerConfig(db, request.params.name);
        if (!deleted) {
          return reply.status(404).send({ error: 'MCP server not found' } as never);
        }
        return reply.status(200).send({ message: 'MCP server removed' });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message } as never);
      }
    },
  );
}
