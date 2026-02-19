/**
 * Cron jobs data access layer.
 * Provides CRUD operations for the cron_jobs table.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level representation of a cron job row. */
export interface CronJobRow {
  id: string;
  schedule: string;
  taskDescription: string;
  skillId: string | null;
  usesAi: boolean;
  estimatedCostPerRun: number;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  nextRunAt: Date | null;
  enabled: boolean;
  createdAt: Date;
}

/** Input for creating a new cron job. */
export interface CreateCronJobInput {
  schedule: string;
  taskDescription: string;
  skillId?: string;
  usesAi?: boolean;
  estimatedCostPerRun?: number;
  nextRunAt?: Date;
}

/** Raw row shape from the cron_jobs table. */
interface CronJobDbRow {
  id: string;
  schedule: string;
  task_description: string;
  skill_id: string | null;
  uses_ai: number;
  estimated_cost_per_run: number;
  last_run_at: string | null;
  last_run_status: string | null;
  next_run_at: string | null;
  enabled: number;
  created_at: string;
}

/**
 * Map a raw database row to the application-level CronJobRow.
 * @param row - Raw SQLite row from the cron_jobs table.
 * @returns A typed CronJobRow object.
 */
function mapRow(row: CronJobDbRow): CronJobRow {
  return {
    id: row.id,
    schedule: row.schedule,
    taskDescription: row.task_description,
    skillId: row.skill_id,
    usesAi: row.uses_ai === 1,
    estimatedCostPerRun: row.estimated_cost_per_run,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
    lastRunStatus: row.last_run_status,
    nextRunAt: row.next_run_at ? new Date(row.next_run_at) : null,
    enabled: row.enabled === 1,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Create a new cron job.
 * @param db - The better-sqlite3 Database instance.
 * @param input - The cron job creation parameters.
 * @returns The newly created CronJobRow.
 * @throws {PersistenceError} If the insert fails.
 */
export function createCronJob(
  db: BetterSqlite3.Database,
  input: CreateCronJobInput,
): CronJobRow {
  try {
    const id = nanoid();
    db.prepare(
      `INSERT INTO cron_jobs (id, schedule, task_description, skill_id, uses_ai, estimated_cost_per_run, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.schedule,
      input.taskDescription,
      input.skillId ?? null,
      input.usesAi ? 1 : 0,
      input.estimatedCostPerRun ?? 0,
      input.nextRunAt ? input.nextRunAt.toISOString() : null,
    );

    persistenceLogger.debug({ jobId: id }, 'Cron job created');

    const row = db.prepare(
      'SELECT * FROM cron_jobs WHERE id = ?',
    ).get(id) as CronJobDbRow;

    return mapRow(row);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create cron job: ${message}`);
  }
}

/**
 * Retrieve a cron job by its ID.
 * @param db - The better-sqlite3 Database instance.
 * @param jobId - The cron job's unique identifier.
 * @returns The CronJobRow, or undefined if not found.
 * @throws {PersistenceError} If the query fails.
 */
export function getCronJob(
  db: BetterSqlite3.Database,
  jobId: string,
): CronJobRow | undefined {
  try {
    const row = db.prepare(
      'SELECT * FROM cron_jobs WHERE id = ?',
    ).get(jobId) as CronJobDbRow | undefined;

    return row ? mapRow(row) : undefined;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get cron job: ${message}`);
  }
}

/**
 * Get all enabled cron jobs.
 * @param db - The better-sqlite3 Database instance.
 * @returns An array of enabled CronJobRow objects.
 * @throws {PersistenceError} If the query fails.
 */
export function getEnabledCronJobs(
  db: BetterSqlite3.Database,
): CronJobRow[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY created_at ASC',
    ).all() as CronJobDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get enabled cron jobs: ${message}`);
  }
}

/**
 * Update the last run information and next scheduled run for a cron job.
 * @param db - The better-sqlite3 Database instance.
 * @param jobId - The cron job's unique identifier.
 * @param status - The status of the last run (e.g. 'success', 'failed').
 * @param nextRunAt - The next scheduled run time.
 * @throws {PersistenceError} If the update fails.
 */
export function updateCronJobLastRun(
  db: BetterSqlite3.Database,
  jobId: string,
  status: string,
  nextRunAt: Date,
): void {
  try {
    db.prepare(
      `UPDATE cron_jobs SET last_run_at = CURRENT_TIMESTAMP, last_run_status = ?, next_run_at = ? WHERE id = ?`,
    ).run(status, nextRunAt.toISOString(), jobId);

    persistenceLogger.debug({ jobId, status }, 'Cron job last run updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update cron job last run: ${message}`);
  }
}

/**
 * Enable or disable a cron job.
 * @param db - The better-sqlite3 Database instance.
 * @param jobId - The cron job's unique identifier.
 * @param enabled - Whether the job should be enabled.
 * @throws {PersistenceError} If the update fails.
 */
export function toggleCronJob(
  db: BetterSqlite3.Database,
  jobId: string,
  enabled: boolean,
): void {
  try {
    db.prepare(
      'UPDATE cron_jobs SET enabled = ? WHERE id = ?',
    ).run(enabled ? 1 : 0, jobId);

    persistenceLogger.debug({ jobId, enabled }, 'Cron job toggled');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to toggle cron job: ${message}`);
  }
}

/**
 * Delete a cron job by its ID.
 * @param db - The better-sqlite3 Database instance.
 * @param jobId - The cron job's unique identifier.
 * @returns True if the job was deleted, false if it did not exist.
 * @throws {PersistenceError} If the delete fails.
 */
export function deleteCronJob(
  db: BetterSqlite3.Database,
  jobId: string,
): boolean {
  try {
    const result = db.prepare(
      'DELETE FROM cron_jobs WHERE id = ?',
    ).run(jobId);

    const deleted = result.changes > 0;

    if (deleted) {
      persistenceLogger.debug({ jobId }, 'Cron job deleted');
    }

    return deleted;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete cron job: ${message}`);
  }
}

/**
 * Get all enabled jobs whose next_run_at is in the past (missed jobs).
 * @param db - The better-sqlite3 Database instance.
 * @returns An array of CronJobRow objects that were missed.
 * @throws {PersistenceError} If the query fails.
 */
export function getMissedJobs(
  db: BetterSqlite3.Database,
): CronJobRow[] {
  try {
    const rows = db.prepare(
      `SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at < datetime('now') ORDER BY next_run_at ASC`,
    ).all() as CronJobDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get missed cron jobs: ${message}`);
  }
}
