/**
 * Security log route handler.
 * GET /api/v1/security-log — Retrieve recent security log entries.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { getRecentSecurityLogs } from '../../persistence/security-log.js';

/** Query parameters for the security log endpoint. */
interface SecurityLogQuerystring {
  limit?: string;
  offset?: string;
}

/**
 * Register the security log endpoint on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerSecurityRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  app.get<{ Querystring: SecurityLogQuerystring }>(
    '/api/v1/security-log',
    async (request, reply) => {
      try {
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
        const offset = request.query.offset ? parseInt(request.query.offset, 10) : 0;

        const logs = getRecentSecurityLogs(db, limit, offset);
        return reply.status(200).send({ logs, count: logs.length });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: 'Failed to retrieve security logs', detail: message });
      }
    },
  );
}
