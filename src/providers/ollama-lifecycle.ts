/**
 * Ollama process lifecycle management.
 * Detects running state, manages the "we started it" flag,
 * and provides platform-aware process shutdown.
 *
 * See Phase 3 of the onboarding sprint.
 */

import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import os from 'node:os';
import { homeDir } from '../config/loader.js';
import { createModuleLogger, securityLogger } from '../utils/logger.js';

const log = createModuleLogger('ollama-lifecycle');

/** Flag file indicating Lil Dude manages the Ollama lifecycle */
const MANAGED_FLAG_FILE = '.ollama-managed';

/**
 * Check whether Ollama is currently running by pinging its version endpoint.
 *
 * @returns True if Ollama responds successfully within 3 seconds
 */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch('http://localhost:11434/api/version', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check whether Ollama is being managed by Lil Dude.
 * Returns true if the managed flag file exists.
 *
 * @returns True if the .ollama-managed flag file is present
 */
export function isOllamaManagedByUs(): boolean {
  const flagPath = join(homeDir(), MANAGED_FLAG_FILE);
  return existsSync(flagPath);
}

/**
 * Mark Ollama as managed by Lil Dude.
 * Creates the .ollama-managed flag file in the home directory.
 */
export function markOllamaManaged(): void {
  const dir = homeDir();
  mkdirSync(dir, { recursive: true });
  const flagPath = join(dir, MANAGED_FLAG_FILE);

  try {
    writeFileSync(flagPath, new Date().toISOString(), 'utf-8');
    log.info('Marked Ollama as managed by Lil Dude');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ error: message }, 'Failed to create Ollama managed flag file');
  }
}

/**
 * Clear the Ollama managed flag.
 * Removes the .ollama-managed flag file if it exists.
 */
export function clearOllamaManagedFlag(): void {
  const flagPath = join(homeDir(), MANAGED_FLAG_FILE);
  try {
    if (existsSync(flagPath)) {
      unlinkSync(flagPath);
      log.info('Cleared Ollama managed flag');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ error: message }, 'Failed to remove Ollama managed flag file');
  }
}

/**
 * Stop the Ollama process using platform-appropriate commands.
 * On macOS/Linux uses `pkill -f ollama`, on Windows uses `taskkill`.
 * Clears the managed flag after stopping.
 *
 * @throws Error if the stop command fails unexpectedly
 */
export async function stopOllamaProcess(): Promise<void> {
  const platform = os.platform();

  securityLogger.info(
    { action: 'ollama_stop', platform },
    'Stopping Ollama process',
  );

  const command =
    platform === 'win32'
      ? 'taskkill /IM ollama.exe /F'
      : 'pkill -f ollama';

  return new Promise<void>((resolve, reject) => {
    exec(command, { timeout: 10_000 }, (error, _stdout, stderr) => {
      // Clean up flag regardless of outcome
      clearOllamaManagedFlag();

      if (error) {
        // Exit code 1 from pkill means "no processes matched" — that's fine
        if (error.code === 1) {
          log.info('Ollama process was not running (already stopped)');
          resolve();
          return;
        }

        const message = stderr || error.message;
        log.error({ error: message }, 'Failed to stop Ollama process');
        reject(new Error(`Failed to stop Ollama: ${message}`));
        return;
      }

      log.info('Ollama process stopped successfully');
      resolve();
    });
  });
}
