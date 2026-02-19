/**
 * Skill loader — scans filesystem directories for skill definitions.
 * Reads skill.json manifests, validates them, dynamically imports entry points,
 * and registers valid skills in both the database and in-memory registry.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nanoid } from 'nanoid';
import type { Skill, SkillManifest, SkillPlan, ToolResult } from '../types/index.js';
import { validateManifest } from './schema.js';
import { registerSkill } from './registry.js';
import { createModuleLogger } from '../utils/logger.js';
import { PersistenceError } from '../errors.js';

const loaderLogger = createModuleLogger('skill-loader');

/** Source type for a skill (matches the DB CHECK constraint). */
type SkillSource = 'bundled' | 'installed' | 'generated';

/** Shape of a raw skill module's exports after dynamic import. */
interface SkillModuleExports {
  plan: (userInput: string, context: Record<string, unknown>) => Promise<SkillPlan>;
  execute: (plan: SkillPlan) => Promise<ToolResult>;
  validate?: (result: ToolResult) => Promise<{ valid: boolean; feedback?: string }>;
}

/** Shape of a skill_registry DB row. */
interface SkillRegistryRow {
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
 * Load all skills from bundled and installed directories.
 * Scans each directory for subdirectories containing a skill.json manifest,
 * validates the manifest, dynamically imports the entry point module,
 * and registers the skill in the DB and in-memory registry.
 *
 * Invalid skills are logged as warnings and skipped.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param bundledDir - Path to the bundled skills directory. Defaults to 'skills/bundled'.
 * @param installedDir - Path to installed skills directory. Defaults to '~/.lil-dude/skills/installed'.
 * @returns The number of successfully loaded skills.
 */
export async function loadSkills(
  db: BetterSqlite3.Database,
  bundledDir?: string,
  installedDir?: string,
): Promise<number> {
  const resolvedBundledDir = bundledDir ?? join(process.cwd(), 'skills', 'bundled');
  const resolvedInstalledDir = installedDir ?? join(
    process.env.HOME ?? process.env.USERPROFILE ?? '.',
    '.lil-dude',
    'skills',
    'installed',
  );

  let loadedCount = 0;

  try {
    const bundledLoaded = await loadSkillsFromDirectory(
      db,
      resolvedBundledDir,
      'bundled',
    );
    loadedCount += bundledLoaded;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    loaderLogger.warn({ dir: resolvedBundledDir, error: message }, 'Failed to scan bundled skills directory');
  }

  try {
    const installedLoaded = await loadSkillsFromDirectory(
      db,
      resolvedInstalledDir,
      'installed',
    );
    loadedCount += installedLoaded;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    loaderLogger.warn({ dir: resolvedInstalledDir, error: message }, 'Failed to scan installed skills directory');
  }

  loaderLogger.info({ loadedCount }, 'Skill loading complete');
  return loadedCount;
}

/**
 * Scan a single directory for skill subdirectories and load each one.
 * @param db - The better-sqlite3 Database instance.
 * @param dirPath - The directory to scan.
 * @param source - The source type (bundled, installed, generated).
 * @returns The number of skills successfully loaded from this directory.
 */
async function loadSkillsFromDirectory(
  db: BetterSqlite3.Database,
  dirPath: string,
  source: SkillSource,
): Promise<number> {
  if (!existsSync(dirPath)) {
    loaderLogger.debug({ dirPath }, 'Skills directory does not exist, skipping');
    return 0;
  }

  const entries = readdirSync(dirPath);
  let loadedCount = 0;

  for (const entry of entries) {
    const skillDir = join(dirPath, entry);

    try {
      const stat = statSync(skillDir);
      if (!stat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    try {
      const loaded = await loadSingleSkill(db, skillDir, source);
      if (loaded) {
        loadedCount++;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      loaderLogger.warn({ skillDir, error: message }, 'Failed to load skill, skipping');
    }
  }

  return loadedCount;
}

/**
 * Load a single skill from a directory.
 * Reads skill.json, validates the manifest, imports the entry point, and registers it.
 * @param db - The better-sqlite3 Database instance.
 * @param skillDir - Path to the skill's directory.
 * @param source - The source type for DB registration.
 * @returns True if the skill was successfully loaded, false otherwise.
 */
async function loadSingleSkill(
  db: BetterSqlite3.Database,
  skillDir: string,
  source: SkillSource,
): Promise<boolean> {
  const manifestPath = join(skillDir, 'skill.json');

  if (!existsSync(manifestPath)) {
    loaderLogger.debug({ skillDir }, 'No skill.json found, skipping directory');
    return false;
  }

  const rawJson = readFileSync(manifestPath, 'utf-8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    loaderLogger.warn({ manifestPath, error: message }, 'Invalid JSON in skill.json');
    return false;
  }

  const validationResult = validateManifest(parsed);

  if (!validationResult.valid || !validationResult.manifest) {
    loaderLogger.warn(
      { manifestPath, errors: validationResult.errors },
      'Skill manifest validation failed',
    );
    return false;
  }

  const manifest = validationResult.manifest;
  const entryPointPath = join(skillDir, manifest.entryPoint);

  if (!existsSync(entryPointPath)) {
    loaderLogger.warn({ entryPointPath }, 'Skill entry point not found');
    return false;
  }

  const moduleUrl = pathToFileURL(entryPointPath).href;
  const skillModule = await import(moduleUrl) as Record<string, unknown>;
  const moduleExports = extractModuleExports(skillModule);

  if (!moduleExports) {
    loaderLogger.warn(
      { manifestPath },
      'Skill entry point missing required exports (plan, execute)',
    );
    return false;
  }

  const skill: Skill = {
    manifest,
    plan: moduleExports.plan,
    execute: moduleExports.execute,
    validate: moduleExports.validate,
  };

  upsertSkillRegistry(db, manifest, source);
  registerSkill(manifest.name, skill);

  loaderLogger.info(
    { name: manifest.name, version: manifest.version, source },
    'Skill loaded successfully',
  );

  return true;
}

/**
 * Extract and type-check the required exports from a dynamically imported skill module.
 * @param moduleRecord - The raw module exports object.
 * @returns The typed exports if valid, or undefined if required functions are missing.
 */
function extractModuleExports(
  moduleRecord: Record<string, unknown>,
): SkillModuleExports | undefined {
  const planFn = moduleRecord['plan'];
  const executeFn = moduleRecord['execute'];
  const validateFn = moduleRecord['validate'];

  if (typeof planFn !== 'function' || typeof executeFn !== 'function') {
    return undefined;
  }

  return {
    plan: planFn as SkillModuleExports['plan'],
    execute: executeFn as SkillModuleExports['execute'],
    validate: typeof validateFn === 'function'
      ? validateFn as SkillModuleExports['validate']
      : undefined,
  };
}

/**
 * Insert or update a skill record in the skills_registry DB table.
 * Uses an INSERT OR REPLACE to handle re-loading of already-registered skills.
 * @param db - The better-sqlite3 Database instance.
 * @param manifest - The validated skill manifest.
 * @param source - The source type (bundled, installed, generated).
 * @throws {PersistenceError} If the database operation fails.
 */
function upsertSkillRegistry(
  db: BetterSqlite3.Database,
  manifest: SkillManifest,
  source: SkillSource,
): void {
  try {
    const existingRow = db.prepare(
      'SELECT id FROM skills_registry WHERE name = ? AND source = ?',
    ).get(manifest.name, source) as SkillRegistryRow | undefined;

    const skillId = existingRow?.id ?? nanoid();

    db.prepare(
      `INSERT OR REPLACE INTO skills_registry (id, name, version, source, manifest, is_deterministic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      skillId,
      manifest.name,
      manifest.version,
      source,
      JSON.stringify(manifest),
      manifest.deterministic ? 1 : 0,
    );

    loaderLogger.debug({ name: manifest.name, skillId }, 'Skill registry DB updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to upsert skill registry for "${manifest.name}": ${message}`);
  }
}
