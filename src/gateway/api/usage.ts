/**
 * Token usage route handler.
 * GET /api/v1/usage — Returns daily and monthly token cost statistics.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { getDailyTotalCost, getMonthlyTotalCost } from '../../persistence/token-usage.js';

/** Response shape for the usage endpoint. */
interface UsageResponse {
  dailyCostUsd: number;
  monthlyCostUsd: number;
  date: string;
  month: string;
}

/**
 * Register the usage endpoint on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerUsageRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  app.get<{ Reply: UsageResponse }>('/api/v1/usage', async (_request, reply) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const currentMonth = new Date().toISOString().slice(0, 7);

      const dailyCostUsd = getDailyTotalCost(db, today);
      const monthlyCostUsd = getMonthlyTotalCost(db, currentMonth);

      const usageData: UsageResponse = {
        dailyCostUsd,
        monthlyCostUsd,
        date: today,
        month: currentMonth,
      };

      return reply.status(200).send(usageData);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to retrieve usage data', detail: message } as never);
    }
  });
}
