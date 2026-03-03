/**
 * User feedback API route handler.
 * POST /api/v1/feedback — Record thumbs up/down feedback for a task.
 * GET  /api/v1/feedback/:taskId — Get feedback for a specific task.
 * GET  /api/v1/journal — Get recent learning journal entries.
 * POST /api/v1/journal/generate — Trigger journal generation for a date.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import {
  recordFeedback,
  getFeedbackByTask,
  type RecordFeedbackInput,
} from '../../persistence/user-feedback.js';
import {
  generateDailyJournal,
  getRecentJournals,
} from '../../orchestrator/learning-journal.js';
import { createModuleLogger } from '../../utils/logger.js';

const feedbackApiLogger = createModuleLogger('feedback-api');

/**
 * Register feedback and learning journal endpoints.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerFeedbackRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
): void {
  // POST /api/v1/feedback — Record user feedback
  app.post<{
    Body: { taskId: string; rating: -1 | 1; comment?: string; model?: string; provider?: string; waveName?: string };
  }>('/api/v1/feedback', async (request, reply) => {
    try {
      const { taskId, rating, comment, model, provider, waveName } = request.body;

      if (!taskId || (rating !== -1 && rating !== 1)) {
        return reply.status(400).send({
          error: 'taskId (string) and rating (-1 or 1) are required',
        } as never);
      }

      const input: RecordFeedbackInput = {
        taskId,
        rating,
        comment,
        model,
        provider,
        waveName,
      };

      const feedbackId = recordFeedback(db, input);

      feedbackApiLogger.info({ taskId, rating }, 'User feedback recorded');

      return reply.status(201).send({ id: feedbackId, taskId, rating });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      feedbackApiLogger.error({ error: message }, 'Failed to record feedback');
      return reply.status(500).send({ error: 'Failed to record feedback' } as never);
    }
  });

  // GET /api/v1/feedback/:taskId — Get feedback for a task
  app.get<{ Params: { taskId: string } }>(
    '/api/v1/feedback/:taskId',
    async (request, reply) => {
      try {
        const feedback = getFeedbackByTask(db, request.params.taskId);
        if (!feedback) {
          return reply.status(404).send({ error: 'No feedback found' } as never);
        }
        return reply.status(200).send(feedback);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        feedbackApiLogger.error({ error: message }, 'Failed to get feedback');
        return reply.status(500).send({ error: 'Failed to get feedback' } as never);
      }
    },
  );

  // GET /api/v1/journal — Get recent learning journal entries
  app.get<{ Querystring: { limit?: string } }>(
    '/api/v1/journal',
    async (request, reply) => {
      try {
        const limit = parseInt(request.query.limit ?? '7', 10);
        const entries = getRecentJournals(db, Math.min(limit, 30));
        return reply.status(200).send({ entries });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        feedbackApiLogger.error({ error: message }, 'Failed to get journal entries');
        return reply.status(500).send({ error: 'Failed to get journal entries' } as never);
      }
    },
  );

  // POST /api/v1/journal/generate — Trigger journal generation
  app.post<{ Body: { date?: string } }>(
    '/api/v1/journal/generate',
    async (request, reply) => {
      try {
        const date = request.body?.date;
        const entry = generateDailyJournal(db, date);
        return reply.status(201).send(entry);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        feedbackApiLogger.error({ error: message }, 'Failed to generate journal');
        return reply.status(500).send({ error: 'Failed to generate journal' } as never);
      }
    },
  );
}
