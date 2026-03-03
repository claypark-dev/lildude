/**
 * Wave loader — scans filesystem directories for wave definitions.
 * Reads wave.json manifests, validates them, dynamically imports entry points,
 * and registers valid waves in both the database and in-memory registry.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nanoid } from 'nanoid';
import type { Wave, WaveManifest, WavePlan, ToolResult } from '../types/index.js';
import { validateManifest } from './schema.js';
import { registerWave } from './registry.js';
import { createModuleLogger } from '../utils/logger.js';
import { PersistenceError } from '../errors.js';

const loaderLogger = createModuleLogger('wave-loader');

/** Source type for a wave (matches the DB CHECK constraint). */
type WaveSource = 'bundled' | 'installed' | 'generated';

/** Shape of a raw wave module's exports after dynamic import. */
interface WaveModuleExports {
  plan: (userInput: string, context: Record<string, unknown>) => Promise<WavePlan>;
  execute: (plan: WavePlan) => Promise<ToolResult>;
  validate?: (result: ToolResult) => Promise<{ valid: boolean; feedback?: string }>;
}

/** Shape of a waves_registry DB row. */
interface WaveRegistryRow {
  id: string;
  name: string;
  version: string;
  source: string;
  manifest: string;
  is_deterministic: number;
  enabled: number;
  installed_at: string;
}

/**
 * Load all waves from bundled and installed directories.
 * Scans each directory for subdirectories containing a wave.json manifest,
 * validates the manifest, dynamically imports the entry point module,
 * and registers the wave in the DB and in-memory registry.
 *
 * Invalid waves are logged as warnings and skipped.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param bundledDir - Path to the bundled waves directory. Defaults to 'waves/bundled'.
 * @param installedDir - Path to installed waves directory. Defaults to '~/.lil-dude/waves/installed'.
 * @returns The number of successfully loaded waves.
 */
export async function loadWaves(
  db: BetterSqlite3.Database,
  bundledDir?: string,
  installedDir?: string,
): Promise<number> {
  const resolvedBundledDir = bundledDir ?? join(process.cwd(), 'waves', 'bundled');
  const resolvedInstalledDir = installedDir ?? join(
    process.env.HOME ?? process.env.USERPROFILE ?? '.',
    '.lil-dude',
    'waves',
    'installed',
  );

  let loadedCount = 0;

  try {
    const bundledLoaded = await loadWavesFromDirectory(
      db,
      resolvedBundledDir,
      'bundled',
    );
    loadedCount += bundledLoaded;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    loaderLogger.warn({ dir: resolvedBundledDir, error: message }, 'Failed to scan bundled waves directory');
  }

  try {
    const installedLoaded = await loadWavesFromDirectory(
      db,
      resolvedInstalledDir,
      'installed',
    );
    loadedCount += installedLoaded;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    loaderLogger.warn({ dir: resolvedInstalledDir, error: message }, 'Failed to scan installed waves directory');
  }

  loaderLogger.info({ loadedCount }, 'Wave loading complete');
  return loadedCount;
}

/**
 * Scan a single directory for wave subdirectories and load each one.
 * @param db - The better-sqlite3 Database instance.
 * @param dirPath - The directory to scan.
 * @param source - The source type (bundled, installed, generated).
 * @returns The number of waves successfully loaded from this directory.
 */
async function loadWavesFromDirectory(
  db: BetterSqlite3.Database,
  dirPath: string,
  source: WaveSource,
): Promise<number> {
  if (!existsSync(dirPath)) {
    loaderLogger.debug({ dirPath }, 'Waves directory does not exist, skipping');
    return 0;
  }

  const entries = readdirSync(dirPath);
  let loadedCount = 0;

  for (const entry of entries) {
    const waveDir = join(dirPath, entry);

    try {
      const stat = statSync(waveDir);
      if (!stat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    try {
      const loaded = await loadSingleWave(db, waveDir, source);
      if (loaded) {
        loadedCount++;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      loaderLogger.warn({ waveDir, error: message }, 'Failed to load wave, skipping');
    }
  }

  return loadedCount;
}

/**
 * Load a single wave from a directory.
 * Reads wave.json, validates the manifest, imports the entry point, and registers it.
 * @param db - The better-sqlite3 Database instance.
 * @param waveDir - Path to the wave's directory.
 * @param source - The source type for DB registration.
 * @returns True if the wave was successfully loaded, false otherwise.
 */
async function loadSingleWave(
  db: BetterSqlite3.Database,
  waveDir: string,
  source: WaveSource,
): Promise<boolean> {
  const manifestPath = join(waveDir, 'wave.json');

  if (!existsSync(manifestPath)) {
    loaderLogger.debug({ waveDir }, 'No wave.json found, skipping directory');
    return false;
  }

  const rawJson = readFileSync(manifestPath, 'utf-8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    loaderLogger.warn({ manifestPath, error: message }, 'Invalid JSON in wave.json');
    return false;
  }

  const validationResult = validateManifest(parsed);

  if (!validationResult.valid || !validationResult.manifest) {
    loaderLogger.warn(
      { manifestPath, errors: validationResult.errors },
      'Wave manifest validation failed',
    );
    return false;
  }

  const manifest = validationResult.manifest;
  const entryPointPath = join(waveDir, manifest.entryPoint);

  if (!existsSync(entryPointPath)) {
    loaderLogger.warn({ entryPointPath }, 'Wave entry point not found');
    return false;
  }

  const moduleUrl = pathToFileURL(entryPointPath).href;
  const waveModule = await import(moduleUrl) as Record<string, unknown>;
  const moduleExports = extractModuleExports(waveModule);

  if (!moduleExports) {
    loaderLogger.warn(
      { manifestPath },
      'Wave entry point missing required exports (plan, execute)',
    );
    return false;
  }

  const wave: Wave = {
    manifest,
    plan: moduleExports.plan,
    execute: moduleExports.execute,
    validate: moduleExports.validate,
  };

  upsertWaveRegistry(db, manifest, source);
  registerWave(manifest.name, wave);

  loaderLogger.info(
    { name: manifest.name, version: manifest.version, source },
    'Wave loaded successfully',
  );

  return true;
}

/**
 * Extract and type-check the required exports from a dynamically imported wave module.
 * @param moduleRecord - The raw module exports object.
 * @returns The typed exports if valid, or undefined if required functions are missing.
 */
function extractModuleExports(
  moduleRecord: Record<string, unknown>,
): WaveModuleExports | undefined {
  const planFn = moduleRecord['plan'];
  const executeFn = moduleRecord['execute'];
  const validateFn = moduleRecord['validate'];

  if (typeof planFn !== 'function' || typeof executeFn !== 'function') {
    return undefined;
  }

  return {
    plan: planFn as WaveModuleExports['plan'],
    execute: executeFn as WaveModuleExports['execute'],
    validate: typeof validateFn === 'function'
      ? validateFn as WaveModuleExports['validate']
      : undefined,
  };
}

/**
 * Insert or update a wave record in the waves_registry DB table.
 * Uses an INSERT OR REPLACE to handle re-loading of already-registered waves.
 * @param db - The better-sqlite3 Database instance.
 * @param manifest - The validated wave manifest.
 * @param source - The source type (bundled, installed, generated).
 * @throws {PersistenceError} If the database operation fails.
 */
function upsertWaveRegistry(
  db: BetterSqlite3.Database,
  manifest: WaveManifest,
  source: WaveSource,
): void {
  try {
    const existingRow = db.prepare(
      'SELECT id FROM waves_registry WHERE name = ? AND source = ?',
    ).get(manifest.name, source) as WaveRegistryRow | undefined;

    const waveId = existingRow?.id ?? nanoid();

    db.prepare(
      `INSERT OR REPLACE INTO waves_registry (id, name, version, source, manifest, is_deterministic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      waveId,
      manifest.name,
      manifest.version,
      source,
      JSON.stringify(manifest),
      manifest.deterministic ? 1 : 0,
    );

    loaderLogger.debug({ name: manifest.name, waveId }, 'Wave registry DB updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to upsert wave registry for "${manifest.name}": ${message}`);
  }
}
