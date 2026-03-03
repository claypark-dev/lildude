/**
 * Wave Hub — S3.R.1
 *
 * Marketplace installer for waves from GitHub repositories.
 * Provides install, list, uninstall, and search functionality.
 * The hub does NOT execute waves — it only manages installation lifecycle.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { nanoid } from 'nanoid';
import type { WaveManifest } from '../types/index.js';
import type { SecurityLevel } from '../security/permissions.js';
import { SecurityError, PersistenceError } from '../errors.js';
import { validateManifest } from './schema.js';
import { clearRegistry } from './registry.js';
import { appendSecurityLog } from '../persistence/security-log.js';
import { homeDir } from '../config/loader.js';
import { createModuleLogger } from '../utils/logger.js';
import {
  parseGitHubSource,
  checkWavePermissions,
  searchCuratedWaveRegistry,
  scanWaveDirectory,
  upsertInstalledWave,
  type ListedWave,
  type WaveRegistryEntry,
} from './hub-helpers.js';

const hubLogger = createModuleLogger('wave-hub');
const execFileAsync = promisify(execFile);

/** Options for the installWave function, supporting dependency injection. */
export interface InstallWaveOptions {
  installedDir?: string;
  cloneFn?: (repoUrl: string, destPath: string) => Promise<void>;
}

/**
 * Install a wave from a GitHub source reference.
 *
 * Workflow:
 * 1. Parse the `github:user/repo` source format
 * 2. Clone the repository to a temporary directory
 * 3. Read and validate the `wave.json` manifest
 * 4. Check permissions against the user's security level
 * 5. Copy the wave to `~/.lil-dude/waves/installed/{name}/`
 * 6. Register in the waves_registry DB table
 * 7. Clean up the temporary directory
 *
 * @param db - The better-sqlite3 Database instance.
 * @param source - The wave source in `github:user/repo` format.
 * @param securityLevel - The user's configured security level (1-5).
 * @param options - Optional overrides for testing (clone function, directories).
 * @returns The validated wave manifest of the installed wave.
 * @throws {Error} If the source format is invalid or cloning fails.
 * @throws {SecurityError} If the wave's permissions exceed the security level.
 */
export async function installWave(
  db: BetterSqlite3.Database,
  source: string,
  securityLevel: SecurityLevel,
  options: InstallWaveOptions = {},
): Promise<WaveManifest> {
  const { user, repo } = parseGitHubSource(source);
  const repoUrl = `https://github.com/${user}/${repo}.git`;
  const tempPath = join(tmpdir(), `lildude-install-${nanoid()}`);
  const installedBase = options.installedDir ?? join(homeDir(), 'waves', 'installed');
  const cloneFn = options.cloneFn ?? defaultClone;

  hubLogger.info({ source, user, repo, tempPath }, 'Starting wave installation');

  try {
    await cloneFn(repoUrl, tempPath);

    const manifestPath = join(tempPath, 'wave.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`No wave.json found in repository ${source}`);
    }

    const rawJson = readFileSync(manifestPath, 'utf-8');
    const parsed: unknown = JSON.parse(rawJson);
    const validationResult = validateManifest(parsed);

    if (!validationResult.valid || !validationResult.manifest) {
      const errorMessages = validationResult.errors?.join('; ') ?? 'Unknown validation error';
      throw new Error(`Invalid wave manifest in ${source}: ${errorMessages}`);
    }

    const manifest = validationResult.manifest;
    checkWavePermissions(manifest, securityLevel);

    appendSecurityLog(db, {
      actionType: 'wave_install',
      actionDetail: `Installing wave "${manifest.name}" from ${source}`,
      allowed: true,
      securityLevel,
      reason: 'Wave permissions check passed',
    });

    const waveDestDir = join(installedBase, manifest.name);
    await mkdir(waveDestDir, { recursive: true });
    await cp(tempPath, waveDestDir, { recursive: true });

    upsertInstalledWave(db, manifest);

    hubLogger.info(
      { name: manifest.name, version: manifest.version, dest: waveDestDir },
      'Wave installed successfully',
    );

    return manifest;
  } catch (error: unknown) {
    if (error instanceof SecurityError) {
      appendSecurityLog(db, {
        actionType: 'wave_install',
        actionDetail: `Blocked wave installation from ${source}`,
        allowed: false,
        securityLevel,
        reason: error.message,
      });
    }
    throw error;
  } finally {
    try {
      await rm(tempPath, { recursive: true, force: true });
      hubLogger.debug({ tempPath }, 'Temp directory cleaned up');
    } catch (cleanupError: unknown) {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      hubLogger.warn({ tempPath, error: message }, 'Failed to clean up temp directory');
    }
  }
}

/**
 * List all waves (bundled and installed).
 *
 * @param db - The better-sqlite3 Database instance.
 * @param bundledDir - Path to the bundled waves directory.
 * @param installedDir - Path to the installed waves directory.
 * @returns An array of listed waves with name, version, source, and status.
 */
export function listWaves(
  _db: BetterSqlite3.Database,
  bundledDir?: string,
  installedDir?: string,
): ListedWave[] {
  const resolvedBundledDir = bundledDir ?? join(process.cwd(), 'waves', 'bundled');
  const resolvedInstalledDir = installedDir ?? join(homeDir(), 'waves', 'installed');
  const waves: ListedWave[] = [];

  try {
    waves.push(...scanWaveDirectory(resolvedBundledDir, 'bundled'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    hubLogger.warn({ dir: resolvedBundledDir, error: message }, 'Failed to scan bundled waves');
  }

  try {
    waves.push(...scanWaveDirectory(resolvedInstalledDir, 'installed'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    hubLogger.warn({ dir: resolvedInstalledDir, error: message }, 'Failed to scan installed waves');
  }

  return waves;
}

/**
 * Uninstall a previously installed wave.
 * Only allows uninstalling waves from the `installed/` directory (not bundled).
 *
 * @param db - The better-sqlite3 Database instance.
 * @param name - The wave name to uninstall.
 * @param installedDir - Path to the installed waves directory.
 * @throws {Error} If the wave is bundled or not found.
 */
export async function uninstallWave(
  db: BetterSqlite3.Database,
  name: string,
  installedDir?: string,
): Promise<void> {
  const resolvedInstalledDir = installedDir ?? join(homeDir(), 'waves', 'installed');
  const waveDir = join(resolvedInstalledDir, name);

  const row = db.prepare(
    'SELECT source FROM waves_registry WHERE name = ?',
  ).get(name) as { source: string } | undefined;

  if (row?.source === 'bundled') {
    throw new Error(
      `Cannot uninstall bundled wave "${name}". Bundled waves are part of the core distribution.`,
    );
  }

  if (!existsSync(waveDir)) {
    throw new Error(`Wave "${name}" is not installed at ${waveDir}`);
  }

  try {
    await rm(waveDir, { recursive: true, force: true });
    db.prepare('DELETE FROM waves_registry WHERE name = ? AND source = ?').run(name, 'installed');
    clearRegistry();

    hubLogger.info({ name, dir: waveDir }, 'Wave uninstalled successfully');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to uninstall wave "${name}": ${message}`);
  }
}

/**
 * Search the curated wave registry for waves matching a query.
 *
 * @param query - The search query string.
 * @returns An array of matching wave registry entries.
 */
export function searchWaves(query: string): WaveRegistryEntry[] {
  return searchCuratedWaveRegistry(query);
}

/**
 * Update an installed wave to the latest version from its source.
 * Re-installs from the registry source, preserving the wave name.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param name - The wave name to update.
 * @param source - The source to install from (e.g., "github:user/repo").
 * @param securityLevel - The user's configured security level.
 * @param options - Optional overrides for testing.
 * @returns The updated wave manifest.
 * @throws {Error} If the wave is bundled or the update fails.
 */
export async function updateWave(
  db: BetterSqlite3.Database,
  name: string,
  source: string,
  securityLevel: SecurityLevel,
  options: InstallWaveOptions = {},
): Promise<WaveManifest> {
  const row = db.prepare(
    'SELECT source FROM waves_registry WHERE name = ?',
  ).get(name) as { source: string } | undefined;

  if (row?.source === 'bundled') {
    throw new Error(
      `Cannot update bundled wave "${name}". Bundled waves are updated with Lil Dude releases.`,
    );
  }

  hubLogger.info({ name, source }, 'Updating wave');

  const manifest = await installWave(db, source, securityLevel, options);

  appendSecurityLog(db, {
    actionType: 'wave_update',
    actionDetail: `Updated wave "${name}" to version ${manifest.version} from ${source}`,
    allowed: true,
    securityLevel,
    reason: 'Wave update successful',
  });

  hubLogger.info(
    { name: manifest.name, version: manifest.version },
    'Wave updated successfully',
  );

  return manifest;
}

/**
 * Default clone function using `git clone --depth 1`.
 * @param repoUrl - The HTTPS URL of the repository.
 * @param destPath - The local destination directory.
 */
async function defaultClone(repoUrl: string, destPath: string): Promise<void> {
  try {
    await execFileAsync('git', ['clone', '--depth', '1', repoUrl, destPath]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to clone repository ${repoUrl}: ${message}`);
  }
}
