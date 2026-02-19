/**
 * Skill Hub — S3.R.1
 *
 * Marketplace installer for skills from GitHub repositories.
 * Provides install, list, uninstall, and search functionality.
 * The hub does NOT execute skills — it only manages installation lifecycle.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { nanoid } from 'nanoid';
import type { SkillManifest } from '../types/index.js';
import type { SecurityLevel } from '../security/permissions.js';
import { SecurityError, PersistenceError } from '../errors.js';
import { validateManifest } from './schema.js';
import { clearRegistry } from './registry.js';
import { appendSecurityLog } from '../persistence/security-log.js';
import { homeDir } from '../config/loader.js';
import { createModuleLogger } from '../utils/logger.js';
import {
  parseGitHubSource,
  checkSkillPermissions,
  searchCuratedRegistry,
  scanSkillDirectory,
  upsertInstalledSkill,
  type ListedSkill,
  type SkillRegistryEntry,
} from './hub-helpers.js';

const hubLogger = createModuleLogger('skill-hub');
const execFileAsync = promisify(execFile);

/** Options for the installSkill function, supporting dependency injection. */
export interface InstallSkillOptions {
  installedDir?: string;
  cloneFn?: (repoUrl: string, destPath: string) => Promise<void>;
}

/**
 * Install a skill from a GitHub source reference.
 *
 * Workflow:
 * 1. Parse the `github:user/repo` source format
 * 2. Clone the repository to a temporary directory
 * 3. Read and validate the `skill.json` manifest
 * 4. Check permissions against the user's security level
 * 5. Copy the skill to `~/.lil-dude/skills/installed/{name}/`
 * 6. Register in the skills_registry DB table
 * 7. Clean up the temporary directory
 *
 * @param db - The better-sqlite3 Database instance.
 * @param source - The skill source in `github:user/repo` format.
 * @param securityLevel - The user's configured security level (1-5).
 * @param options - Optional overrides for testing (clone function, directories).
 * @returns The validated skill manifest of the installed skill.
 * @throws {Error} If the source format is invalid or cloning fails.
 * @throws {SecurityError} If the skill's permissions exceed the security level.
 */
export async function installSkill(
  db: BetterSqlite3.Database,
  source: string,
  securityLevel: SecurityLevel,
  options: InstallSkillOptions = {},
): Promise<SkillManifest> {
  const { user, repo } = parseGitHubSource(source);
  const repoUrl = `https://github.com/${user}/${repo}.git`;
  const tempPath = join(tmpdir(), `lildude-install-${nanoid()}`);
  const installedBase = options.installedDir ?? join(homeDir(), 'skills', 'installed');
  const cloneFn = options.cloneFn ?? defaultClone;

  hubLogger.info({ source, user, repo, tempPath }, 'Starting skill installation');

  try {
    await cloneFn(repoUrl, tempPath);

    const manifestPath = join(tempPath, 'skill.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`No skill.json found in repository ${source}`);
    }

    const rawJson = readFileSync(manifestPath, 'utf-8');
    const parsed: unknown = JSON.parse(rawJson);
    const validationResult = validateManifest(parsed);

    if (!validationResult.valid || !validationResult.manifest) {
      const errorMessages = validationResult.errors?.join('; ') ?? 'Unknown validation error';
      throw new Error(`Invalid skill manifest in ${source}: ${errorMessages}`);
    }

    const manifest = validationResult.manifest;
    checkSkillPermissions(manifest, securityLevel);

    appendSecurityLog(db, {
      actionType: 'skill_install',
      actionDetail: `Installing skill "${manifest.name}" from ${source}`,
      allowed: true,
      securityLevel,
      reason: 'Skill permissions check passed',
    });

    const skillDestDir = join(installedBase, manifest.name);
    await mkdir(skillDestDir, { recursive: true });
    await cp(tempPath, skillDestDir, { recursive: true });

    upsertInstalledSkill(db, manifest);

    hubLogger.info(
      { name: manifest.name, version: manifest.version, dest: skillDestDir },
      'Skill installed successfully',
    );

    return manifest;
  } catch (error: unknown) {
    if (error instanceof SecurityError) {
      appendSecurityLog(db, {
        actionType: 'skill_install',
        actionDetail: `Blocked skill installation from ${source}`,
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
 * List all skills (bundled and installed).
 *
 * @param db - The better-sqlite3 Database instance.
 * @param bundledDir - Path to the bundled skills directory.
 * @param installedDir - Path to the installed skills directory.
 * @returns An array of listed skills with name, version, source, and status.
 */
export function listSkills(
  db: BetterSqlite3.Database,
  bundledDir?: string,
  installedDir?: string,
): ListedSkill[] {
  const resolvedBundledDir = bundledDir ?? join(process.cwd(), 'skills', 'bundled');
  const resolvedInstalledDir = installedDir ?? join(homeDir(), 'skills', 'installed');
  const skills: ListedSkill[] = [];

  try {
    skills.push(...scanSkillDirectory(resolvedBundledDir, 'bundled'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    hubLogger.warn({ dir: resolvedBundledDir, error: message }, 'Failed to scan bundled skills');
  }

  try {
    skills.push(...scanSkillDirectory(resolvedInstalledDir, 'installed'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    hubLogger.warn({ dir: resolvedInstalledDir, error: message }, 'Failed to scan installed skills');
  }

  return skills;
}

/**
 * Uninstall a previously installed skill.
 * Only allows uninstalling skills from the `installed/` directory (not bundled).
 *
 * @param db - The better-sqlite3 Database instance.
 * @param name - The skill name to uninstall.
 * @param installedDir - Path to the installed skills directory.
 * @throws {Error} If the skill is bundled or not found.
 */
export async function uninstallSkill(
  db: BetterSqlite3.Database,
  name: string,
  installedDir?: string,
): Promise<void> {
  const resolvedInstalledDir = installedDir ?? join(homeDir(), 'skills', 'installed');
  const skillDir = join(resolvedInstalledDir, name);

  const row = db.prepare(
    'SELECT source FROM skills_registry WHERE name = ?',
  ).get(name) as { source: string } | undefined;

  if (row?.source === 'bundled') {
    throw new Error(
      `Cannot uninstall bundled skill "${name}". Bundled skills are part of the core distribution.`,
    );
  }

  if (!existsSync(skillDir)) {
    throw new Error(`Skill "${name}" is not installed at ${skillDir}`);
  }

  try {
    await rm(skillDir, { recursive: true, force: true });
    db.prepare('DELETE FROM skills_registry WHERE name = ? AND source = ?').run(name, 'installed');
    clearRegistry();

    hubLogger.info({ name, dir: skillDir }, 'Skill uninstalled successfully');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to uninstall skill "${name}": ${message}`);
  }
}

/**
 * Search the curated skill registry for skills matching a query.
 *
 * @param query - The search query string.
 * @returns An array of matching skill registry entries.
 */
export function searchSkills(query: string): SkillRegistryEntry[] {
  return searchCuratedRegistry(query);
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
