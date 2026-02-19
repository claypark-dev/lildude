/**
 * Startup Resume & Play Catchup — S3.P.1.
 * On boot, detects interrupted tasks and missed cron jobs,
 * then generates a structured resume message for the caller.
 *
 * - Resets stale 'running' tasks to 'pending' (they were interrupted).
 * - Reads last_active_at from config_store to calculate offline duration.
 * - Short downtime (<24h) with pending tasks: lists them for resume.
 * - Long downtime (>=24h): also lists missed cron jobs.
 * - Clean boot: returns a normal greeting.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { Task } from '../types/index.js';
import type { CronJobRow } from '../persistence/cron-jobs.js';
import { getTasksByStatus, updateTaskStatus } from '../persistence/tasks.js';
import { getMissedJobs } from '../persistence/cron-jobs.js';
import { getConfigValue, setConfigValue } from '../persistence/config-store.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('startup-resume');

/** 24 hours in milliseconds. */
const LONG_DOWNTIME_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Config key used to store the last heartbeat timestamp. */
const LAST_ACTIVE_KEY = 'system.last_active_at';

/** Result returned by the startup resume check. */
export interface StartupResumeResult {
  hasPendingWork: boolean;
  offlineDurationMs: number;
  pendingTasks: Task[];
  missedCronJobs: CronJobRow[];
  message: string;
}

/**
 * Run the startup resume check.
 *
 * 1. Resets all 'running' tasks to 'pending' (interrupted by shutdown/crash).
 * 2. Reads the last heartbeat timestamp to calculate offline duration.
 * 3. Gathers pending tasks and missed cron jobs.
 * 4. Generates a structured message based on what was found.
 *
 * @param db - The better-sqlite3 Database instance.
 * @returns A StartupResumeResult describing what needs attention.
 */
export async function runStartupResume(
  db: BetterSqlite3.Database,
): Promise<StartupResumeResult> {
  try {
    // Step 1: Reset stale running tasks to pending
    const staleTasks = resetStaleTasks(db);
    if (staleTasks > 0) {
      log.info({ count: staleTasks }, 'Reset stale running tasks to pending');
    }

    // Step 2: Calculate offline duration
    const offlineDurationMs = calculateOfflineDuration(db);

    // Step 3: Gather pending tasks and missed cron jobs
    const pendingTasks = getTasksByStatus(db, 'pending');
    const missedCronJobs = getMissedJobs(db);

    // Step 4: Update the last active timestamp immediately
    updateLastActiveTimestamp(db);

    // Step 5: Generate the appropriate message
    const message = generateMessage(
      offlineDurationMs,
      pendingTasks,
      missedCronJobs,
    );

    const hasPendingWork = pendingTasks.length > 0 || missedCronJobs.length > 0;

    log.info(
      {
        hasPendingWork,
        offlineDurationMs,
        pendingTaskCount: pendingTasks.length,
        missedCronJobCount: missedCronJobs.length,
      },
      'Startup resume check completed',
    );

    return {
      hasPendingWork,
      offlineDurationMs,
      pendingTasks,
      missedCronJobs,
      message,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error: errorMessage }, 'Startup resume check failed');

    // Return a safe default so the app still boots
    return {
      hasPendingWork: false,
      offlineDurationMs: 0,
      pendingTasks: [],
      missedCronJobs: [],
      message: 'Good morning! Ready to help.',
    };
  }
}

/**
 * Update the last active timestamp in the config store.
 * Called periodically (every 60s) and on startup to track uptime.
 *
 * @param db - The better-sqlite3 Database instance.
 */
export function updateLastActiveTimestamp(db: BetterSqlite3.Database): void {
  try {
    setConfigValue(db, LAST_ACTIVE_KEY, new Date().toISOString());
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error: errorMessage }, 'Failed to update last active timestamp');
  }
}

/**
 * Reset all tasks with status 'running' to 'pending'.
 * These tasks were interrupted by a shutdown or crash.
 *
 * @param db - The better-sqlite3 Database instance.
 * @returns The number of tasks that were reset.
 */
function resetStaleTasks(db: BetterSqlite3.Database): number {
  const runningTasks = getTasksByStatus(db, 'running');

  for (const task of runningTasks) {
    updateTaskStatus(db, task.id, 'pending', 'Reset on startup — interrupted by shutdown');
  }

  return runningTasks.length;
}

/**
 * Calculate how long the system was offline by reading the last heartbeat.
 *
 * @param db - The better-sqlite3 Database instance.
 * @returns Duration offline in milliseconds, or 0 if no previous heartbeat exists.
 */
function calculateOfflineDuration(db: BetterSqlite3.Database): number {
  const lastActiveIso = getConfigValue(db, LAST_ACTIVE_KEY);

  if (!lastActiveIso) {
    log.info('No previous last_active_at found — assuming first boot');
    return 0;
  }

  const lastActiveDate = new Date(lastActiveIso);
  const now = new Date();
  const durationMs = now.getTime() - lastActiveDate.getTime();

  return Math.max(0, durationMs);
}

/**
 * Generate a human-readable startup message based on offline duration,
 * pending tasks, and missed cron jobs.
 *
 * @param offlineDurationMs - How long the system was offline.
 * @param pendingTasks - Tasks that are pending (including reset stale ones).
 * @param missedCronJobs - Cron jobs that missed their scheduled run.
 * @returns A formatted message string.
 */
function generateMessage(
  offlineDurationMs: number,
  pendingTasks: Task[],
  missedCronJobs: CronJobRow[],
): string {
  const hasPending = pendingTasks.length > 0;
  const hasMissed = missedCronJobs.length > 0;
  const isLongDowntime = offlineDurationMs >= LONG_DOWNTIME_THRESHOLD_MS;

  // Clean boot — nothing to do
  if (!hasPending && !hasMissed) {
    return 'Good morning! No pending tasks or missed jobs. Ready to help.';
  }

  const parts: string[] = [];

  // Header based on downtime
  if (isLongDowntime) {
    const hours = Math.round(offlineDurationMs / (60 * 60 * 1000));
    parts.push(`Welcome back! You were offline for ~${hours} hours.`);
  } else if (offlineDurationMs > 0) {
    const minutes = Math.round(offlineDurationMs / (60 * 1000));
    parts.push(`Welcome back! You were offline for ~${minutes} minutes.`);
  } else {
    parts.push('Welcome back!');
  }

  // Pending tasks section
  if (hasPending) {
    parts.push('');
    parts.push(`Pending tasks (${pendingTasks.length}):`);
    for (const task of pendingTasks) {
      const description = task.description ?? `${task.type} task`;
      parts.push(`  - [${task.id}] ${description}`);
    }
    parts.push('');
    parts.push('Would you like to continue these tasks?');
  }

  // Missed cron jobs section (only shown for long downtime)
  if (hasMissed && isLongDowntime) {
    parts.push('');
    parts.push(`Missed scheduled jobs (${missedCronJobs.length}):`);
    for (const job of missedCronJobs) {
      const nextRun = job.nextRunAt
        ? ` (was due ${job.nextRunAt.toISOString()})`
        : '';
      parts.push(`  - [${job.id}] ${job.taskDescription}${nextRun}`);
    }
    parts.push('');
    parts.push('You can run, skip, or get a summary of these missed jobs.');
  }

  return parts.join('\n');
}
