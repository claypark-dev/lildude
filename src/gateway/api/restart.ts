/**
 * Onboarding restart endpoint.
 * Provides a one-shot POST /api/v1/onboarding/restart that gracefully
 * shuts down the current process and spawns a new one.
 *
 * Only registered during onboarding mode — never available in full app mode.
 */

import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { ShutdownHandler } from '../../utils/shutdown.js';
import { createModuleLogger, securityLogger } from '../../utils/logger.js';

const log = createModuleLogger('api-restart');

/** One-shot guard prevents multiple restart attempts. */
let restartTriggered = false;

/** Delay in ms before initiating shutdown (allows HTTP response to flush). */
const RESTART_DELAY_MS = 500;

/**
 * Register the onboarding restart route on the given Fastify instance.
 * Should only be called from `startOnboardingMode()` so it is never
 * available during normal app operation.
 *
 * @param app - The Fastify server instance.
 * @param shutdownHandler - The shutdown handler for graceful cleanup.
 */
export function registerRestartRoute(
  app: FastifyInstance,
  shutdownHandler: ShutdownHandler,
): void {
  app.post('/api/v1/onboarding/restart', async (_request, reply) => {
    if (restartTriggered) {
      return reply.status(409).send({
        ok: false,
        message: 'Restart already in progress.',
      });
    }

    restartTriggered = true;

    securityLogger.info(
      { action: 'onboarding_restart' },
      'Server restart triggered from onboarding wizard',
    );

    // Send the response before shutting down
    void reply.send({
      ok: true,
      message: 'Restarting Lil Dude...',
    });

    // Schedule restart after a brief delay to allow response to flush
    setTimeout(() => {
      void performRestart(shutdownHandler);
    }, RESTART_DELAY_MS);
  });

  log.debug('Onboarding restart route registered');
}

/**
 * Gracefully shut down the current process and spawn a replacement.
 * Uses the same process.argv so the new process starts identically.
 *
 * @param shutdownHandler - The shutdown handler for graceful cleanup.
 */
async function performRestart(shutdownHandler: ShutdownHandler): Promise<void> {
  log.info('Performing graceful restart...');

  try {
    await shutdownHandler.shutdown();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, 'Shutdown encountered errors');
  }

  // Spawn a new process with the same arguments
  const [nodeBinary, ...args] = process.argv;
  log.info({ nodeBinary, args }, 'Spawning replacement process');

  const child = spawn(nodeBinary, args, {
    detached: true,
    stdio: 'inherit',
    env: process.env,
  });

  child.unref();
  process.exit(0);
}
