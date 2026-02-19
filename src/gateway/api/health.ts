/**
 * Health check route handler.
 * GET /api/v1/health — returns uptime, memory, DB status, active tasks, and version.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import type { HealthData } from '../../types/index.js';
import { getTasksByStatus } from '../../persistence/tasks.js';

/** Timestamp when the server started (set on registration). */
let startTime: number;

/**
 * Register the health endpoint on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerHealthRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  startTime = Date.now();

  app.get<{ Reply: HealthData }>('/api/v1/health', async (_request, reply) => {
    try {
      const memUsage = process.memoryUsage();
      const activeTasks = getTasksByStatus(db, 'running');

      let dbSizeBytes = 0;
      try {
        const sizeRow = db.prepare(
          `SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()`,
        ).get() as { size: number } | undefined;
        dbSizeBytes = sizeRow?.size ?? 0;
      } catch {
        // DB size query may not be supported in all SQLite builds
      }

      const health: HealthData = {
        uptime: Math.floor((Date.now() - startTime) / 1000),
        memoryUsageMb: Math.round(memUsage.heapUsed / 1024 / 1024),
        dbSizeBytes,
        activeTasks: activeTasks.length,
        version: '0.1.0',
      };

      return reply.status(200).send(health);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Health check failed', detail: message } as never);
    }
  });
}
