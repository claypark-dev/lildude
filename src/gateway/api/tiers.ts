/**
 * REST API routes for install tier management.
 * Exposes tier descriptions, feature availability, and current tier info.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { InstallTier } from '../../types/index.js';
import {
  isFeatureEnabled,
  getEnabledFeatures,
  getChannelLimit,
  getBudgetLimit,
  getConcurrentTaskLimit,
  getTierDescriptions,
  canRunWave,
  type GatedFeature,
} from '../../tiers/feature-gate.js';
import { detectHardware } from '../../utils/hardware.js';
import { createModuleLogger } from '../../utils/logger.js';

const tierApiLogger = createModuleLogger('tiers-api');

/**
 * Register install tier REST API routes.
 * @param app - The Fastify instance.
 * @param getCurrentTier - Callback to get the current install tier from config.
 */
export function registerTierRoutes(
  app: FastifyInstance,
  getCurrentTier: () => InstallTier,
): void {
  /** GET /api/v1/tiers — List all tiers with descriptions. */
  app.get('/api/v1/tiers', async (_request, reply) => {
    try {
      const descriptions = getTierDescriptions();
      const currentTier = getCurrentTier();
      const hardware = detectHardware();

      return reply.send({
        tiers: descriptions,
        currentTier,
        recommendedTier: hardware.recommendedTier,
        hardware: {
          ramGb: hardware.ramGb,
          cpuCores: hardware.cpuCores,
          hasGpu: hardware.hasGpu,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      tierApiLogger.error({ error: message }, 'Failed to get tier info');
      return reply.status(500).send({ error: 'Failed to get tier info' } as never);
    }
  });

  /** GET /api/v1/tiers/current — Get current tier and its capabilities. */
  app.get('/api/v1/tiers/current', async (_request, reply) => {
    try {
      const tier = getCurrentTier();
      const enabledFeatures = getEnabledFeatures(tier);
      const descriptions = getTierDescriptions();

      return reply.send({
        tier,
        description: descriptions[tier],
        enabledFeatures,
        channelLimit: getChannelLimit(tier),
        budgetLimit: getBudgetLimit(tier),
        concurrentTaskLimit: getConcurrentTaskLimit(tier),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      tierApiLogger.error({ error: message }, 'Failed to get current tier');
      return reply.status(500).send({ error: 'Failed to get current tier' } as never);
    }
  });

  /** GET /api/v1/tiers/features/:feature — Check if a specific feature is enabled. */
  app.get<{
    Params: { feature: string };
  }>('/api/v1/tiers/features/:feature', async (request, reply) => {
    try {
      const tier = getCurrentTier();
      const feature = request.params.feature as GatedFeature;
      const enabled = isFeatureEnabled(tier, feature);

      return reply.send({
        feature,
        enabled,
        tier,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      tierApiLogger.error({ error: message }, 'Failed to check feature');
      return reply.status(500).send({ error: 'Failed to check feature' } as never);
    }
  });

  /** POST /api/v1/tiers/check-wave — Check if a wave can run at the current tier. */
  app.post<{
    Body: { waveMinTier: string };
  }>('/api/v1/tiers/check-wave', async (request, reply) => {
    try {
      const parsed = z.object({
        waveMinTier: z.enum(['basic', 'standard', 'power']),
      }).safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: 'waveMinTier must be one of: basic, standard, power',
        });
      }

      const tier = getCurrentTier();
      const allowed = canRunWave(tier, parsed.data.waveMinTier);

      return reply.send({
        allowed,
        currentTier: tier,
        requiredTier: parsed.data.waveMinTier,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      tierApiLogger.error({ error: message }, 'Failed to check wave tier');
      return reply.status(500).send({ error: 'Failed to check wave tier' } as never);
    }
  });
}
