/**
 * Budget route handler.
 * GET /api/v1/budget — returns monthly spend, limit, and remaining budget.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import type { Config } from '../../config/schema.js';
import { getMonthlyTotalCost, getDailyTotalCost } from '../../persistence/token-usage.js';

/** Response shape for the budget endpoint. */
interface BudgetResponse {
  monthlyLimitUsd: number;
  monthlySpentUsd: number;
  monthlyRemainingUsd: number;
  dailySpentUsd: number;
  warningThresholdPct: number;
  isApproachingLimit: boolean;
}

/**
 * Register the budget endpoint on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 * @param config - The application configuration.
 */
export function registerBudgetRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
  config: Config,
): void {
  app.get<{ Reply: BudgetResponse }>('/api/v1/budget', async (_request, reply) => {
    try {
      const monthlySpentUsd = getMonthlyTotalCost(db);
      const dailySpentUsd = getDailyTotalCost(db);
      const monthlyLimitUsd = config.budget.monthlyLimitUsd;
      const monthlyRemainingUsd = Math.max(0, monthlyLimitUsd - monthlySpentUsd);
      const warningThresholdPct = config.budget.warningThresholdPct;
      const isApproachingLimit = monthlySpentUsd >= monthlyLimitUsd * warningThresholdPct;

      const budgetData: BudgetResponse = {
        monthlyLimitUsd,
        monthlySpentUsd,
        monthlyRemainingUsd,
        dailySpentUsd,
        warningThresholdPct,
        isApproachingLimit,
      };

      return reply.status(200).send(budgetData);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to retrieve budget', detail: message } as never);
    }
  });
}
