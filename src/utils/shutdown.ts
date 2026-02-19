/**
 * Graceful shutdown handler.
 * Manages process signal handling and cleanup function registration.
 * Cleanup functions run in reverse registration order with a 10-second timeout.
 * See HLD Section S0.B.3.
 */

import { createModuleLogger } from './logger.js';

const log = createModuleLogger('shutdown');

/** Maximum time in milliseconds to wait for cleanup before force exit */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Function signature for cleanup callbacks */
export type CleanupFunction = () => Promise<void> | void;

/** Registry entry pairing a label with its cleanup function */
interface CleanupEntry {
  label: string;
  fn: CleanupFunction;
}

/**
 * Shutdown handler that manages graceful process termination.
 * Modules register cleanup functions that execute in reverse order on shutdown.
 * A 10-second timeout ensures the process does not hang indefinitely.
 */
export interface ShutdownHandler {
  /** Register a cleanup function with a descriptive label */
  register(label: string, fn: CleanupFunction): void;
  /** Trigger the shutdown sequence manually */
  shutdown(): Promise<void>;
  /** Check if the shutdown sequence is in progress */
  isShuttingDown(): boolean;
}

/**
 * Create a shutdown handler that listens for SIGINT and SIGTERM.
 * Returns a ShutdownHandler with methods to register cleanup functions
 * and manually trigger shutdown.
 *
 * @example
 * ```ts
 * const handler = createShutdownHandler();
 * handler.register('database', async () => { await db.close(); });
 * handler.register('server', async () => { await server.close(); });
 * // On SIGINT/SIGTERM, server closes first, then database (reverse order).
 * ```
 */
export function createShutdownHandler(): ShutdownHandler {
  const registry: CleanupEntry[] = [];
  let shuttingDown = false;

  /**
   * Register a cleanup function to be called during shutdown.
   * Functions are called in reverse registration order (LIFO).
   *
   * @param label - A human-readable name for the cleanup step (used in logs)
   * @param fn - The cleanup function, may be sync or async
   */
  function register(label: string, fn: CleanupFunction): void {
    registry.push({ label, fn });
    log.debug({ label }, 'Registered cleanup function');
  }

  /**
   * Execute the shutdown sequence.
   * Runs all registered cleanup functions in reverse order.
   * Forces process exit after the timeout if cleanup hangs.
   */
  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      log.warn('Shutdown already in progress, ignoring duplicate signal');
      return;
    }

    shuttingDown = true;
    log.info('Shutdown initiated — stopping new message acceptance');

    // Force exit after timeout
    const forceExitTimer = setTimeout(() => {
      log.error('Shutdown timed out after 10s — forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Ensure the timer does not prevent exit if cleanup finishes
    if (typeof forceExitTimer.unref === 'function') {
      forceExitTimer.unref();
    }

    // Run cleanup functions in reverse registration order
    const reversed = [...registry].reverse();

    for (const entry of reversed) {
      try {
        log.info({ label: entry.label }, 'Running cleanup');
        await entry.fn();
        log.info({ label: entry.label }, 'Cleanup completed');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ label: entry.label, error: message }, 'Cleanup failed');
      }
    }

    clearTimeout(forceExitTimer);
    log.info('All cleanup complete — exiting');
  }

  /**
   * Check whether the shutdown sequence is currently in progress.
   */
  function isShuttingDown(): boolean {
    return shuttingDown;
  }

  // Register signal handlers
  const signalHandler = (): void => {
    void shutdown().then(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  log.debug('Shutdown handler installed (SIGINT, SIGTERM)');

  return {
    register,
    shutdown,
    isShuttingDown,
  };
}
