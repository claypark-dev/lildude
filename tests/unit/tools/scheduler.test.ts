import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { scheduleTask, validateCronExpression } from '../../../src/tools/scheduler.js';
import { getRecentSecurityLogs } from '../../../src/persistence/security-log.js';
import { getCronJob } from '../../../src/persistence/cron-jobs.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('scheduler tool', () => {
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

  describe('validateCronExpression', () => {
    it('accepts valid 5-field cron expression with wildcards', () => {
      const result = validateCronExpression('* * * * *');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts specific values', () => {
      expect(validateCronExpression('0 9 * * *').isValid).toBe(true);
      expect(validateCronExpression('30 14 1 6 5').isValid).toBe(true);
    });

    it('accepts ranges', () => {
      expect(validateCronExpression('0 9 * * 1-5').isValid).toBe(true);
      expect(validateCronExpression('0-30 * * * *').isValid).toBe(true);
    });

    it('accepts step values', () => {
      expect(validateCronExpression('*/5 * * * *').isValid).toBe(true);
      expect(validateCronExpression('0 */2 * * *').isValid).toBe(true);
    });

    it('accepts comma-separated lists', () => {
      expect(validateCronExpression('0,15,30,45 * * * *').isValid).toBe(true);
      expect(validateCronExpression('0 9 * * 1,3,5').isValid).toBe(true);
    });

    it('rejects expressions with wrong number of fields', () => {
      const tooFew = validateCronExpression('* * *');
      expect(tooFew.isValid).toBe(false);
      expect(tooFew.error).toContain('5 fields');

      const tooMany = validateCronExpression('* * * * * *');
      expect(tooMany.isValid).toBe(false);
      expect(tooMany.error).toContain('5 fields');
    });

    it('rejects empty string', () => {
      const result = validateCronExpression('');
      expect(result.isValid).toBe(false);
    });

    it('rejects invalid minute values', () => {
      const result = validateCronExpression('60 * * * *');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('minute');
    });

    it('rejects invalid hour values', () => {
      const result = validateCronExpression('0 25 * * *');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('hour');
    });

    it('rejects invalid day-of-month values', () => {
      const result = validateCronExpression('0 0 32 * *');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('dayOfMonth');
    });

    it('rejects invalid month values', () => {
      const result = validateCronExpression('0 0 * 13 *');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('month');
    });

    it('rejects invalid day-of-week values', () => {
      const result = validateCronExpression('0 0 * * 7');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('dayOfWeek');
    });

    it('rejects alphabetic fields', () => {
      const result = validateCronExpression('0 0 * jan mon');
      expect(result.isValid).toBe(false);
    });
  });

  describe('scheduleTask', () => {
    it('creates a scheduled task with a valid cron expression', async () => {
      const result = await scheduleTask(db, '0 9 * * 1-5', 'Send daily standup reminder');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Scheduled task created');
      expect(result.output).toContain('Send daily standup reminder');
      expect(result.output).toContain('0 9 * * 1-5');
      expect(result.metadata?.jobId).toBeDefined();
      expect(result.metadata?.schedule).toBe('0 9 * * 1-5');
      expect(result.metadata?.enabled).toBe(true);
    });

    it('persists the cron job to the database', async () => {
      const result = await scheduleTask(db, '*/30 * * * *', 'Check for updates');
      const jobId = result.metadata?.jobId as string;

      const job = getCronJob(db, jobId);
      expect(job).toBeDefined();
      expect(job?.schedule).toBe('*/30 * * * *');
      expect(job?.taskDescription).toBe('Check for updates');
      expect(job?.enabled).toBe(true);
    });

    it('rejects an invalid cron expression', async () => {
      const result = await scheduleTask(db, 'invalid cron', 'Should fail');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cron expression');
    });

    it('rejects a cron expression with too few fields', async () => {
      const result = await scheduleTask(db, '* *', 'Not enough fields');

      expect(result.success).toBe(false);
      expect(result.error).toContain('5 fields');
    });

    it('logs successful schedule creation to security log', async () => {
      await scheduleTask(db, '0 9 * * *', 'Morning report', {
        securityLevel: 3,
        taskId: 'task-300',
      });

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].actionType).toBe('schedule_task');
      expect(logs[0].allowed).toBe(true);
      expect(logs[0].securityLevel).toBe(3);
      expect(logs[0].taskId).toBe('task-300');
    });

    it('logs invalid cron rejection to security log', async () => {
      await scheduleTask(db, 'bad cron expr', 'Should be logged', {
        securityLevel: 2,
        taskId: 'task-400',
      });

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].actionType).toBe('schedule_task');
      expect(logs[0].allowed).toBe(false);
      expect(logs[0].reason).toContain('Invalid cron expression');
    });

    it('passes optional parameters to the cron job', async () => {
      const result = await scheduleTask(db, '0 0 * * *', 'Nightly backup', {
        skillId: 'skill-backup',
        usesAi: true,
        estimatedCostUsd: 0.05,
      });

      const jobId = result.metadata?.jobId as string;
      const job = getCronJob(db, jobId);

      expect(job?.skillId).toBe('skill-backup');
      expect(job?.usesAi).toBe(true);
      expect(job?.estimatedCostPerRun).toBe(0.05);
    });
  });
});
