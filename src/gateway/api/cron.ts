/**
 * Cron jobs route handlers.
 * GET    /api/v1/cron — List all cron jobs.
 * POST   /api/v1/cron — Create a new cron job.
 * DELETE /api/v1/cron — Delete a cron job by ID.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import {
  createCronJob,
  getEnabledCronJobs,
  deleteCronJob,
} from '../../persistence/cron-jobs.js';

const CreateCronBodySchema = z.object({
  schedule: z.string().min(1),
  taskDescription: z.string().min(1),
  skillId: z.string().optional(),
  usesAi: z.boolean().optional(),
  estimatedCostPerRun: z.number().optional(),
});

const DeleteCronBodySchema = z.object({
  id: z.string().min(1),
});

/**
 * Register cron job endpoints on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerCronRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  app.get('/api/v1/cron', async (_request, reply) => {
    try {
      const jobs = getEnabledCronJobs(db);
      return reply.status(200).send({ jobs, count: jobs.length });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to retrieve cron jobs', detail: message });
    }
  });

  app.post('/api/v1/cron', async (request, reply) => {
    try {
      const result = CreateCronBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          detail: result.error.issues.map(i => i.message).join('; '),
        });
      }

      const job = createCronJob(db, result.data);
      return reply.status(201).send({ job });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to create cron job', detail: message });
    }
  });

  app.delete('/api/v1/cron', async (request, reply) => {
    try {
      const result = DeleteCronBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          detail: result.error.issues.map(i => i.message).join('; '),
        });
      }

      const deleted = deleteCronJob(db, result.data.id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Cron job not found' });
      }

      return reply.status(200).send({ ok: true, id: result.data.id });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to delete cron job', detail: message });
    }
  });
}
