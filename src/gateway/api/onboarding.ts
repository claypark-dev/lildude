/**
 * Onboarding REST API routes.
 * Provides endpoints for the web-based onboarding wizard:
 *   - GET  /api/v1/onboarding/status    — check onboarding state + hardware
 *   - POST /api/v1/onboarding/verify-key — validate a provider API key
 *   - POST /api/v1/onboarding/complete   — save config and finish onboarding
 *   - POST /api/v1/onboarding/reset      — delete config to re-onboard from scratch
 *
 * See Phase 1 of the onboarding sprint.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import { isOnboarded } from '../../index.js';
import { detectHardware } from '../../utils/hardware.js';
import { verifyApiKey, type OnboardingProvider } from '../../onboarding/verify-provider.js';
import { saveConfig, deleteConfig } from '../../config/loader.js';
import { ConfigSchema } from '../../config/schema.js';
import { generateApiKey, storeApiKey } from '../../persistence/api-keys.js';
import { createModuleLogger, securityLogger } from '../../utils/logger.js';

const log = createModuleLogger('api-onboarding');

// In-memory cache for the raw web-panel API key.
// The DB only stores hashes, so the raw key is only available at generation time.
// We cache it here so repeated unauthenticated calls return the same key
// without regenerating (which would invalidate the previous hash).
let cachedWebPanelKey: string | null = null;

// ── Zod Schemas ─────────────────────────────────────────────────────

const VerifyKeyRequestSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'deepseek', 'gemini']),
  apiKey: z.string().min(1, 'API key is required'),
});

const CompleteOnboardingSchema = z.object({
  config: z.record(z.unknown()),
});

/**
 * Register onboarding API routes on the given Fastify instance.
 *
 * @param app - The Fastify server instance.
 * @param db - The SQLite database for API key generation.
 */
export function registerOnboardingRoutes(app: FastifyInstance, db?: BetterSqlite3.Database): void {
  /**
   * GET /api/v1/onboarding/status
   * Returns onboarding state and hardware profile.
   */
  app.get('/api/v1/onboarding/status', async (request, reply) => {
    try {
      const onboarded = isOnboarded();
      const hardware = detectHardware();

      // If already onboarded and the request has no valid auth header,
      // return the existing web-panel API key or generate one if none exists.
      let apiKey: string | undefined;
      const authHeader = request.headers.authorization;
      if (onboarded && db && !authHeader) {
        if (cachedWebPanelKey) {
          apiKey = cachedWebPanelKey;
        } else {
          // Delete any stale web-panel key from a previous server process
          // (we can't recover the raw key from the hash).
          db.prepare("DELETE FROM api_keys WHERE label = 'web-panel'").run();
          apiKey = generateApiKey();
          storeApiKey(db, apiKey, 'web-panel');
          cachedWebPanelKey = apiKey;
          log.info('Web panel API key generated for new browser session');
        }
      }

      return reply.send({
        onboarded,
        hardware: {
          os: hardware.os,
          arch: hardware.arch,
          ramGb: hardware.ramGb,
          cpuCores: hardware.cpuCores,
          diskFreeGb: hardware.diskFreeGb,
          hasGpu: hardware.hasGpu,
          features: hardware.features,
          recommendedTier: hardware.recommendedTier,
        },
        ...(apiKey ? { apiKey } : {}),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to get onboarding status');
      return reply.status(500).send({ error: 'Failed to get onboarding status' });
    }
  });

  /**
   * POST /api/v1/onboarding/verify-key
   * Validates a provider API key via lightweight test call.
   */
  app.post('/api/v1/onboarding/verify-key', async (request, reply) => {
    const parsed = VerifyKeyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join('; ');
      return reply.status(400).send({ error: issues });
    }

    const { provider, apiKey } = parsed.data;

    securityLogger.info(
      { action: 'onboarding_verify_key', provider },
      'Verifying provider API key during onboarding',
    );

    try {
      const result = await verifyApiKey(provider as OnboardingProvider, apiKey);
      return reply.send({
        provider: result.provider,
        valid: result.valid,
        error: result.error,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message, provider }, 'Key verification failed');
      return reply.status(500).send({
        provider,
        valid: false,
        error: `Verification failed: ${message}`,
      });
    }
  });

  /**
   * POST /api/v1/onboarding/complete
   * Validates and saves configuration, completing the onboarding flow.
   */
  app.post('/api/v1/onboarding/complete', async (request, reply) => {
    const parsed = CompleteOnboardingSchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join('; ');
      return reply.status(400).send({ error: issues });
    }

    const { config: rawConfig } = parsed.data;

    // Validate with Zod ConfigSchema
    const configResult = ConfigSchema.safeParse(rawConfig);
    if (!configResult.success) {
      const issues = configResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return reply.status(400).send({ error: `Invalid config: ${issues}` });
    }

    try {
      await saveConfig(configResult.data);

      securityLogger.info(
        { action: 'onboarding_complete' },
        'Onboarding completed — config saved',
      );

      log.info('Onboarding completed successfully');

      // Generate an API key for the web panel so the frontend can authenticate.
      // Remove any existing web-panel key first (handles re-onboarding).
      let apiKey: string | undefined;
      if (db) {
        db.prepare(
          "DELETE FROM api_keys WHERE label = 'web-panel'",
        ).run();
        apiKey = generateApiKey();
        storeApiKey(db, apiKey, 'web-panel');
        cachedWebPanelKey = apiKey;
        log.info('Web panel API key generated during onboarding');
      }

      return reply.send({
        ok: true,
        restartRequired: true,
        message: 'Configuration saved. Restart Lil Dude to apply your settings.',
        apiKey,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to save onboarding config');
      return reply.status(500).send({
        ok: false,
        restartRequired: false,
        message: `Failed to save configuration: ${message}`,
      });
    }
  });

  /**
   * POST /api/v1/onboarding/reset
   * Deletes the existing config.json so the user can re-onboard from scratch.
   */
  app.post('/api/v1/onboarding/reset', async (_request, reply) => {
    securityLogger.info(
      { action: 'onboarding_reset' },
      'User requested configuration reset for re-onboarding',
    );

    try {
      await deleteConfig();
      log.info('Configuration reset — user can re-onboard');

      return reply.send({
        ok: true,
        message: 'Configuration cleared. You can now set up from scratch.',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to reset configuration');
      return reply.status(500).send({
        ok: false,
        message: `Failed to reset configuration: ${message}`,
      });
    }
  });
}
