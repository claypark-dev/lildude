/**
 * Daily briefing API route handler.
 * GET /api/v1/briefing — Returns a structured daily briefing with skill,
 * task, schedule, and cost data. Purely deterministic — no LLM calls.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { generateBriefing, type DailyBriefing } from '../../orchestrator/briefing-generator.js';
import { createModuleLogger } from '../../utils/logger.js';

const briefingApiLogger = createModuleLogger('briefing-api');

/**
 * Register the briefing endpoint on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerBriefingRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
): void {
  app.get<{ Reply: DailyBriefing }>(
    '/api/v1/briefing',
    async (_request, reply) => {
      try {
        const briefing = generateBriefing(db);
        return reply.status(200).send(briefing);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        briefingApiLogger.error({ error: message }, 'Failed to generate briefing');
        return reply.status(500).send({
          error: 'Failed to generate briefing',
          detail: message,
        } as never);
      }
    },
  );
}
