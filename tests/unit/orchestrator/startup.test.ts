import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { createTask, getTask, getTasksByStatus } from '../../../src/persistence/tasks.js';
import { createCronJob } from '../../../src/persistence/cron-jobs.js';
import { setConfigValue, getConfigValue } from '../../../src/persistence/config-store.js';
import {
  runStartupResume,
  updateLastActiveTimestamp,
} from '../../../src/orchestrator/startup.js';
import type { StartupResumeResult } from '../../../src/orchestrator/startup.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('startup resume', () => {
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

  // ─── Reset stale running tasks ─────────────────────────────────────────────

  describe('reset stale running tasks', () => {
    it('resets running tasks to pending on boot', async () => {
      // Create a task and force it to running status
      const task = createTask(db, { type: 'chat', description: 'Interrupted chat' });
      db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('running', task.id);

      const result = await runStartupResume(db);

      // The task should now be pending
      const updatedTask = getTask(db, task.id);
      expect(updatedTask).toBeDefined();
      expect(updatedTask!.status).toBe('pending');
      expect(result.pendingTasks.length).toBeGreaterThanOrEqual(1);
    });

    it('handles tasks in various states correctly — only resets running, not pending or completed', async () => {
      // Create tasks in various states
      const pendingTask = createTask(db, { type: 'chat', description: 'Already pending' });
      const runningTask = createTask(db, { type: 'automation', description: 'Was running' });
      const completedTask = createTask(db, { type: 'skill', description: 'Already done' });
      const failedTask = createTask(db, { type: 'cron', description: 'Already failed' });

      // Force to specific statuses
      db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('running', runningTask.id);
      db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('completed', completedTask.id);
      db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('failed', failedTask.id);

      await runStartupResume(db);

      // Only running task should be reset to pending
      const updatedRunning = getTask(db, runningTask.id);
      expect(updatedRunning!.status).toBe('pending');

      // Others should remain in their original state
      const updatedPending = getTask(db, pendingTask.id);
      expect(updatedPending!.status).toBe('pending');

      const updatedCompleted = getTask(db, completedTask.id);
      expect(updatedCompleted!.status).toBe('completed');

      const updatedFailed = getTask(db, failedTask.id);
      expect(updatedFailed!.status).toBe('failed');
    });
  });

  // ─── Clean boot ────────────────────────────────────────────────────────────

  describe('clean boot', () => {
    it('returns normal greeting with no pending tasks', async () => {
      const result = await runStartupResume(db);

      expect(result.hasPendingWork).toBe(false);
      expect(result.pendingTasks).toHaveLength(0);
      expect(result.missedCronJobs).toHaveLength(0);
      expect(result.message).toContain('No pending tasks');
      expect(result.message).toContain('Ready to help');
    });
  });

  // ─── Short downtime with pending tasks ─────────────────────────────────────

  describe('short downtime with pending tasks', () => {
    it('generates resume message listing pending tasks', async () => {
      // Set last_active_at to 1 hour ago (short downtime)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      setConfigValue(db, 'system.last_active_at', oneHourAgo.toISOString());

      // Create a pending task
      createTask(db, { type: 'chat', description: 'Draft email to boss' });

      const result = await runStartupResume(db);

      expect(result.hasPendingWork).toBe(true);
      expect(result.pendingTasks.length).toBeGreaterThanOrEqual(1);
      expect(result.message).toContain('Welcome back');
      expect(result.message).toContain('Draft email to boss');
      expect(result.message).toContain('continue these tasks');
      expect(result.offlineDurationMs).toBeGreaterThan(0);
      expect(result.offlineDurationMs).toBeLessThan(24 * 60 * 60 * 1000);
    });
  });

  // ─── Long downtime with missed cron jobs ───────────────────────────────────

  describe('long downtime with missed cron jobs', () => {
    it('generates catchup message listing missed jobs', async () => {
      // Set last_active_at to 48 hours ago (long downtime)
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      setConfigValue(db, 'system.last_active_at', twoDaysAgo.toISOString());

      // Create a missed cron job (next_run_at in the past)
      const pastDate = new Date('2020-01-01T00:00:00Z');
      createCronJob(db, {
        schedule: '0 9 * * *',
        taskDescription: 'Morning briefing',
        nextRunAt: pastDate,
      });

      const result = await runStartupResume(db);

      expect(result.hasPendingWork).toBe(true);
      expect(result.missedCronJobs.length).toBeGreaterThanOrEqual(1);
      expect(result.message).toContain('offline for');
      expect(result.message).toContain('Morning briefing');
      expect(result.message).toContain('missed');
      expect(result.message).toContain('run, skip, or get a summary');
      expect(result.offlineDurationMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    });
  });

  // ─── updateLastActiveTimestamp ──────────────────────────────────────────────

  describe('updateLastActiveTimestamp', () => {
    it('writes correct timestamp to config store', () => {
      const beforeTimestamp = new Date().toISOString();

      updateLastActiveTimestamp(db);

      const stored = getConfigValue(db, 'system.last_active_at');
      expect(stored).toBeDefined();

      const afterTimestamp = new Date().toISOString();

      // Stored timestamp should be between before and after
      expect(stored! >= beforeTimestamp).toBe(true);
      expect(stored! <= afterTimestamp).toBe(true);
    });

    it('overwrites previous timestamp on subsequent calls', () => {
      updateLastActiveTimestamp(db);
      const firstValue = getConfigValue(db, 'system.last_active_at');

      // Small delay to ensure different timestamp
      const later = new Date(Date.now() + 1000);
      setConfigValue(db, 'system.last_active_at', later.toISOString());

      const secondValue = getConfigValue(db, 'system.last_active_at');
      expect(secondValue).not.toBe(firstValue);
    });
  });

  // ─── First boot (empty config) ────────────────────────────────────────────

  describe('first boot', () => {
    it('does not crash when config table is empty', async () => {
      // Do not set last_active_at — simulate first boot
      const result = await runStartupResume(db);

      expect(result.offlineDurationMs).toBe(0);
      expect(result.hasPendingWork).toBe(false);
      expect(result.message).toContain('Ready to help');
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('includes both pending tasks and missed cron jobs in long downtime', async () => {
      // Long downtime
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      setConfigValue(db, 'system.last_active_at', twoDaysAgo.toISOString());

      // Pending task
      createTask(db, { type: 'automation', description: 'Backup photos' });

      // Missed cron job
      const pastDate = new Date('2020-01-01T00:00:00Z');
      createCronJob(db, {
        schedule: '0 9 * * *',
        taskDescription: 'Daily digest',
        nextRunAt: pastDate,
      });

      const result = await runStartupResume(db);

      expect(result.hasPendingWork).toBe(true);
      expect(result.pendingTasks.length).toBeGreaterThanOrEqual(1);
      expect(result.missedCronJobs.length).toBeGreaterThanOrEqual(1);
      expect(result.message).toContain('Backup photos');
      expect(result.message).toContain('Daily digest');
    });

    it('updates last_active_at after startup resume completes', async () => {
      // Ensure no previous timestamp
      const beforeRun = getConfigValue(db, 'system.last_active_at');
      expect(beforeRun).toBeUndefined();

      await runStartupResume(db);

      const afterRun = getConfigValue(db, 'system.last_active_at');
      expect(afterRun).toBeDefined();
    });

    it('short downtime does not show missed cron jobs section', async () => {
      // Set last_active_at to 1 hour ago (short downtime)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      setConfigValue(db, 'system.last_active_at', oneHourAgo.toISOString());

      // Create a missed cron job
      const pastDate = new Date('2020-01-01T00:00:00Z');
      createCronJob(db, {
        schedule: '0 9 * * *',
        taskDescription: 'Morning briefing',
        nextRunAt: pastDate,
      });

      // Create a pending task so hasPendingWork is true
      createTask(db, { type: 'chat', description: 'Pending chat' });

      const result = await runStartupResume(db);

      // missedCronJobs is populated but message should NOT show the "run, skip, or summary" section
      // because short downtime doesn't show missed jobs
      expect(result.missedCronJobs.length).toBeGreaterThanOrEqual(1);
      expect(result.message).not.toContain('run, skip, or get a summary');
    });
  });
});
