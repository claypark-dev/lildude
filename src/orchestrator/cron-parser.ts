/**
 * Cron expression parser — S2.N.1
 *
 * Parses standard 5-field cron expressions (minute hour day month weekday)
 * and computes next run dates. Used by the cron runner to schedule jobs.
 *
 * Supports: wildcards (*), step values (star/5), ranges (1-5),
 * comma-separated lists (1,3,5), and combinations thereof.
 */

/** Parsed representation of a single cron field. */
export interface CronFieldValues {
  values: number[];
}

/**
 * Parse a single cron field into an array of matching values.
 *
 * Supports:
 * - Wildcards: `*`
 * - Step values: `*​/5`, `1-10/2`
 * - Ranges: `1-5`
 * - Lists: `1,3,5`
 * - Single values: `9`
 *
 * @param field - The cron field string.
 * @param min - Minimum allowed value for this field.
 * @param max - Maximum allowed value for this field.
 * @returns The set of matching integer values.
 */
export function parseCronField(field: string, min: number, max: number): CronFieldValues {
  const values: Set<number> = new Set();

  const parts = field.split(',');

  for (const part of parts) {
    // Handle step values: */5 or 1-10/2
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const stepBase = stepMatch[1];
      const stepValue = parseInt(stepMatch[2], 10);
      let rangeStart = min;
      let rangeEnd = max;

      if (stepBase !== '*') {
        const rangeMatch = stepBase.match(/^(\d+)-(\d+)$/);
        if (rangeMatch) {
          rangeStart = parseInt(rangeMatch[1], 10);
          rangeEnd = parseInt(rangeMatch[2], 10);
        } else {
          rangeStart = parseInt(stepBase, 10);
        }
      }

      for (let val = rangeStart; val <= rangeEnd; val += stepValue) {
        if (val >= min && val <= max) {
          values.add(val);
        }
      }
      continue;
    }

    // Handle wildcard
    if (part === '*') {
      for (let val = min; val <= max; val++) {
        values.add(val);
      }
      continue;
    }

    // Handle ranges: 1-5
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const rangeStart = parseInt(rangeMatch[1], 10);
      const rangeEnd = parseInt(rangeMatch[2], 10);
      for (let val = rangeStart; val <= rangeEnd; val++) {
        if (val >= min && val <= max) {
          values.add(val);
        }
      }
      continue;
    }

    // Single value
    const singleValue = parseInt(part, 10);
    if (!isNaN(singleValue) && singleValue >= min && singleValue <= max) {
      values.add(singleValue);
    }
  }

  return { values: Array.from(values).sort((a, b) => a - b) };
}

/**
 * Determine if a cron schedule represents a one-time job.
 * A schedule is one-time if both day-of-month and month fields are specific
 * values (not wildcards or step patterns).
 *
 * @param schedule - A 5-field cron expression.
 * @returns True if the schedule appears to be one-time.
 */
export function isOneTimeSchedule(schedule: string): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const dayField = fields[2];
  const monthField = fields[3];

  // If both day and month are specific (no wildcards, no steps),
  // this is likely a one-time schedule
  const isSpecific = (field: string): boolean =>
    !field.includes('*') && !field.includes('/');

  return isSpecific(dayField) && isSpecific(monthField);
}

/**
 * Compute the next run time for a 5-field cron expression after the given date.
 * Iterates minute-by-minute from the reference time forward, up to 366 days.
 * All calculations use UTC to avoid timezone ambiguity.
 *
 * @param schedule - A 5-field cron expression (minute hour day month weekday).
 * @param after - The reference date; next run will be strictly after this time.
 * @returns The next Date when the schedule matches.
 * @throws Error if no matching time is found within 366 days.
 */
export function computeNextRun(schedule: string, after: Date): Date {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${fields.length}`);
  }

  const minuteVals = parseCronField(fields[0], 0, 59);
  const hourVals = parseCronField(fields[1], 0, 23);
  const dayVals = parseCronField(fields[2], 1, 31);
  const monthVals = parseCronField(fields[3], 1, 12);
  const weekdayVals = parseCronField(fields[4], 0, 6);

  // Start from the next minute after `after` (all calculations in UTC)
  const candidate = new Date(after);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  const maxIterations = 366 * 24 * 60; // ~1 year of minutes
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const month = candidate.getUTCMonth() + 1;
    const day = candidate.getUTCDate();
    const weekday = candidate.getUTCDay();
    const hour = candidate.getUTCHours();
    const minute = candidate.getUTCMinutes();

    if (
      monthVals.values.includes(month) &&
      dayVals.values.includes(day) &&
      weekdayVals.values.includes(weekday) &&
      hourVals.values.includes(hour) &&
      minuteVals.values.includes(minute)
    ) {
      return candidate;
    }

    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  throw new Error(`No matching run time found within 366 days for schedule: ${schedule}`);
}
