/**
 * Configuration route handlers.
 * GET  /api/v1/config — Retrieve all config key-value pairs.
 * PUT  /api/v1/config — Upsert a config key-value pair.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import { getAllConfig, setConfigValue } from '../../persistence/config-store.js';

const PutConfigBodySchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

/**
 * Register config endpoints on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerConfigRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  app.get('/api/v1/config', async (_request, reply) => {
    try {
      const entries = getAllConfig(db);
      return reply.status(200).send({ config: entries });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to retrieve config', detail: message });
    }
  });

  app.put('/api/v1/config', async (request, reply) => {
    try {
      const result = PutConfigBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          detail: result.error.issues.map(i => i.message).join('; '),
        });
      }

      setConfigValue(db, result.data.key, result.data.value);
      return reply.status(200).send({ ok: true, key: result.data.key });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to update config', detail: message });
    }
  });
}
