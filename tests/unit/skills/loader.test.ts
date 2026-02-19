import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { loadSkills } from '../../../src/skills/loader.js';
import { getSkill, clearRegistry } from '../../../src/skills/registry.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');
const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'skills');

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

describe('skill loader', () => {
  let manager: DatabaseManager;

  beforeEach(() => {
    clearRegistry();
    manager = createTestDb();
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {
      // best-effort cleanup
    }
    clearRegistry();
  });

  it('loads a valid skill from the fixtures directory', async () => {
    const loaded = await loadSkills(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    expect(loaded).toBeGreaterThanOrEqual(1);

    const skill = getSkill('stock-checker');
    expect(skill).toBeDefined();
    expect(skill!.manifest.name).toBe('stock-checker');
    expect(skill!.manifest.version).toBe('1.0.0');
    expect(skill!.manifest.triggers).toContain('stock');
  });

  it('skips invalid manifests with a warning (no crash)', async () => {
    const loaded = await loadSkills(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    // invalid-skill directory has an incomplete manifest, should be skipped
    const invalidSkill = getSkill('broken-skill');
    expect(invalidSkill).toBeUndefined();

    // valid skill should still load
    expect(loaded).toBeGreaterThanOrEqual(1);
  });

  it('skips directories without skill.json', async () => {
    const loaded = await loadSkills(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    // missing-manifest directory has no skill.json
    // The loader should not crash and should continue loading other skills
    expect(loaded).toBeGreaterThanOrEqual(1);
  });

  it('skips skills with missing entry point files', async () => {
    const loaded = await loadSkills(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    // bad-entry-point has a valid manifest but the entry point file doesn't exist
    const badSkill = getSkill('bad-entry');
    expect(badSkill).toBeUndefined();

    // valid skills should still be loaded
    expect(loaded).toBeGreaterThanOrEqual(1);
  });

  it('loads the entry point module with plan and execute functions', async () => {
    await loadSkills(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    const skill = getSkill('stock-checker');
    expect(skill).toBeDefined();
    expect(typeof skill!.plan).toBe('function');
    expect(typeof skill!.execute).toBe('function');

    // Verify the plan function is callable
    const plan = await skill!.plan('check my stocks', {});
    expect(plan.steps).toBeDefined();
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.isDeterministic).toBe(true);
  });

  it('loads the optional validate function from entry point', async () => {
    await loadSkills(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    const skill = getSkill('stock-checker');
    expect(skill).toBeDefined();
    expect(typeof skill!.validate).toBe('function');

    const validationResult = await skill!.validate!({ success: true, output: 'ok' });
    expect(validationResult.valid).toBe(true);
  });

  it('inserts a record into skills_registry DB table', async () => {
    await loadSkills(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    const row = manager.db.prepare(
      'SELECT * FROM skills_registry WHERE name = ?',
    ).get('stock-checker') as SkillRegistryRow | undefined;

    expect(row).toBeDefined();
    expect(row!.name).toBe('stock-checker');
    expect(row!.version).toBe('1.0.0');
    expect(row!.source).toBe('bundled');
    expect(row!.is_deterministic).toBe(1);
    expect(row!.enabled).toBe(1);

    // Manifest JSON should be parseable
    const storedManifest = JSON.parse(row!.manifest) as Record<string, unknown>;
    expect(storedManifest['name']).toBe('stock-checker');
  });

  it('handles nonexistent directories gracefully', async () => {
    const loaded = await loadSkills(
      manager.db,
      '/nonexistent-bundled-dir',
      '/nonexistent-installed-dir',
    );

    expect(loaded).toBe(0);
  });

  it('re-loading updates the DB registry (upsert)', async () => {
    await loadSkills(manager.db, FIXTURES_DIR, '/nonexistent-installed');
    await loadSkills(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    const rows = manager.db.prepare(
      'SELECT * FROM skills_registry WHERE name = ?',
    ).all('stock-checker') as SkillRegistryRow[];

    // Should only have one row, not duplicates
    expect(rows).toHaveLength(1);
  });
});
