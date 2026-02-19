/**
 * Helper utilities for the Skill Hub module.
 * Handles source format parsing, permission checking against security levels,
 * and curated skill registry search (mocked).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { SkillManifest } from '../types/index.js';
import type { SecurityLevel } from '../security/permissions.js';
import { SecurityError, PersistenceError } from '../errors.js';
import { createModuleLogger } from '../utils/logger.js';

const hubLogger = createModuleLogger('skill-hub');

/** Parsed GitHub source reference. */
export interface GitHubSource {
  user: string;
  repo: string;
}

/** Entry in the curated skill registry (for search). */
export interface SkillRegistryEntry {
  name: string;
  description: string;
  author: string;
  source: string;
  triggers: string[];
  version: string;
}

/** Source type for a listed skill. */
export type ListedSkillSource = 'bundled' | 'installed';

/** Information about a listed skill. */
export interface ListedSkill {
  name: string;
  version: string;
  source: ListedSkillSource;
  status: 'enabled' | 'disabled';
}

/**
 * Parse a `github:user/repo` source string into user and repo components.
 * @param source - The source string in `github:user/repo` format.
 * @returns The parsed user and repo.
 * @throws {Error} If the source format is invalid.
 */
export function parseGitHubSource(source: string): GitHubSource {
  const githubPrefix = 'github:';

  if (!source.startsWith(githubPrefix)) {
    throw new Error(`Invalid source format: expected "github:user/repo", got "${source}"`);
  }

  const path = source.slice(githubPrefix.length);
  const parts = path.split('/');

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid source format: expected "github:user/repo", got "${source}"`);
  }

  const [user, repo] = parts;

  // Validate no special characters or path traversal sequences
  const safePattern = /^[a-zA-Z0-9_.-]+$/;
  if (!safePattern.test(user) || !safePattern.test(repo)) {
    throw new Error(`Invalid characters in source: user and repo must be alphanumeric with hyphens, dots, or underscores`);
  }

  // Block path traversal via ".." sequences
  if (user.includes('..') || repo.includes('..')) {
    throw new Error(`Invalid characters in source: path traversal sequences are not allowed`);
  }

  return { user, repo };
}

/**
 * Maximum shell commands allowed per security level.
 * Level 1: no shell at all. Level 2: allowlisted only. Level 3+: broader access.
 */
const SHELL_LIMITS: Record<SecurityLevel, number> = {
  1: 0,
  2: 0,
  3: 3,
  4: 10,
  5: Infinity,
};

/**
 * Maximum filesystem directories allowed per security level.
 */
const DIRECTORY_LIMITS: Record<SecurityLevel, number> = {
  1: 0,
  2: 1,
  3: 3,
  4: 10,
  5: Infinity,
};

/**
 * Check a skill manifest's permissions against the user's security level.
 * Skills requesting more permissions than the security level allows are blocked.
 *
 * @param manifest - The validated skill manifest to check.
 * @param securityLevel - The user's configured security level (1-5).
 * @throws {SecurityError} If the skill's permissions exceed what the security level allows.
 */
export function checkSkillPermissions(
  manifest: SkillManifest,
  securityLevel: SecurityLevel,
): void {
  const { permissions } = manifest;

  // Level 1: Block any skill requesting shell or directory access
  if (securityLevel === 1) {
    if (permissions.shell.length > 0 || permissions.directories.length > 0) {
      hubLogger.warn(
        { skill: manifest.name, securityLevel },
        'Skill blocked: requires shell or directory access at security level 1',
      );
      throw new SecurityError(
        `Skill "${manifest.name}" requires shell or filesystem permissions, which are blocked at security level ${securityLevel}`,
      );
    }
  }

  // Check shell command count against limit
  const shellLimit = SHELL_LIMITS[securityLevel];
  if (permissions.shell.length > shellLimit) {
    hubLogger.warn(
      { skill: manifest.name, shellRequested: permissions.shell.length, shellLimit, securityLevel },
      'Skill blocked: requests too many shell commands',
    );
    throw new SecurityError(
      `Skill "${manifest.name}" requests ${permissions.shell.length} shell commands, but security level ${securityLevel} allows at most ${shellLimit}`,
    );
  }

  // Check directory access count against limit
  const dirLimit = DIRECTORY_LIMITS[securityLevel];
  if (permissions.directories.length > dirLimit) {
    hubLogger.warn(
      { skill: manifest.name, dirsRequested: permissions.directories.length, dirLimit, securityLevel },
      'Skill blocked: requests too many directory permissions',
    );
    throw new SecurityError(
      `Skill "${manifest.name}" requests ${permissions.directories.length} directory permissions, but security level ${securityLevel} allows at most ${dirLimit}`,
    );
  }

  // Level 1-2: Block browser-requiring skills
  if (securityLevel <= 2 && permissions.requiresBrowser) {
    hubLogger.warn(
      { skill: manifest.name, securityLevel },
      'Skill blocked: requires browser at restricted security level',
    );
    throw new SecurityError(
      `Skill "${manifest.name}" requires browser access, which is blocked at security level ${securityLevel}`,
    );
  }

  hubLogger.info(
    { skill: manifest.name, securityLevel },
    'Skill permissions check passed',
  );
}

/**
 * Mocked curated skill registry for search functionality.
 * In a real implementation, this would fetch from a remote URL.
 */
const CURATED_REGISTRY: readonly SkillRegistryEntry[] = [
  { name: 'weather-checker', description: 'Check weather forecasts for any location', author: 'lil-dude-community', source: 'github:community/weather-checker', triggers: ['weather', 'forecast', 'temperature'], version: '1.2.0' },
  { name: 'email-summarizer', description: 'Summarize unread emails from Gmail or Outlook', author: 'lil-dude-community', source: 'github:community/email-summarizer', triggers: ['email', 'inbox', 'unread', 'mail'], version: '0.9.0' },
  { name: 'code-reviewer', description: 'Review code changes and provide feedback', author: 'lil-dude-community', source: 'github:community/code-reviewer', triggers: ['review', 'code review', 'PR', 'pull request'], version: '2.0.1' },
  { name: 'note-taker', description: 'Take and organize notes from conversations', author: 'lil-dude-community', source: 'github:community/note-taker', triggers: ['note', 'notes', 'remember', 'save'], version: '1.0.0' },
  { name: 'file-organizer', description: 'Organize files in directories by type and date', author: 'lil-dude-community', source: 'github:community/file-organizer', triggers: ['organize', 'files', 'cleanup', 'sort files'], version: '1.1.0' },
] as const;

/**
 * Search the curated skill registry by query string.
 * Matches against skill name, description, and triggers (case-insensitive).
 *
 * @param query - The search query string.
 * @returns An array of matching skill registry entries.
 */
export function searchCuratedRegistry(query: string): SkillRegistryEntry[] {
  const lowerQuery = query.toLowerCase();

  return CURATED_REGISTRY.filter((entry) => {
    const nameMatch = entry.name.toLowerCase().includes(lowerQuery);
    const descMatch = entry.description.toLowerCase().includes(lowerQuery);
    const triggerMatch = entry.triggers.some(
      (trigger) => trigger.toLowerCase().includes(lowerQuery),
    );

    return nameMatch || descMatch || triggerMatch;
  });
}

/** Shape of a skill_registry DB row for internal use. */
interface SkillRegistryRow {
  id: string;
  name: string;
  version: string;
  source: string;
}

/**
 * Scan a directory for skill subdirectories and return their info.
 * @param dirPath - The directory to scan.
 * @param source - The source type (bundled or installed).
 * @returns An array of listed skills found in the directory.
 */
export function scanSkillDirectory(dirPath: string, source: ListedSkillSource): ListedSkill[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = readdirSync(dirPath);
  const skills: ListedSkill[] = [];

  for (const entry of entries) {
    const skillDir = join(dirPath, entry);

    try {
      if (!statSync(skillDir).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    const manifestPath = join(skillDir, 'skill.json');
    if (!existsSync(manifestPath)) {
      continue;
    }

    try {
      const rawJson = readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      const name = typeof parsed['name'] === 'string' ? parsed['name'] : entry;
      const version = typeof parsed['version'] === 'string' ? parsed['version'] : 'unknown';

      skills.push({ name, version, source, status: 'enabled' });
    } catch {
      skills.push({ name: entry, version: 'unknown', source, status: 'disabled' });
    }
  }

  return skills;
}

/**
 * Insert or update an installed skill record in the skills_registry DB table.
 * @param db - The better-sqlite3 Database instance.
 * @param manifest - The validated skill manifest.
 * @throws {PersistenceError} If the database operation fails.
 */
export function upsertInstalledSkill(
  db: BetterSqlite3.Database,
  manifest: SkillManifest,
): void {
  try {
    const existingRow = db.prepare(
      'SELECT id FROM skills_registry WHERE name = ? AND source = ?',
    ).get(manifest.name, 'installed') as SkillRegistryRow | undefined;

    const skillId = existingRow?.id ?? nanoid();

    db.prepare(
      `INSERT OR REPLACE INTO skills_registry (id, name, version, source, manifest, is_deterministic, enabled)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      skillId,
      manifest.name,
      manifest.version,
      'installed',
      JSON.stringify(manifest),
      manifest.deterministic ? 1 : 0,
    );

    hubLogger.debug({ name: manifest.name, skillId }, 'Installed skill registered in DB');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to register installed skill "${manifest.name}": ${message}`);
  }
}
