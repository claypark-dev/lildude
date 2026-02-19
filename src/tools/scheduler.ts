/**
 * Scheduler tool — S1.H.2
 *
 * Validates cron expressions and creates scheduled tasks via the
 * cron jobs DAL. All operations are logged to the security audit log.
 *
 * Uses a simple regex-based validator for cron expressions (5-field format)
 * to avoid adding a cron parsing library dependency.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ToolResult } from '../types/index.js';
import { createCronJob } from '../persistence/cron-jobs.js';
import { appendSecurityLog } from '../persistence/security-log.js';

/** Action type constant for security log entries. */
const ACTION_TYPE = 'schedule_task';

/** Options for the schedule task operation. */
export interface ScheduleTaskOptions {
  skillId?: string;
  usesAi?: boolean;
  estimatedCostUsd?: number;
  securityLevel?: number;
  taskId?: string;
}

/**
 * Regex patterns for validating individual cron fields.
 * Supports: numbers, ranges (1-5), steps (star/2), lists (1,3,5), and wildcards (star).
 */
const CRON_FIELD_PATTERNS: Record<string, RegExp> = {
  minute: /^(\*|(\d|[1-5]\d)([-,](\d|[1-5]\d))*)([/]\d+)?$/,
  hour: /^(\*|(\d|1\d|2[0-3])([-,](\d|1\d|2[0-3]))*)([/]\d+)?$/,
  dayOfMonth: /^(\*|([1-9]|[12]\d|3[01])([-,]([1-9]|[12]\d|3[01]))*)([/]\d+)?$/,
  month: /^(\*|([1-9]|1[0-2])([-,]([1-9]|1[0-2]))*)([/]\d+)?$/,
  dayOfWeek: /^(\*|[0-6]([-,][0-6])*)([/]\d+)?$/,
};

/** Field names in cron expression order. */
const CRON_FIELD_NAMES = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'] as const;

/**
 * Validate a 5-field cron expression using regex patterns.
 *
 * Checks that the expression has exactly 5 whitespace-separated fields
 * and that each field matches its expected pattern.
 *
 * @param expression - The cron expression to validate.
 * @returns An object with isValid flag and an optional error description.
 */
export function validateCronExpression(expression: string): { isValid: boolean; error?: string } {
  const trimmed = expression.trim();
  const fields = trimmed.split(/\s+/);

  if (fields.length !== 5) {
    return {
      isValid: false,
      error: `Cron expression must have exactly 5 fields (minute hour day month weekday), got ${fields.length}`,
    };
  }

  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
    const fieldName = CRON_FIELD_NAMES[fieldIndex];
    const fieldValue = fields[fieldIndex];
    const pattern = CRON_FIELD_PATTERNS[fieldName];

    if (!pattern.test(fieldValue)) {
      return {
        isValid: false,
        error: `Invalid ${fieldName} field: "${fieldValue}"`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Create a scheduled task with a validated cron expression.
 *
 * Flow:
 * 1. Validate the cron expression format.
 * 2. If invalid, log the rejection and return an error ToolResult.
 * 3. If valid, create the cron job via the DAL and log the action.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param schedule - The 5-field cron expression (e.g. "0 9 * * 1-5").
 * @param description - Human-readable description of the scheduled task.
 * @param opts - Optional parameters for skill ID, AI usage, cost, and task tracking.
 * @returns A ToolResult indicating success or failure (never throws).
 */
export async function scheduleTask(
  db: BetterSqlite3.Database,
  schedule: string,
  description: string,
  opts?: ScheduleTaskOptions,
): Promise<ToolResult> {
  try {
    const validation = validateCronExpression(schedule);

    if (!validation.isValid) {
      appendSecurityLog(db, {
        actionType: ACTION_TYPE,
        actionDetail: `${schedule} — ${description}`,
        allowed: false,
        securityLevel: opts?.securityLevel ?? 3,
        reason: `Invalid cron expression: ${validation.error}`,
        taskId: opts?.taskId,
      });

      return {
        success: false,
        output: '',
        error: `Invalid cron expression: ${validation.error}`,
      };
    }

    const cronJob = createCronJob(db, {
      schedule,
      taskDescription: description,
      skillId: opts?.skillId,
      usesAi: opts?.usesAi,
      estimatedCostPerRun: opts?.estimatedCostUsd,
    });

    appendSecurityLog(db, {
      actionType: ACTION_TYPE,
      actionDetail: `${schedule} — ${description}`,
      allowed: true,
      securityLevel: opts?.securityLevel ?? 3,
      reason: 'Scheduled task created successfully',
      taskId: opts?.taskId,
    });

    return {
      success: true,
      output: `Scheduled task created: "${description}" with schedule "${schedule}" (job ID: ${cronJob.id})`,
      metadata: {
        jobId: cronJob.id,
        schedule: cronJob.schedule,
        taskDescription: cronJob.taskDescription,
        enabled: cronJob.enabled,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: '',
      error: `Schedule task error: ${message}`,
    };
  }
}
