import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import {
  createCronJob,
  getCronJob,
  getEnabledCronJobs,
  updateCronJobLastRun,
  toggleCronJob,
  deleteCronJob,
  getMissedJobs,
} from '../../../src/persistence/cron-jobs.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('cron-jobs DAL', () => {
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

  it('createCronJob creates a job with id', () => {
    const job = createCronJob(db, {
      schedule: '0 9 * * *',
      taskDescription: 'Daily report',
    });

    expect(job.id).toBeDefined();
    expect(typeof job.id).toBe('string');
    expect(job.schedule).toBe('0 9 * * *');
    expect(job.taskDescription).toBe('Daily report');
    expect(job.skillId).toBeNull();
    expect(job.usesAi).toBe(false);
    expect(job.estimatedCostPerRun).toBe(0);
    expect(job.lastRunAt).toBeNull();
    expect(job.lastRunStatus).toBeNull();
    expect(job.nextRunAt).toBeNull();
    expect(job.enabled).toBe(true);
    expect(job.createdAt).toBeInstanceOf(Date);
  });

  it('createCronJob stores optional fields', () => {
    const nextRun = new Date('2026-03-01T09:00:00Z');
    const job = createCronJob(db, {
      schedule: '0 */6 * * *',
      taskDescription: 'Check emails',
      skillId: 'email-checker',
      usesAi: true,
      estimatedCostPerRun: 0.05,
      nextRunAt: nextRun,
    });

    expect(job.skillId).toBe('email-checker');
    expect(job.usesAi).toBe(true);
    expect(job.estimatedCostPerRun).toBe(0.05);
    expect(job.nextRunAt).toBeInstanceOf(Date);
  });

  it('getCronJob returns the job', () => {
    const created = createCronJob(db, {
      schedule: '0 9 * * *',
      taskDescription: 'Daily report',
    });

    const retrieved = getCronJob(db, created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.schedule).toBe('0 9 * * *');
    expect(retrieved!.taskDescription).toBe('Daily report');
  });

  it('getCronJob returns undefined for missing id', () => {
    const result = getCronJob(db, 'nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('getEnabledCronJobs returns only enabled jobs', () => {
    const enabledJob = createCronJob(db, {
      schedule: '0 9 * * *',
      taskDescription: 'Enabled job',
    });
    const disabledJob = createCronJob(db, {
      schedule: '0 12 * * *',
      taskDescription: 'To be disabled',
    });

    toggleCronJob(db, disabledJob.id, false);

    const enabledJobs = getEnabledCronJobs(db);
    expect(enabledJobs).toHaveLength(1);
    expect(enabledJobs[0].id).toBe(enabledJob.id);
  });

  it('updateCronJobLastRun updates status and next_run_at', () => {
    const job = createCronJob(db, {
      schedule: '0 9 * * *',
      taskDescription: 'Daily report',
    });

    const nextRun = new Date('2026-03-02T09:00:00Z');
    updateCronJobLastRun(db, job.id, 'success', nextRun);

    const updated = getCronJob(db, job.id);
    expect(updated).toBeDefined();
    expect(updated!.lastRunStatus).toBe('success');
    expect(updated!.lastRunAt).toBeInstanceOf(Date);
    expect(updated!.nextRunAt).toBeInstanceOf(Date);
  });

  it('toggleCronJob enables and disables', () => {
    const job = createCronJob(db, {
      schedule: '0 9 * * *',
      taskDescription: 'Toggle test',
    });

    expect(getCronJob(db, job.id)!.enabled).toBe(true);

    toggleCronJob(db, job.id, false);
    expect(getCronJob(db, job.id)!.enabled).toBe(false);

    toggleCronJob(db, job.id, true);
    expect(getCronJob(db, job.id)!.enabled).toBe(true);
  });

  it('deleteCronJob removes the job', () => {
    const job = createCronJob(db, {
      schedule: '0 9 * * *',
      taskDescription: 'To be deleted',
    });

    const deleted = deleteCronJob(db, job.id);
    expect(deleted).toBe(true);
    expect(getCronJob(db, job.id)).toBeUndefined();
  });

  it('deleteCronJob returns false for nonexistent job', () => {
    const deleted = deleteCronJob(db, 'nonexistent-id');
    expect(deleted).toBe(false);
  });

  it('getMissedJobs returns jobs where next_run_at < NOW', () => {
    const pastDate = new Date('2020-01-01T00:00:00Z');
    const futureDate = new Date('2099-01-01T00:00:00Z');

    const missedJob = createCronJob(db, {
      schedule: '0 9 * * *',
      taskDescription: 'Missed job',
      nextRunAt: pastDate,
    });

    createCronJob(db, {
      schedule: '0 12 * * *',
      taskDescription: 'Future job',
      nextRunAt: futureDate,
    });

    // Job with no next_run_at should not appear
    createCronJob(db, {
      schedule: '0 15 * * *',
      taskDescription: 'No next run',
    });

    const missed = getMissedJobs(db);
    expect(missed).toHaveLength(1);
    expect(missed[0].id).toBe(missedJob.id);
  });

  it('getMissedJobs excludes disabled jobs', () => {
    const pastDate = new Date('2020-01-01T00:00:00Z');

    const job = createCronJob(db, {
      schedule: '0 9 * * *',
      taskDescription: 'Disabled missed job',
      nextRunAt: pastDate,
    });

    toggleCronJob(db, job.id, false);

    const missed = getMissedJobs(db);
    expect(missed).toHaveLength(0);
  });
});
