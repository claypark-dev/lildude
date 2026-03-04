/**
 * Tests for wave-executions DAL.
 * Verifies comprehensive execution tracking for all wave sources.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import {
  recordExecution,
  getExecutionStats,
  getTopExecutedWaves,
  getRecentExecutions,
  getExecutionCountsBySource,
  getWaveSource,
} from '../../../src/persistence/wave-executions.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

/** Insert a wave registry entry for source lookup testing. */
function insertRegistryEntry(
  db: BetterSqlite3.Database,
  name: string,
  source: string,
): void {
  db.prepare(`
    INSERT OR IGNORE INTO waves_registry (id, name, version, source, manifest, is_deterministic, enabled)
    VALUES (?, ?, '1.0.0', ?, '{}', 1, 1)
  `).run(name, name, source);
}

describe('wave-executions DAL', () => {
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

  describe('recordExecution', () => {
    it('inserts a successful execution record', () => {
      const id = recordExecution(db, {
        waveName: 'email-reader',
        waveSource: 'bundled',
        waveCategory: 'communication',
        success: true,
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('inserts a failed execution with error message', () => {
      const id = recordExecution(db, {
        waveName: 'stock-monitor',
        waveSource: 'bundled',
        waveCategory: 'finance',
        success: false,
        errorMessage: 'API rate limit exceeded',
      });

      const recent = getRecentExecutions(db, { waveName: 'stock-monitor' });
      expect(recent).toHaveLength(1);
      expect(recent[0].success).toBe(false);
      expect(recent[0].errorMessage).toBe('API rate limit exceeded');
      expect(recent[0].id).toBe(id);
    });

    it('records execution time in milliseconds', () => {
      recordExecution(db, {
        waveName: 'web-search',
        waveSource: 'bundled',
        success: true,
        executionTimeMs: 1234,
      });

      const stats = getExecutionStats(db, 'web-search');
      expect(stats).not.toBeNull();
      expect(stats!.avgExecutionTimeMs).toBe(1234);
    });

    it('records contact ID for external executions', () => {
      recordExecution(db, {
        waveName: 'auto-responder',
        waveSource: 'bundled',
        waveCategory: 'party',
        contactId: 'contact-123',
        success: true,
      });

      const recent = getRecentExecutions(db, { waveName: 'auto-responder' });
      expect(recent[0].contactId).toBe('contact-123');
    });

    it('handles missing optional fields gracefully', () => {
      const id = recordExecution(db, {
        waveName: 'minimal-wave',
        waveSource: 'installed',
        success: true,
      });

      const recent = getRecentExecutions(db, { waveName: 'minimal-wave' });
      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe(id);
      expect(recent[0].waveCategory).toBeNull();
      expect(recent[0].contactId).toBeNull();
      expect(recent[0].executionTimeMs).toBeNull();
      expect(recent[0].errorMessage).toBeNull();
    });
  });

  describe('getExecutionStats', () => {
    it('returns null for a wave with no executions', () => {
      const stats = getExecutionStats(db, 'nonexistent-wave');
      expect(stats).toBeNull();
    });

    it('computes correct aggregate stats', () => {
      recordExecution(db, { waveName: 'email-reader', waveSource: 'bundled', success: true, executionTimeMs: 100 });
      recordExecution(db, { waveName: 'email-reader', waveSource: 'bundled', success: true, executionTimeMs: 200 });
      recordExecution(db, { waveName: 'email-reader', waveSource: 'bundled', success: false, executionTimeMs: 50 });

      const stats = getExecutionStats(db, 'email-reader');
      expect(stats).not.toBeNull();
      expect(stats!.totalExecutions).toBe(3);
      expect(stats!.successCount).toBe(2);
      expect(stats!.failureCount).toBe(1);
      expect(stats!.successRate).toBeCloseTo(2 / 3, 6);
      expect(stats!.avgExecutionTimeMs).toBe(117); // Math.round((100+200+50)/3)
      expect(stats!.lastExecutedAt).toBeDefined();
    });

    it('returns correct stats for 100% success rate', () => {
      recordExecution(db, { waveName: 'perfect-wave', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'perfect-wave', waveSource: 'bundled', success: true });

      const stats = getExecutionStats(db, 'perfect-wave');
      expect(stats!.successRate).toBe(1);
      expect(stats!.failureCount).toBe(0);
    });

    it('returns correct stats for 0% success rate', () => {
      recordExecution(db, { waveName: 'bad-wave', waveSource: 'installed', success: false });

      const stats = getExecutionStats(db, 'bad-wave');
      expect(stats!.successRate).toBe(0);
      expect(stats!.successCount).toBe(0);
    });
  });

  describe('getTopExecutedWaves', () => {
    it('returns empty array when no executions exist', () => {
      const top = getTopExecutedWaves(db);
      expect(top).toEqual([]);
    });

    it('returns waves ordered by execution count', () => {
      // 3 executions
      recordExecution(db, { waveName: 'popular-wave', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'popular-wave', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'popular-wave', waveSource: 'bundled', success: true });
      // 1 execution
      recordExecution(db, { waveName: 'rare-wave', waveSource: 'installed', success: true });

      const top = getTopExecutedWaves(db, 5);
      expect(top).toHaveLength(2);
      expect(top[0].waveName).toBe('popular-wave');
      expect(top[0].executionCount).toBe(3);
      expect(top[1].waveName).toBe('rare-wave');
      expect(top[1].executionCount).toBe(1);
    });

    it('respects the limit parameter', () => {
      recordExecution(db, { waveName: 'w1', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'w2', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'w3', waveSource: 'bundled', success: true });

      const top = getTopExecutedWaves(db, 2);
      expect(top).toHaveLength(2);
    });

    it('includes success rate in results', () => {
      recordExecution(db, { waveName: 'mixed', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'mixed', waveSource: 'bundled', success: false });

      const top = getTopExecutedWaves(db, 5);
      expect(top[0].successRate).toBeCloseTo(0.5, 6);
    });
  });

  describe('getRecentExecutions', () => {
    it('returns empty array when no executions exist', () => {
      const recent = getRecentExecutions(db);
      expect(recent).toEqual([]);
    });

    it('returns executions in reverse chronological order', () => {
      recordExecution(db, { waveName: 'first', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'second', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'third', waveSource: 'bundled', success: true });

      const recent = getRecentExecutions(db);
      expect(recent).toHaveLength(3);
      expect(recent[0].waveName).toBe('third');
      expect(recent[2].waveName).toBe('first');
    });

    it('filters by waveName', () => {
      recordExecution(db, { waveName: 'target', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'other', waveSource: 'bundled', success: true });

      const recent = getRecentExecutions(db, { waveName: 'target' });
      expect(recent).toHaveLength(1);
      expect(recent[0].waveName).toBe('target');
    });

    it('filters by waveSource', () => {
      recordExecution(db, { waveName: 'b1', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'i1', waveSource: 'installed', success: true });

      const recent = getRecentExecutions(db, { waveSource: 'bundled' });
      expect(recent).toHaveLength(1);
      expect(recent[0].waveName).toBe('b1');
    });

    it('filters by success only', () => {
      recordExecution(db, { waveName: 'ok', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'bad', waveSource: 'bundled', success: false });

      const recent = getRecentExecutions(db, { successOnly: true });
      expect(recent).toHaveLength(1);
      expect(recent[0].waveName).toBe('ok');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        recordExecution(db, { waveName: `w${i}`, waveSource: 'bundled', success: true });
      }

      const recent = getRecentExecutions(db, { limit: 3 });
      expect(recent).toHaveLength(3);
    });

    it('combines multiple filters', () => {
      recordExecution(db, { waveName: 'target', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'target', waveSource: 'bundled', success: false });
      recordExecution(db, { waveName: 'other', waveSource: 'bundled', success: true });

      const recent = getRecentExecutions(db, { waveName: 'target', successOnly: true });
      expect(recent).toHaveLength(1);
      expect(recent[0].success).toBe(true);
    });
  });

  describe('getExecutionCountsBySource', () => {
    it('returns zero counts when no executions exist', () => {
      const counts = getExecutionCountsBySource(db);
      expect(counts).toEqual({ bundled: 0, installed: 0, generated: 0 });
    });

    it('counts executions per source type', () => {
      recordExecution(db, { waveName: 'b1', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'b2', waveSource: 'bundled', success: true });
      recordExecution(db, { waveName: 'i1', waveSource: 'installed', success: true });
      recordExecution(db, { waveName: 'g1', waveSource: 'generated', success: true });
      recordExecution(db, { waveName: 'g2', waveSource: 'generated', success: false });
      recordExecution(db, { waveName: 'g3', waveSource: 'generated', success: true });

      const counts = getExecutionCountsBySource(db);
      expect(counts.bundled).toBe(2);
      expect(counts.installed).toBe(1);
      expect(counts.generated).toBe(3);
    });
  });

  describe('getWaveSource', () => {
    it('returns "bundled" for a bundled wave in registry', () => {
      insertRegistryEntry(db, 'email-reader', 'bundled');
      expect(getWaveSource(db, 'email-reader')).toBe('bundled');
    });

    it('returns "installed" for an installed wave in registry', () => {
      insertRegistryEntry(db, 'custom-wave', 'installed');
      expect(getWaveSource(db, 'custom-wave')).toBe('installed');
    });

    it('returns "generated" for a generated wave in registry', () => {
      insertRegistryEntry(db, 'gen-wave', 'generated');
      expect(getWaveSource(db, 'gen-wave')).toBe('generated');
    });

    it('returns "bundled" as default for unknown wave', () => {
      expect(getWaveSource(db, 'nonexistent')).toBe('bundled');
    });

    it('returns "bundled" for invalid source values', () => {
      insertRegistryEntry(db, 'weird-wave', 'unknown-source');
      expect(getWaveSource(db, 'weird-wave')).toBe('bundled');
    });
  });
});
