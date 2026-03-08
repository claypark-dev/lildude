/**
 * Dashboard API consolidation endpoint.
 * GET /api/v1/dashboard — returns all widget data in a single call.
 * Reduces the number of API round-trips for the dashboard page.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { getEnabledCronJobs } from '../../persistence/cron-jobs.js';
import { getMonthlyTotalCost, getDailyTotalCost } from '../../persistence/token-usage.js';
import { getHeartbeatStatus } from '../../orchestrator/heartbeat.js';
import { createModuleLogger } from '../../utils/logger.js';

const dashboardLogger = createModuleLogger('dashboard-api');

/**
 * Register the consolidated dashboard endpoint.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 * @param startTime - The server start time for uptime calculation.
 */
export function registerDashboardRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
): void {
  app.get('/api/v1/dashboard', async (_request, reply) => {
    try {
      // Gather all widget data in parallel-safe manner (all sync SQLite calls)
      const cronJobs = getEnabledCronJobs(db);
      const monthlyCost = getMonthlyTotalCost(db);
      const dailyCost = getDailyTotalCost(db);

      // Active tasks
      const taskRows = db.prepare(
        `SELECT * FROM tasks WHERE status IN ('running', 'pending') ORDER BY created_at DESC LIMIT 20`,
      ).all() as Array<Record<string, unknown>>;

      // Memory usage
      const memUsage = process.memoryUsage();
      const memoryMb = Math.round((memUsage.rss / (1024 * 1024)) * 10) / 10;

      // Uptime
      const uptime = process.uptime();

      // Recent tasks count
      const recentTaskCount = db.prepare(
        `SELECT COUNT(*) as count FROM tasks WHERE created_at > datetime('now', '-24 hours')`,
      ).get() as { count: number };

      const response = {
        health: {
          status: 'ok',
          uptime,
          memoryMb,
          timestamp: new Date().toISOString(),
        },
        budget: {
          monthlyCostUsd: monthlyCost,
          dailyCostUsd: dailyCost,
        },
        tasks: {
          active: taskRows.length,
          recent24h: recentTaskCount.count,
          items: taskRows.slice(0, 5).map((t) => ({
            id: t.id,
            description: t.description,
            status: t.status,
            createdAt: t.created_at,
          })),
        },
        cron: {
          jobs: cronJobs.map((j) => ({
            id: j.id,
            schedule: j.schedule,
            taskDescription: j.taskDescription,
            waveId: j.waveId,
            lastRunAt: j.lastRunAt?.toISOString() ?? null,
            lastRunStatus: j.lastRunStatus,
            nextRunAt: j.nextRunAt?.toISOString() ?? null,
            enabled: j.enabled,
            expiresAt: j.expiresAt?.toISOString() ?? null,
          })),
          count: cronJobs.length,
        },
        heartbeat: getHeartbeatStatus(db),
      };

      return reply.status(200).send(response);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      dashboardLogger.error({ error: message }, 'Dashboard data fetch failed');
      return reply.status(500).send({ error: 'Failed to fetch dashboard data', detail: message });
    }
  });
}
