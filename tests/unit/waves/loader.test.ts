import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { loadWaves } from '../../../src/waves/loader.js';
import { getWave, clearRegistry } from '../../../src/waves/registry.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');
const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'waves');

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

describe('wave loader', () => {
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

  it('loads a valid wave from the fixtures directory', async () => {
    const loaded = await loadWaves(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    expect(loaded).toBeGreaterThanOrEqual(1);

    const wave = getWave('stock-checker');
    expect(wave).toBeDefined();
    expect(wave!.manifest.name).toBe('stock-checker');
    expect(wave!.manifest.version).toBe('1.0.0');
    expect(wave!.manifest.triggers).toContain('stock');
  });

  it('skips invalid manifests with a warning (no crash)', async () => {
    const loaded = await loadWaves(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    // invalid-wave directory has an incomplete manifest, should be skipped
    const invalidWave = getWave('broken-wave');
    expect(invalidWave).toBeUndefined();

    // valid wave should still load
    expect(loaded).toBeGreaterThanOrEqual(1);
  });

  it('skips directories without wave.json', async () => {
    const loaded = await loadWaves(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    // missing-manifest directory has no wave.json
    // The loader should not crash and should continue loading other waves
    expect(loaded).toBeGreaterThanOrEqual(1);
  });

  it('skips waves with missing entry point files', async () => {
    const loaded = await loadWaves(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    // bad-entry-point has a valid manifest but the entry point file doesn't exist
    const badWave = getWave('bad-entry');
    expect(badWave).toBeUndefined();

    // valid waves should still be loaded
    expect(loaded).toBeGreaterThanOrEqual(1);
  });

  it('loads the entry point module with plan and execute functions', async () => {
    await loadWaves(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    const wave = getWave('stock-checker');
    expect(wave).toBeDefined();
    expect(typeof wave!.plan).toBe('function');
    expect(typeof wave!.execute).toBe('function');

    // Verify the plan function is callable
    const plan = await wave!.plan('check my stocks', {});
    expect(plan.steps).toBeDefined();
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.isDeterministic).toBe(true);
  });

  it('loads the optional validate function from entry point', async () => {
    await loadWaves(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    const wave = getWave('stock-checker');
    expect(wave).toBeDefined();
    expect(typeof wave!.validate).toBe('function');

    const validationResult = await wave!.validate!({ success: true, output: 'ok' });
    expect(validationResult.valid).toBe(true);
  });

  it('inserts a record into waves_registry DB table', async () => {
    await loadWaves(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    const row = manager.db.prepare(
      'SELECT * FROM waves_registry WHERE name = ?',
    ).get('stock-checker') as WaveRegistryRow | undefined;

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
    const loaded = await loadWaves(
      manager.db,
      '/nonexistent-bundled-dir',
      '/nonexistent-installed-dir',
    );

    expect(loaded).toBe(0);
  });

  it('re-loading updates the DB registry (upsert)', async () => {
    await loadWaves(manager.db, FIXTURES_DIR, '/nonexistent-installed');
    await loadWaves(manager.db, FIXTURES_DIR, '/nonexistent-installed');

    const rows = manager.db.prepare(
      'SELECT * FROM waves_registry WHERE name = ?',
    ).all('stock-checker') as WaveRegistryRow[];

    // Should only have one row, not duplicates
    expect(rows).toHaveLength(1);
  });
});
