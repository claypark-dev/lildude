import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { installWave, listWaves, uninstallWave, searchWaves } from '../../../src/waves/hub.js';
import { parseGitHubSource, checkWavePermissions } from '../../../src/waves/hub-helpers.js';
import { SecurityError } from '../../../src/errors.js';
import type { WaveManifest } from '../../../src/types/index.js';

// Mock fetchRegistry for searchWaves tests — returns test data instead of hitting remote
vi.mock('../../../src/waves/hub-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/waves/hub-registry.js')>();
  return {
    ...actual,
    fetchRegistry: vi.fn().mockResolvedValue([
      { name: 'weather-checker', description: 'Check weather forecasts for any location', author: 'lil-dude-community', source: 'github:claypark-dev/weather-checker', triggers: ['weather', 'forecast', 'temperature'], version: '1.2.0' },
      { name: 'email-summarizer', description: 'Summarize unread emails from Gmail or Outlook', author: 'lil-dude-community', source: 'github:claypark-dev/email-summarizer', triggers: ['email', 'inbox', 'unread', 'mail'], version: '0.9.0' },
      { name: 'code-reviewer', description: 'Review code changes and provide feedback', author: 'lil-dude-community', source: 'github:claypark-dev/code-reviewer', triggers: ['review', 'code review', 'PR', 'pull request'], version: '2.0.1' },
    ]),
  };
});

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');
const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'waves');

/** Minimal valid manifest for testing. */
function createValidManifest(overrides: Partial<WaveManifest> = {}): WaveManifest {
  return {
    name: 'test-wave',
    version: '1.0.0',
    description: 'A test wave',
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

interface WaveRegistryRow {
  id: string;
  name: string;
  version: string;
  source: string;
  manifest: string;
  is_deterministic: number;
  enabled: number;
}

describe('wave hub', () => {
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

  // === installWave ===

  describe('installWave', () => {
    it('validates manifest and rejects invalid ones', async () => {
      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        mkdirSync(destPath, { recursive: true });
        // Write an invalid manifest (missing required fields)
        writeFileSync(join(destPath, 'wave.json'), JSON.stringify({ name: '' }));
      };

      await expect(
        installWave(manager.db, 'github:user/bad-wave', 3, {
          installedDir: tempInstalledDir,
          cloneFn,
        }),
      ).rejects.toThrow('Invalid wave manifest');
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
        writeFileSync(join(destPath, 'wave.json'), JSON.stringify(manifest));
      };

      await expect(
        installWave(manager.db, 'github:user/dangerous-wave', 1, {
          installedDir: tempInstalledDir,
          cloneFn,
        }),
      ).rejects.toThrow(SecurityError);
    });

    it('copies files to the correct installed directory', async () => {
      const manifest = createValidManifest({ name: 'my-wave' });

      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        mkdirSync(destPath, { recursive: true });
        writeFileSync(join(destPath, 'wave.json'), JSON.stringify(manifest));
        writeFileSync(join(destPath, 'index.js'), 'module.exports = {}');
      };

      const result = await installWave(manager.db, 'github:user/my-wave', 5, {
        installedDir: tempInstalledDir,
        cloneFn,
      });

      expect(result.name).toBe('my-wave');

      const waveDir = join(tempInstalledDir, 'my-wave');
      expect(existsSync(waveDir)).toBe(true);
      expect(existsSync(join(waveDir, 'wave.json'))).toBe(true);
      expect(existsSync(join(waveDir, 'index.js'))).toBe(true);
    });

    it('registers the wave in the DB after installation', async () => {
      const manifest = createValidManifest({ name: 'db-test-wave' });

      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        mkdirSync(destPath, { recursive: true });
        writeFileSync(join(destPath, 'wave.json'), JSON.stringify(manifest));
      };

      await installWave(manager.db, 'github:user/db-test-wave', 5, {
        installedDir: tempInstalledDir,
        cloneFn,
      });

      const row = manager.db.prepare(
        'SELECT * FROM waves_registry WHERE name = ?',
      ).get('db-test-wave') as WaveRegistryRow | undefined;

      expect(row).toBeDefined();
      expect(row!.name).toBe('db-test-wave');
      expect(row!.source).toBe('installed');
      expect(row!.version).toBe('1.0.0');
    });

    it('cleans up temp directory on success', async () => {
      let capturedTempPath = '';
      const manifest = createValidManifest({ name: 'cleanup-test' });

      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        capturedTempPath = destPath;
        mkdirSync(destPath, { recursive: true });
        writeFileSync(join(destPath, 'wave.json'), JSON.stringify(manifest));
      };

      await installWave(manager.db, 'github:user/cleanup-test', 5, {
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
        writeFileSync(join(destPath, 'wave.json'), JSON.stringify({ name: '' }));
      };

      try {
        await installWave(manager.db, 'github:user/fail-wave', 3, {
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

  describe('checkWavePermissions', () => {
    it('allows waves with no special permissions at any level', () => {
      const manifest = createValidManifest();
      expect(() => checkWavePermissions(manifest, 1)).not.toThrow();
    });

    it('blocks shell-requiring waves at security level 1', () => {
      const manifest = createValidManifest({
        permissions: {
          domains: [],
          shell: ['ls'],
          directories: [],
          requiresBrowser: false,
          requiresOAuth: [],
        },
      });

      expect(() => checkWavePermissions(manifest, 1)).toThrow(SecurityError);
    });

    it('blocks browser-requiring waves at security level 2', () => {
      const manifest = createValidManifest({
        permissions: {
          domains: [],
          shell: [],
          directories: [],
          requiresBrowser: true,
          requiresOAuth: [],
        },
      });

      expect(() => checkWavePermissions(manifest, 2)).toThrow(SecurityError);
    });
  });

  // === listWaves ===

  describe('listWaves', () => {
    it('returns bundled and installed waves', () => {
      // Create an installed wave in temp dir
      const installedWaveDir = join(tempInstalledDir, 'custom-wave');
      mkdirSync(installedWaveDir, { recursive: true });
      writeFileSync(
        join(installedWaveDir, 'wave.json'),
        JSON.stringify({ name: 'custom-wave', version: '2.0.0' }),
      );

      const waves = listWaves(manager.db, FIXTURES_DIR, tempInstalledDir);

      const bundledWaves = waves.filter((waveItem) => waveItem.source === 'bundled');
      const installedWaves = waves.filter((waveItem) => waveItem.source === 'installed');

      expect(bundledWaves.length).toBeGreaterThanOrEqual(1);
      expect(installedWaves.length).toBe(1);
      expect(installedWaves[0].name).toBe('custom-wave');
      expect(installedWaves[0].version).toBe('2.0.0');
    });

    it('returns empty array when no waves are installed or bundled', () => {
      const emptyBundled = join(tmpdir(), `lildude-empty-bundled-${nanoid()}`);
      const emptyInstalled = join(tmpdir(), `lildude-empty-installed-${nanoid()}`);

      const waves = listWaves(manager.db, emptyBundled, emptyInstalled);
      expect(waves).toEqual([]);
    });
  });

  // === uninstallWave ===

  describe('uninstallWave', () => {
    it('removes wave from filesystem and DB', async () => {
      // First install a wave
      const manifest = createValidManifest({ name: 'removable-wave' });

      const cloneFn = async (_repoUrl: string, destPath: string): Promise<void> => {
        mkdirSync(destPath, { recursive: true });
        writeFileSync(join(destPath, 'wave.json'), JSON.stringify(manifest));
      };

      await installWave(manager.db, 'github:user/removable-wave', 5, {
        installedDir: tempInstalledDir,
        cloneFn,
      });

      // Verify it was installed
      const waveDir = join(tempInstalledDir, 'removable-wave');
      expect(existsSync(waveDir)).toBe(true);

      // Uninstall
      await uninstallWave(manager.db, 'removable-wave', tempInstalledDir);

      // Verify removal
      expect(existsSync(waveDir)).toBe(false);

      const row = manager.db.prepare(
        'SELECT * FROM waves_registry WHERE name = ? AND source = ?',
      ).get('removable-wave', 'installed') as WaveRegistryRow | undefined;

      expect(row).toBeUndefined();
    });

    it('rejects uninstalling bundled waves', async () => {
      // Insert a bundled wave into the DB
      manager.db.prepare(
        `INSERT INTO waves_registry (id, name, version, source, manifest, is_deterministic, enabled)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      ).run('test-id', 'bundled-wave', '1.0.0', 'bundled', '{}', 1);

      await expect(
        uninstallWave(manager.db, 'bundled-wave', tempInstalledDir),
      ).rejects.toThrow('Cannot uninstall bundled wave');
    });
  });

  // === searchWaves ===

  describe('searchWaves', () => {
    it('filters results by query matching name/description/triggers', async () => {
      const weatherResults = await searchWaves(manager.db, 'weather');
      expect(weatherResults.length).toBeGreaterThan(0);
      expect(weatherResults.some((entry) => entry.name === 'weather-checker')).toBe(true);
    });

    it('returns empty for queries with no matches', async () => {
      const noResults = await searchWaves(manager.db, 'xyznonexistent123');
      expect(noResults).toEqual([]);
    });

    it('matches against triggers', async () => {
      const emailResults = await searchWaves(manager.db, 'inbox');
      expect(emailResults.length).toBeGreaterThan(0);
      expect(emailResults.some((entry) => entry.name === 'email-summarizer')).toBe(true);
    });

    it('is case-insensitive', async () => {
      const results = await searchWaves(manager.db, 'WEATHER');
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
