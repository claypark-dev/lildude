/**
 * Cron runner — S2.N.1
 *
 * Background scheduler that checks for due cron jobs every 60 seconds.
 * Executes due jobs, updates their run status, calculates next run times,
 * and self-deletes one-time jobs after firing.
 *
 * Uses a simple interval timer + date comparison instead of a cron library.
 * Cron expression parsing is delegated to cron-parser.ts.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { CronJobRow } from '../persistence/cron-jobs.js';
import {
  getMissedJobs,
  updateCronJobLastRun,
  deleteCronJob,
} from '../persistence/cron-jobs.js';
import { createModuleLogger } from '../utils/logger.js';
import { isOneTimeSchedule, computeNextRun } from './cron-parser.js';

// Re-export parsing functions so existing consumers don't break
export { parseCronField, isOneTimeSchedule, computeNextRun } from './cron-parser.js';

const cronLogger = createModuleLogger('cron-runner');

/** Callback invoked when a cron job fires. */
export type CronJobHandler = (job: CronJobRow) => Promise<void>;

/** Internal state for the running interval. */
let runnerInterval: ReturnType<typeof setInterval> | null = null;

/** Check interval in milliseconds (60 seconds). */
const CHECK_INTERVAL_MS = 60_000;

/**
 * Start the cron runner background loop.
 * Checks for due cron jobs every 60 seconds and invokes the handler for each.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param handler - Async callback invoked for each due cron job.
 * @param intervalMs - Override the check interval (for testing). Defaults to 60000ms.
 */
export function startCronRunner(
  db: BetterSqlite3.Database,
  handler: CronJobHandler,
  intervalMs: number = CHECK_INTERVAL_MS,
): void {
  if (runnerInterval !== null) {
    cronLogger.warn('Cron runner already started, stopping existing runner first');
    stopCronRunner();
  }

  cronLogger.info({ intervalMs }, 'Starting cron runner');

  runnerInterval = setInterval(() => {
    void tickCronRunner(db, handler);
  }, intervalMs);

  // Run an initial tick immediately
  void tickCronRunner(db, handler);
}

/**
 * Stop the cron runner background loop.
 * Clears the interval timer if running.
 */
export function stopCronRunner(): void {
  if (runnerInterval !== null) {
    clearInterval(runnerInterval);
    runnerInterval = null;
    cronLogger.info('Cron runner stopped');
  }
}

/**
 * Check if the cron runner is currently active.
 * @returns True if the runner interval is set.
 */
export function isCronRunnerActive(): boolean {
  return runnerInterval !== null;
}

/**
 * Single tick of the cron runner: find and execute all due jobs.
 * Exposed for testing purposes.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param handler - Async callback invoked for each due cron job.
 */
export async function tickCronRunner(
  db: BetterSqlite3.Database,
  handler: CronJobHandler,
): Promise<void> {
  try {
    const dueJobs = getMissedJobs(db);

    if (dueJobs.length === 0) {
      return;
    }

    cronLogger.info({ count: dueJobs.length }, 'Processing due cron jobs');

    for (const job of dueJobs) {
      await processJob(db, job, handler);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    cronLogger.error({ error: message }, 'Cron runner tick failed');
  }
}

/**
 * Process a single due cron job: execute the handler and update state.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param job - The cron job to process.
 * @param handler - The handler to invoke.
 */
async function processJob(
  db: BetterSqlite3.Database,
  job: CronJobRow,
  handler: CronJobHandler,
): Promise<void> {
  const jobId = job.id;

  try {
    cronLogger.debug({ jobId, description: job.taskDescription }, 'Executing cron job');

    await handler(job);

    const oneTime = isOneTimeSchedule(job.schedule);

    if (oneTime) {
      deleteCronJob(db, jobId);
      cronLogger.info({ jobId }, 'One-time cron job completed and deleted');
    } else {
      const nextRun = computeNextRun(job.schedule, new Date());
      updateCronJobLastRun(db, jobId, 'success', nextRun);
      cronLogger.debug({ jobId, nextRun: nextRun.toISOString() }, 'Recurring job updated');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    cronLogger.error({ jobId, error: message }, 'Cron job execution failed');

    try {
      const nextRun = computeNextRun(job.schedule, new Date());
      updateCronJobLastRun(db, jobId, 'failed', nextRun);
    } catch (updateError: unknown) {
      const updateMessage = updateError instanceof Error ? updateError.message : String(updateError);
      cronLogger.error({ jobId, error: updateMessage }, 'Failed to update job after error');
    }
  }
}
