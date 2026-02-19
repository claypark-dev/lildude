import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import {
  createCronJob,
  getCronJob,
  getEnabledCronJobs,
} from '../../../src/persistence/cron-jobs.js';
import {
  startCronRunner,
  stopCronRunner,
  isCronRunnerActive,
  tickCronRunner,
  computeNextRun,
  parseCronField,
  isOneTimeSchedule,
} from '../../../src/orchestrator/cron-runner.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type { CronJobRow } from '../../../src/persistence/cron-jobs.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('cron-runner', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
  });

  afterEach(() => {
    stopCronRunner();
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  // ─── parseCronField tests ──────────────────────────────────────────────────

  describe('parseCronField', () => {
    it('parses wildcard to full range', () => {
      const result = parseCronField('*', 0, 59);
      expect(result.values).toHaveLength(60);
      expect(result.values[0]).toBe(0);
      expect(result.values[59]).toBe(59);
    });

    it('parses a single value', () => {
      const result = parseCronField('9', 0, 23);
      expect(result.values).toEqual([9]);
    });

    it('parses a range', () => {
      const result = parseCronField('1-5', 0, 6);
      expect(result.values).toEqual([1, 2, 3, 4, 5]);
    });

    it('parses step values with wildcard', () => {
      const result = parseCronField('*/5', 0, 59);
      expect(result.values).toContain(0);
      expect(result.values).toContain(5);
      expect(result.values).toContain(10);
      expect(result.values).toContain(55);
      expect(result.values).toHaveLength(12);
    });

    it('parses step values with range', () => {
      const result = parseCronField('1-10/3', 0, 59);
      expect(result.values).toEqual([1, 4, 7, 10]);
    });

    it('parses comma-separated list', () => {
      const result = parseCronField('1,3,5', 0, 6);
      expect(result.values).toEqual([1, 3, 5]);
    });

    it('parses complex list with ranges', () => {
      const result = parseCronField('1-3,5', 0, 6);
      expect(result.values).toEqual([1, 2, 3, 5]);
    });

    it('clamps values to valid range', () => {
      const result = parseCronField('100', 0, 59);
      expect(result.values).toEqual([]);
    });
  });

  // ─── isOneTimeSchedule tests ───────────────────────────────────────────────

  describe('isOneTimeSchedule', () => {
    it('returns true for specific day and month', () => {
      expect(isOneTimeSchedule('0 9 20 2 *')).toBe(true);
    });

    it('returns false for wildcard day', () => {
      expect(isOneTimeSchedule('0 9 * * *')).toBe(false);
    });

    it('returns false for wildcard month', () => {
      expect(isOneTimeSchedule('0 9 1 * *')).toBe(false);
    });

    it('returns false for step in day', () => {
      expect(isOneTimeSchedule('0 9 */2 1 *')).toBe(false);
    });

    it('returns true for comma-separated days in specific month', () => {
      // Multiple days in a specific month is still "non-recurring"
      expect(isOneTimeSchedule('0 9 1,15 3 *')).toBe(true);
    });
  });

  // ─── computeNextRun tests ─────────────────────────────────────────────────

  describe('computeNextRun', () => {
    it('computes next run for "0 * * * *" (every hour at :00)', () => {
      const after = new Date('2026-02-19T10:30:00Z');
      const next = computeNextRun('0 * * * *', after);
      expect(next.getUTCHours()).toBe(11);
      expect(next.getUTCMinutes()).toBe(0);
    });

    it('computes next run for "*/5 * * * *" (every 5 minutes)', () => {
      const after = new Date('2026-02-19T10:07:00Z');
      const next = computeNextRun('*/5 * * * *', after);
      expect(next.getUTCMinutes()).toBe(10);
    });

    it('computes next run for "0 9 * * *" (daily at 9am UTC)', () => {
      const after = new Date('2026-02-19T10:00:00Z');
      const next = computeNextRun('0 9 * * *', after);
      // Should be next day at 9am UTC
      expect(next.getUTCDate()).toBe(20);
      expect(next.getUTCHours()).toBe(9);
      expect(next.getUTCMinutes()).toBe(0);
    });

    it('computes next run for "0 9 * * 1" (every monday at 9am UTC)', () => {
      // Feb 19, 2026 is a Thursday
      const after = new Date('2026-02-19T10:00:00Z');
      const next = computeNextRun('0 9 * * 1', after);
      // Next Monday is Feb 23
      expect(next.getUTCDay()).toBe(1); // Monday
      expect(next.getUTCHours()).toBe(9);
    });

    it('computes next run for "0 9 1 * *" (first of every month)', () => {
      const after = new Date('2026-02-19T10:00:00Z');
      const next = computeNextRun('0 9 1 * *', after);
      expect(next.getUTCMonth()).toBe(2); // March (0-indexed)
      expect(next.getUTCDate()).toBe(1);
      expect(next.getUTCHours()).toBe(9);
    });

    it('throws for invalid cron expression', () => {
      expect(() => computeNextRun('bad', new Date())).toThrow('Invalid cron expression');
    });

    it('handles range in weekday field "0 9 * * 1-5"', () => {
      // Feb 21, 2026 is Saturday
      const after = new Date('2026-02-21T10:00:00Z');
      const next = computeNextRun('0 9 * * 1-5', after);
      // Next weekday is Monday Feb 23
      expect(next.getUTCDay()).toBeGreaterThanOrEqual(1);
      expect(next.getUTCDay()).toBeLessThanOrEqual(5);
      expect(next.getUTCHours()).toBe(9);
    });
  });

  // ─── tickCronRunner tests ─────────────────────────────────────────────────

  describe('tickCronRunner', () => {
    it('fires handler for due jobs', async () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');
      createCronJob(db, {
        schedule: '0 * * * *',
        taskDescription: 'Drink water',
        skillId: 'reminders',
        nextRunAt: pastDate,
      });

      const firedJobs: CronJobRow[] = [];
      const handler = async (job: CronJobRow): Promise<void> => {
        firedJobs.push(job);
      };

      await tickCronRunner(db, handler);

      expect(firedJobs).toHaveLength(1);
      expect(firedJobs[0].taskDescription).toBe('Drink water');
    });

    it('does not fire handler when no jobs are due', async () => {
      const futureDate = new Date('2099-01-01T00:00:00Z');
      createCronJob(db, {
        schedule: '0 * * * *',
        taskDescription: 'Future job',
        nextRunAt: futureDate,
      });

      const firedJobs: CronJobRow[] = [];
      const handler = async (job: CronJobRow): Promise<void> => {
        firedJobs.push(job);
      };

      await tickCronRunner(db, handler);

      expect(firedJobs).toHaveLength(0);
    });

    it('deletes one-time reminders after firing', async () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');
      const job = createCronJob(db, {
        schedule: '0 9 20 2 *', // specific day+month = one-time
        taskDescription: 'Call mom',
        skillId: 'reminders',
        nextRunAt: pastDate,
      });

      const handler = async (): Promise<void> => {
        // no-op handler
      };

      await tickCronRunner(db, handler);

      const retrieved = getCronJob(db, job.id);
      expect(retrieved).toBeUndefined();
    });

    it('updates next_run_at for recurring jobs after firing', async () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');
      const job = createCronJob(db, {
        schedule: '0 * * * *', // every hour = recurring
        taskDescription: 'Drink water',
        skillId: 'reminders',
        nextRunAt: pastDate,
      });

      const handler = async (): Promise<void> => {
        // no-op handler
      };

      await tickCronRunner(db, handler);

      const updated = getCronJob(db, job.id);
      expect(updated).toBeDefined();
      expect(updated!.lastRunStatus).toBe('success');
      expect(updated!.nextRunAt).toBeInstanceOf(Date);
      // Next run should be in the future
      expect(updated!.nextRunAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('marks job as failed when handler throws', async () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');
      const job = createCronJob(db, {
        schedule: '0 * * * *',
        taskDescription: 'Failing job',
        nextRunAt: pastDate,
      });

      const handler = async (): Promise<void> => {
        throw new Error('Handler exploded');
      };

      await tickCronRunner(db, handler);

      const updated = getCronJob(db, job.id);
      expect(updated).toBeDefined();
      expect(updated!.lastRunStatus).toBe('failed');
    });

    it('processes multiple due jobs', async () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');
      createCronJob(db, {
        schedule: '0 * * * *',
        taskDescription: 'Job A',
        nextRunAt: pastDate,
      });
      createCronJob(db, {
        schedule: '0 * * * *',
        taskDescription: 'Job B',
        nextRunAt: pastDate,
      });

      const firedDescriptions: string[] = [];
      const handler = async (job: CronJobRow): Promise<void> => {
        firedDescriptions.push(job.taskDescription);
      };

      await tickCronRunner(db, handler);

      expect(firedDescriptions).toHaveLength(2);
      expect(firedDescriptions).toContain('Job A');
      expect(firedDescriptions).toContain('Job B');
    });
  });

  // ─── startCronRunner / stopCronRunner tests ───────────────────────────────

  describe('startCronRunner / stopCronRunner', () => {
    it('starts and becomes active', () => {
      const handler = async (): Promise<void> => {};
      startCronRunner(db, handler, 100_000); // large interval to avoid ticks during test
      expect(isCronRunnerActive()).toBe(true);
    });

    it('stops and becomes inactive', () => {
      const handler = async (): Promise<void> => {};
      startCronRunner(db, handler, 100_000);
      expect(isCronRunnerActive()).toBe(true);

      stopCronRunner();
      expect(isCronRunnerActive()).toBe(false);
    });

    it('fires handler on interval', async () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');
      createCronJob(db, {
        schedule: '0 * * * *',
        taskDescription: 'Interval test',
        nextRunAt: pastDate,
      });

      let handlerCalled = false;
      const handler = async (): Promise<void> => {
        handlerCalled = true;
      };

      // Use a very small interval for testing but the initial tick runs immediately
      startCronRunner(db, handler, 100_000);

      // Wait a small amount for the initial async tick to fire
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handlerCalled).toBe(true);
    });

    it('calling start twice stops first runner', () => {
      const handler = async (): Promise<void> => {};
      startCronRunner(db, handler, 100_000);
      expect(isCronRunnerActive()).toBe(true);

      // Start again should not crash
      startCronRunner(db, handler, 100_000);
      expect(isCronRunnerActive()).toBe(true);

      stopCronRunner();
      expect(isCronRunnerActive()).toBe(false);
    });

    it('stopCronRunner is safe to call when not running', () => {
      expect(isCronRunnerActive()).toBe(false);
      stopCronRunner(); // should not throw
      expect(isCronRunnerActive()).toBe(false);
    });
  });
});
