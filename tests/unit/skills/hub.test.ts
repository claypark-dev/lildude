import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { installSkill, listSkills, uninstallSkill, searchSkills } from '../../../src/skills/hub.js';
import { parseGitHubSource, checkSkillPermissions } from '../../../src/skills/hub-helpers.js';
import { SecurityError } from '../../../src/errors.js';
import type { SkillManifest } from '../../../src/types/index.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');
const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'skills');

/** Minimal valid manifest for testing. */
function createValidManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name: 'test-skill',
    version: '1.0.0',
    description: 'A test skill',
    author: 'tester',
    permissions: {
      domains: [],
      shell: [],
      directories: [],
      requiresBrowser: false,
      requiresOAuth: [],
    },
    triggers: ['test'],
    deterministic: true,
    tools: [],
    minTier: 'basic',
    entryPoint: 'index.js',
    ...overrides,
  };
}

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

interface SkillRegistryRow {
  id: string;
  name: string;
  version: string;
  source: string;
  manifest: string;
  is_deterministic: number;
  enabled: number;
}

describe('skill hub', () => {
  let manager: DatabaseManager;
  let tempInstalledDir: string;

  beforeEach(() => {
    manager = createTestDb();
    tempInstalledDir = join(tmpdir(), `lildude-test-installed-${nanoid()}`);
    mkdirSync(tempInstalledDir, { recursive: true });
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {
      // best-effort cleanup
    }
    try {
      rmSync(tempInstalledDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  // === Source format parsing ===

  describe('parseGitHubSource', () => {
    it('parses valid github:user/repo format', () => {
      const parsed = parseGitHubSource('github:octocat/hello-world');
      expect(parsed.user).toBe('octocat');
      expect(parsed.repo).toBe('hello-world');
    });

    it('rejects invalid source format without github: prefix', () => {
      expect(() => parseGitHubSource('npm:some-package')).toThrow('Invalid source format');
    });

    it('rejects source with missing repo', () => {
      expect(() => parseGitHubSource('github:user-only')).toThrow('Invalid source format');
    });

    it('rejects source with path traversal characters', () => {
      expect(() => parseGitHubSource('github:..evil/repo')).toThrow('Invalid characters');
    });
  });

  // === installSkill ===

  describe('installSkill', () => {
    it('validates manifest and rejects invalid ones', async () => {
      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        mkdirSync(destPath, { recursive: true });
        // Write an invalid manifest (missing required fields)
        writeFileSync(join(destPath, 'skill.json'), JSON.stringify({ name: '' }));
      };

      await expect(
        installSkill(manager.db, 'github:user/bad-skill', 3, {
          installedDir: tempInstalledDir,
          cloneFn,
        }),
      ).rejects.toThrow('Invalid skill manifest');
    });

    it('checks permissions against security level and rejects excessive permissions', async () => {
      const manifest = createValidManifest({
        permissions: {
          domains: [],
          shell: ['rm', 'chmod', 'chown', 'apt'],
          directories: ['/tmp', '/var'],
          requiresBrowser: false,
          requiresOAuth: [],
        },
      });

      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        mkdirSync(destPath, { recursive: true });
        writeFileSync(join(destPath, 'skill.json'), JSON.stringify(manifest));
      };

      await expect(
        installSkill(manager.db, 'github:user/dangerous-skill', 1, {
          installedDir: tempInstalledDir,
          cloneFn,
        }),
      ).rejects.toThrow(SecurityError);
    });

    it('copies files to the correct installed directory', async () => {
      const manifest = createValidManifest({ name: 'my-skill' });

      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        mkdirSync(destPath, { recursive: true });
        writeFileSync(join(destPath, 'skill.json'), JSON.stringify(manifest));
        writeFileSync(join(destPath, 'index.js'), 'module.exports = {}');
      };

      const result = await installSkill(manager.db, 'github:user/my-skill', 5, {
        installedDir: tempInstalledDir,
        cloneFn,
      });

      expect(result.name).toBe('my-skill');

      const skillDir = join(tempInstalledDir, 'my-skill');
      expect(existsSync(skillDir)).toBe(true);
      expect(existsSync(join(skillDir, 'skill.json'))).toBe(true);
      expect(existsSync(join(skillDir, 'index.js'))).toBe(true);
    });

    it('registers the skill in the DB after installation', async () => {
      const manifest = createValidManifest({ name: 'db-test-skill' });

      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        mkdirSync(destPath, { recursive: true });
        writeFileSync(join(destPath, 'skill.json'), JSON.stringify(manifest));
      };

      await installSkill(manager.db, 'github:user/db-test-skill', 5, {
        installedDir: tempInstalledDir,
        cloneFn,
      });

      const row = manager.db.prepare(
        'SELECT * FROM skills_registry WHERE name = ?',
      ).get('db-test-skill') as SkillRegistryRow | undefined;

      expect(row).toBeDefined();
      expect(row!.name).toBe('db-test-skill');
      expect(row!.source).toBe('installed');
      expect(row!.version).toBe('1.0.0');
    });

    it('cleans up temp directory on success', async () => {
      let capturedTempPath = '';
      const manifest = createValidManifest({ name: 'cleanup-test' });

      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        capturedTempPath = destPath;
        mkdirSync(destPath, { recursive: true });
        writeFileSync(join(destPath, 'skill.json'), JSON.stringify(manifest));
      };

      await installSkill(manager.db, 'github:user/cleanup-test', 5, {
        installedDir: tempInstalledDir,
        cloneFn,
      });

      // The temp directory should be cleaned up
      expect(capturedTempPath).toBeTruthy();
      expect(existsSync(capturedTempPath)).toBe(false);
    });

    it('cleans up temp directory on failure', async () => {
      let capturedTempPath = '';

      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        capturedTempPath = destPath;
        mkdirSync(destPath, { recursive: true });
        // Write invalid manifest to cause failure
        writeFileSync(join(destPath, 'skill.json'), JSON.stringify({ name: '' }));
      };

      try {
        await installSkill(manager.db, 'github:user/fail-skill', 3, {
          installedDir: tempInstalledDir,
          cloneFn,
        });
      } catch {
        // Expected to throw
      }

      expect(capturedTempPath).toBeTruthy();
      expect(existsSync(capturedTempPath)).toBe(false);
    });
  });

  // === Permission checking ===

  describe('checkSkillPermissions', () => {
    it('allows skills with no special permissions at any level', () => {
      const manifest = createValidManifest();
      expect(() => checkSkillPermissions(manifest, 1)).not.toThrow();
    });

    it('blocks shell-requiring skills at security level 1', () => {
      const manifest = createValidManifest({
        permissions: {
          domains: [],
          shell: ['ls'],
          directories: [],
          requiresBrowser: false,
          requiresOAuth: [],
        },
      });

      expect(() => checkSkillPermissions(manifest, 1)).toThrow(SecurityError);
    });

    it('blocks browser-requiring skills at security level 2', () => {
      const manifest = createValidManifest({
        permissions: {
          domains: [],
          shell: [],
          directories: [],
          requiresBrowser: true,
          requiresOAuth: [],
        },
      });

      expect(() => checkSkillPermissions(manifest, 2)).toThrow(SecurityError);
    });
  });

  // === listSkills ===

  describe('listSkills', () => {
    it('returns bundled and installed skills', () => {
      // Create an installed skill in temp dir
      const installedSkillDir = join(tempInstalledDir, 'custom-skill');
      mkdirSync(installedSkillDir, { recursive: true });
      writeFileSync(
        join(installedSkillDir, 'skill.json'),
        JSON.stringify({ name: 'custom-skill', version: '2.0.0' }),
      );

      const skills = listSkills(manager.db, FIXTURES_DIR, tempInstalledDir);

      const bundledSkills = skills.filter((skillItem) => skillItem.source === 'bundled');
      const installedSkills = skills.filter((skillItem) => skillItem.source === 'installed');

      expect(bundledSkills.length).toBeGreaterThanOrEqual(1);
      expect(installedSkills.length).toBe(1);
      expect(installedSkills[0].name).toBe('custom-skill');
      expect(installedSkills[0].version).toBe('2.0.0');
    });

    it('returns empty array when no skills are installed or bundled', () => {
      const emptyBundled = join(tmpdir(), `lildude-empty-bundled-${nanoid()}`);
      const emptyInstalled = join(tmpdir(), `lildude-empty-installed-${nanoid()}`);

      const skills = listSkills(manager.db, emptyBundled, emptyInstalled);
      expect(skills).toEqual([]);
    });
  });

  // === uninstallSkill ===

  describe('uninstallSkill', () => {
    it('removes skill from filesystem and DB', async () => {
      // First install a skill
      const manifest = createValidManifest({ name: 'removable-skill' });

      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        mkdirSync(destPath, { recursive: true });
        writeFileSync(join(destPath, 'skill.json'), JSON.stringify(manifest));
      };

      await installSkill(manager.db, 'github:user/removable-skill', 5, {
        installedDir: tempInstalledDir,
        cloneFn,
      });

      // Verify it was installed
      const skillDir = join(tempInstalledDir, 'removable-skill');
      expect(existsSync(skillDir)).toBe(true);

      // Uninstall
      await uninstallSkill(manager.db, 'removable-skill', tempInstalledDir);

      // Verify removal
      expect(existsSync(skillDir)).toBe(false);

      const row = manager.db.prepare(
        'SELECT * FROM skills_registry WHERE name = ? AND source = ?',
      ).get('removable-skill', 'installed') as SkillRegistryRow | undefined;

      expect(row).toBeUndefined();
    });

    it('rejects uninstalling bundled skills', async () => {
      // Insert a bundled skill into the DB
      manager.db.prepare(
        `INSERT INTO skills_registry (id, name, version, source, manifest, is_deterministic, enabled)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      ).run('test-id', 'bundled-skill', '1.0.0', 'bundled', '{}', 1);

      await expect(
        uninstallSkill(manager.db, 'bundled-skill', tempInstalledDir),
      ).rejects.toThrow('Cannot uninstall bundled skill');
    });
  });

  // === searchSkills ===

  describe('searchSkills', () => {
    it('filters results by query matching name/description/triggers', () => {
      const weatherResults = searchSkills('weather');
      expect(weatherResults.length).toBeGreaterThan(0);
      expect(weatherResults.some((entry) => entry.name === 'weather-checker')).toBe(true);
    });

    it('returns empty for queries with no matches', () => {
      const noResults = searchSkills('xyznonexistent123');
      expect(noResults).toEqual([]);
    });

    it('matches against triggers', () => {
      const emailResults = searchSkills('inbox');
      expect(emailResults.length).toBeGreaterThan(0);
      expect(emailResults.some((entry) => entry.name === 'email-summarizer')).toBe(true);
    });

    it('is case-insensitive', () => {
      const results = searchSkills('WEATHER');
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
