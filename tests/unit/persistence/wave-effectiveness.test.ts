import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import {
  recordWaveExecution,
  getWaveEffectiveness,
  computeEffectivenessScore,
  getTopWavesByUsage,
} from '../../../src/persistence/wave-effectiveness.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

/** Insert a generated wave record for testing. */
function insertTestWave(db: BetterSqlite3.Database, name: string): void {
  db.prepare(`
    INSERT INTO generated_waves (id, name, description, source_code, manifest, safety_tier, source_template, user_approved)
    VALUES (?, ?, 'Test wave', 'console.log("test")', '{}', 'observe', 'test-template', 1)
  `).run(name, name);
}

describe('wave-effectiveness DAL', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  it('recordWaveExecution increments usage_count on success', () => {
    insertTestWave(db, 'test-wave');

    recordWaveExecution(db, 'test-wave', true);

    const stats = getWaveEffectiveness(db, 'test-wave');
    expect(stats).not.toBeNull();
    expect(stats!.usageCount).toBe(1);
    expect(stats!.successCount).toBe(1);
    expect(stats!.successRate).toBe(1);
  });

  it('recordWaveExecution increments usage_count on failure without incrementing success_count', () => {
    insertTestWave(db, 'failing-wave');

    recordWaveExecution(db, 'failing-wave', false);

    const stats = getWaveEffectiveness(db, 'failing-wave');
    expect(stats).not.toBeNull();
    expect(stats!.usageCount).toBe(1);
    expect(stats!.successCount).toBe(0);
    expect(stats!.successRate).toBe(0);
  });

  it('recordWaveExecution accumulates multiple executions', () => {
    insertTestWave(db, 'multi-wave');

    recordWaveExecution(db, 'multi-wave', true);
    recordWaveExecution(db, 'multi-wave', true);
    recordWaveExecution(db, 'multi-wave', false);

    const stats = getWaveEffectiveness(db, 'multi-wave');
    expect(stats).not.toBeNull();
    expect(stats!.usageCount).toBe(3);
    expect(stats!.successCount).toBe(2);
    expect(stats!.successRate).toBeCloseTo(2 / 3, 6);
  });

  it('recordWaveExecution silently skips bundled waves not in generated_waves', () => {
    // Should not throw when wave doesn't exist
    expect(() => recordWaveExecution(db, 'nonexistent-wave', true)).not.toThrow();
  });

  it('getWaveEffectiveness returns null for unknown wave', () => {
    const stats = getWaveEffectiveness(db, 'unknown-wave');
    expect(stats).toBeNull();
  });

  it('getWaveEffectiveness includes lastUsedAt', () => {
    insertTestWave(db, 'timed-wave');
    recordWaveExecution(db, 'timed-wave', true);

    const stats = getWaveEffectiveness(db, 'timed-wave');
    expect(stats).not.toBeNull();
    expect(stats!.lastUsedAt).toBeDefined();
  });

  it('computeEffectivenessScore returns null for unknown wave', () => {
    const score = computeEffectivenessScore(db, 'unknown-wave');
    expect(score).toBeNull();
  });

  it('computeEffectivenessScore uses Bayesian average', () => {
    insertTestWave(db, 'scored-wave');

    // All successes: score should be high but pulled toward prior
    for (let idx = 0; idx < 10; idx++) {
      recordWaveExecution(db, 'scored-wave', true);
    }

    const score = computeEffectivenessScore(db, 'scored-wave');
    expect(score).not.toBeNull();
    // (10 + 3*0.7) / (10 + 3) = 12.1/13 ≈ 0.931
    expect(score!).toBeCloseTo(12.1 / 13, 2);
  });

  it('computeEffectivenessScore pulls low-usage waves toward prior', () => {
    insertTestWave(db, 'new-wave');
    recordWaveExecution(db, 'new-wave', true);

    const score = computeEffectivenessScore(db, 'new-wave');
    expect(score).not.toBeNull();
    // (1 + 3*0.7) / (1 + 3) = 3.1/4 = 0.775
    expect(score!).toBeCloseTo(3.1 / 4, 2);
  });

  it('getTopWavesByUsage returns waves ordered by usage count', () => {
    insertTestWave(db, 'wave-a');
    insertTestWave(db, 'wave-b');
    insertTestWave(db, 'wave-c');

    for (let idx = 0; idx < 5; idx++) recordWaveExecution(db, 'wave-a', true);
    for (let idx = 0; idx < 3; idx++) recordWaveExecution(db, 'wave-b', true);
    recordWaveExecution(db, 'wave-c', true);

    const topWaves = getTopWavesByUsage(db, 10);
    expect(topWaves).toHaveLength(3);
    expect(topWaves[0].name).toBe('wave-a');
    expect(topWaves[0].count).toBe(5);
    expect(topWaves[1].name).toBe('wave-b');
    expect(topWaves[1].count).toBe(3);
    expect(topWaves[2].name).toBe('wave-c');
    expect(topWaves[2].count).toBe(1);
  });

  it('getTopWavesByUsage excludes waves with zero usage', () => {
    insertTestWave(db, 'unused-wave');
    insertTestWave(db, 'used-wave');
    recordWaveExecution(db, 'used-wave', true);

    const topWaves = getTopWavesByUsage(db, 10);
    expect(topWaves).toHaveLength(1);
    expect(topWaves[0].name).toBe('used-wave');
  });

  it('getTopWavesByUsage respects limit', () => {
    for (let idx = 0; idx < 10; idx++) {
      insertTestWave(db, `wave-${idx}`);
      recordWaveExecution(db, `wave-${idx}`, true);
    }

    const topWaves = getTopWavesByUsage(db, 3);
    expect(topWaves).toHaveLength(3);
  });
});
