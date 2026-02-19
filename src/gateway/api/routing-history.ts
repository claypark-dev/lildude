/**
 * Routing history route handlers.
 * GET /api/v1/routing-history — Returns recent routing decisions with quality scores.
 * POST /api/v1/routing-history/feedback — Records quality feedback for a task.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import {
  getRecentRoutingHistory,
  recordQualityFeedback,
  type RoutingHistoryEntry,
} from '../../persistence/routing-history.js';

/** Response shape for the routing history endpoint. */
interface RoutingHistoryResponse {
  entries: RoutingHistoryEntry[];
}

/** Request body for the quality feedback endpoint. */
interface QualityFeedbackBody {
  taskId: string;
  score: number;
  feedback?: string;
}

/** Response shape for the quality feedback endpoint. */
interface QualityFeedbackResponse {
  updated: boolean;
}

/**
 * Register routing history endpoints on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerRoutingHistoryRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
): void {
  app.get<{
    Querystring: { limit?: string };
    Reply: RoutingHistoryResponse;
  }>('/api/v1/routing-history', async (request, reply) => {
    try {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50;
      const entries = getRecentRoutingHistory(db, safeLimit);

      return reply.status(200).send({ entries });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send(
        { error: 'Failed to retrieve routing history', detail: message } as never,
      );
    }
  });

  app.post<{
    Body: QualityFeedbackBody;
    Reply: QualityFeedbackResponse;
  }>('/api/v1/routing-history/feedback', async (request, reply) => {
    try {
      const { taskId, score, feedback } = request.body;

      if (!taskId || typeof score !== 'number' || score < 0 || score > 1) {
        return reply.status(400).send(
          { error: 'Invalid input: taskId required, score must be 0-1' } as never,
        );
      }

      const updated = recordQualityFeedback(db, taskId, score, feedback);

      return reply.status(200).send({ updated });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send(
        { error: 'Failed to record quality feedback', detail: message } as never,
      );
    }
  });
}
