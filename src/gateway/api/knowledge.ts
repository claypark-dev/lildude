/**
 * Knowledge route handlers.
 * GET    /api/v1/knowledge — List/search knowledge entries.
 * POST   /api/v1/knowledge — Create a new knowledge entry.
 * DELETE /api/v1/knowledge — Delete a knowledge entry by ID.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import {
  upsertKnowledge,
  getKnowledgeByCategory,
  searchKnowledge,
  deleteKnowledge,
} from '../../persistence/knowledge.js';

/** Query parameters for the knowledge list endpoint. */
interface KnowledgeQuerystring {
  category?: string;
  search?: string;
}

const CreateKnowledgeBodySchema = z.object({
  category: z.string().min(1),
  key: z.string().min(1),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

const DeleteKnowledgeBodySchema = z.object({
  id: z.number().int().positive(),
});

/**
 * Register knowledge endpoints on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerKnowledgeRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  app.get<{ Querystring: KnowledgeQuerystring }>(
    '/api/v1/knowledge',
    async (request, reply) => {
      try {
        const { category, search } = request.query;

        if (search) {
          const results = searchKnowledge(db, search, category);
          return reply.status(200).send({ knowledge: results, count: results.length });
        }

        if (category) {
          const results = getKnowledgeByCategory(db, category);
          return reply.status(200).send({ knowledge: results, count: results.length });
        }

        // Return empty when no filters provided — avoid unbounded queries
        return reply.status(200).send({ knowledge: [], count: 0 });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: 'Failed to retrieve knowledge', detail: message });
      }
    },
  );

  app.post('/api/v1/knowledge', async (request, reply) => {
    try {
      const result = CreateKnowledgeBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          detail: result.error.issues.map(i => i.message).join('; '),
        });
      }

      const entry = upsertKnowledge(db, result.data);
      return reply.status(201).send({ knowledge: entry });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to create knowledge entry', detail: message });
    }
  });

  app.delete('/api/v1/knowledge', async (request, reply) => {
    try {
      const result = DeleteKnowledgeBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          detail: result.error.issues.map(i => i.message).join('; '),
        });
      }

      const deleted = deleteKnowledge(db, result.data.id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Knowledge entry not found' });
      }

      return reply.status(200).send({ ok: true, id: result.data.id });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to delete knowledge entry', detail: message });
    }
  });
}
