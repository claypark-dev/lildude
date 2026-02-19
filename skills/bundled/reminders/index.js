/**
 * Reminders skill — S2.N.1. Deterministic plan/execute for cron-based reminders.
 * Parses natural language time expressions into cron schedules.
 * @module reminders-skill
 */

/** @typedef {{ schedule: string; isOneTime: boolean }} ScheduleResult */

/** Known recurring interval phrases mapped to cron expressions. */
const RECURRING_PATTERNS = [
  { pattern: /\bevery\s+minute\b/i, schedule: '* * * * *' },
  { pattern: /\bevery\s+5\s*min(ute)?s?\b/i, schedule: '*/5 * * * *' },
  { pattern: /\bevery\s+10\s*min(ute)?s?\b/i, schedule: '*/10 * * * *' },
  { pattern: /\bevery\s+15\s*min(ute)?s?\b/i, schedule: '*/15 * * * *' },
  { pattern: /\bevery\s+30\s*min(ute)?s?\b/i, schedule: '*/30 * * * *' },
  { pattern: /\bevery\s+hour\b/i, schedule: '0 * * * *' },
  { pattern: /\bevery\s+2\s*hours?\b/i, schedule: '0 */2 * * *' },
  { pattern: /\bevery\s+3\s*hours?\b/i, schedule: '0 */3 * * *' },
  { pattern: /\bevery\s+4\s*hours?\b/i, schedule: '0 */4 * * *' },
  { pattern: /\bevery\s+6\s*hours?\b/i, schedule: '0 */6 * * *' },
  { pattern: /\bevery\s+12\s*hours?\b/i, schedule: '0 */12 * * *' },
  { pattern: /\bevery\s+day\s+at\b/i, schedule: null },
  { pattern: /\bevery\s+day\b/i, schedule: '0 9 * * *' },
  { pattern: /\bdaily\b/i, schedule: '0 9 * * *' },
  { pattern: /\bevery\s+week(day)?\b/i, schedule: '0 9 * * 1-5' },
  { pattern: /\bevery\s+monday\b/i, schedule: '0 9 * * 1' },
  { pattern: /\bevery\s+tuesday\b/i, schedule: '0 9 * * 2' },
  { pattern: /\bevery\s+wednesday\b/i, schedule: '0 9 * * 3' },
  { pattern: /\bevery\s+thursday\b/i, schedule: '0 9 * * 4' },
  { pattern: /\bevery\s+friday\b/i, schedule: '0 9 * * 5' },
  { pattern: /\bevery\s+saturday\b/i, schedule: '0 9 * * 6' },
  { pattern: /\bevery\s+sunday\b/i, schedule: '0 9 * * 0' },
  { pattern: /\bevery\s+month\b/i, schedule: '0 9 1 * *' },
  { pattern: /\bweekly\b/i, schedule: '0 9 * * 1' },
  { pattern: /\bmonthly\b/i, schedule: '0 9 1 * *' },
];

/** Parse a time string like "9am", "9:30pm", "14:00" into { hours, minutes }. */
function parseTimeString(timeStr) {
  if (!timeStr) return null;

  // 24-hour format: "14:30", "9:00"
  const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes };
    }
    return null;
  }

  // 12-hour format: "9am", "9:30pm", "9 am"
  const match12 = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = match12[2] ? parseInt(match12[2], 10) : 0;
    const meridian = match12[3].toLowerCase();

    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;

    if (meridian === 'pm' && hours !== 12) hours += 12;
    if (meridian === 'am' && hours === 12) hours = 0;

    return { hours, minutes };
  }

  return null;
}

/** Extract "at <time>" from input text. */
function extractTimeFromText(text) {
  const timeMatch = text.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (timeMatch) {
    return parseTimeString(timeMatch[1].trim());
  }
  return null;
}

/** Parse natural language time expression into { schedule, isOneTime } or null. */
export function parseTimeExpression(input, now) {
  const referenceDate = now ? new Date(now) : new Date();

  // Check "every day at <time>" specifically (need to extract time)
  const everyDayAtMatch = input.match(/\bevery\s+day\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (everyDayAtMatch) {
    const time = parseTimeString(everyDayAtMatch[1].trim());
    if (time) {
      return { schedule: `${time.minutes} ${time.hours} * * *`, isOneTime: false };
    }
  }

  // Check "every <weekday> at <time>"
  const everyWeekdayAtMatch = input.match(
    /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i
  );
  if (everyWeekdayAtMatch) {
    const dayMap = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const dayNum = dayMap[everyWeekdayAtMatch[1].toLowerCase()];
    const time = parseTimeString(everyWeekdayAtMatch[2].trim());
    if (time && dayNum !== undefined) {
      return { schedule: `${time.minutes} ${time.hours} * * ${dayNum}`, isOneTime: false };
    }
  }

  // Check known recurring patterns
  for (const rp of RECURRING_PATTERNS) {
    if (rp.pattern.test(input) && rp.schedule !== null) {
      return { schedule: rp.schedule, isOneTime: false };
    }
  }

  // One-time: "tomorrow at <time>"
  const tomorrowMatch = input.match(/\btomorrow\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (tomorrowMatch) {
    const time = parseTimeString(tomorrowMatch[1].trim());
    if (time) {
      const target = new Date(referenceDate);
      target.setUTCDate(target.getUTCDate() + 1);
      target.setUTCHours(time.hours, time.minutes, 0, 0);
      return { schedule: `${time.minutes} ${time.hours} ${target.getUTCDate()} ${target.getUTCMonth() + 1} *`, isOneTime: true };
    }
  }

  // One-time: "today at <time>"
  const todayMatch = input.match(/\btoday\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (todayMatch) {
    const time = parseTimeString(todayMatch[1].trim());
    if (time) {
      return { schedule: `${time.minutes} ${time.hours} ${referenceDate.getUTCDate()} ${referenceDate.getUTCMonth() + 1} *`, isOneTime: true };
    }
  }

  // One-time: "in X minutes"
  const inMinutesMatch = input.match(/\bin\s+(\d+)\s*min(ute)?s?\b/i);
  if (inMinutesMatch) {
    const mins = parseInt(inMinutesMatch[1], 10);
    const target = new Date(referenceDate.getTime() + mins * 60_000);
    return {
      schedule: `${target.getUTCMinutes()} ${target.getUTCHours()} ${target.getUTCDate()} ${target.getUTCMonth() + 1} *`,
      isOneTime: true,
    };
  }

  // One-time: "in X hours"
  const inHoursMatch = input.match(/\bin\s+(\d+)\s*hours?\b/i);
  if (inHoursMatch) {
    const hrs = parseInt(inHoursMatch[1], 10);
    const target = new Date(referenceDate.getTime() + hrs * 3_600_000);
    return {
      schedule: `${target.getUTCMinutes()} ${target.getUTCHours()} ${target.getUTCDate()} ${target.getUTCMonth() + 1} *`,
      isOneTime: true,
    };
  }

  // Fallback: if there's a recognizable time like "at 3pm" with no date context, assume today
  const fallbackTime = extractTimeFromText(input);
  if (fallbackTime) {
    return {
      schedule: `${fallbackTime.minutes} ${fallbackTime.hours} ${referenceDate.getUTCDate()} ${referenceDate.getUTCMonth() + 1} *`,
      isOneTime: true,
    };
  }

  return null;
}

/** Extract reminder text by stripping trigger words and scheduling phrases. */
export function extractReminderText(input) {
  let cleaned = input;

  // Remove common trigger phrases at the start
  cleaned = cleaned.replace(/^(remind\s+me\s+(to\s+)?|set\s+(a\s+)?reminder\s+(to\s+)?)/i, '');

  // Remove scheduling phrases
  cleaned = cleaned.replace(
    /\b(every\s+(minute|hour|\d+\s*(min(ute)?s?|hours?)|day(\s+at\s+\S+)?|week(day)?|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(\s+at\s+\S+)?)\b/gi,
    ''
  );
  cleaned = cleaned.replace(/\b(tomorrow|today)\s+at\s+\S+/gi, '');
  cleaned = cleaned.replace(/\bin\s+\d+\s*(min(ute)?s?|hours?)\b/gi, '');
  cleaned = cleaned.replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, '');
  cleaned = cleaned.replace(/\b(daily|weekly|monthly)\b/gi, '');

  // Clean up extra whitespace and "to" remnants
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Remove trailing/leading "to"
  cleaned = cleaned.replace(/^to\s+/i, '');
  cleaned = cleaned.replace(/\s+to$/i, '');

  return cleaned || 'Reminder';
}

/** Plan: deterministically parse user input to extract reminder text and schedule. */
export async function plan(userInput, context) {
  const now = context && context.now ? new Date(context.now) : undefined;
  const scheduleResult = parseTimeExpression(userInput, now);
  const reminderText = extractReminderText(userInput);

  /** @type {Record<string, unknown>} */
  const extractedParams = {
    text: reminderText,
    schedule: scheduleResult ? scheduleResult.schedule : null,
    isOneTime: scheduleResult ? scheduleResult.isOneTime : false,
    parseError: scheduleResult ? null : 'Could not parse a time expression from the input',
  };

  return {
    steps: [
      {
        type: 'api_call',
        description: 'Create a reminder cron job',
        params: extractedParams,
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams,
  };
}

/** Execute: return reminder metadata for the caller to create the cron job. */
export async function execute(skillPlan) {
  const params = skillPlan.extractedParams;

  if (params.parseError) {
    return {
      success: false,
      output: '',
      error: String(params.parseError),
    };
  }

  const schedule = String(params.schedule ?? '');
  const text = String(params.text ?? 'Reminder');
  const isOneTime = Boolean(params.isOneTime);

  // The cron job is created by the caller (skill executor or test harness)
  // since this module has no direct DB access. We return the data needed.
  return {
    success: true,
    output: `Reminder set: "${text}" with schedule "${schedule}"${isOneTime ? ' (one-time)' : ' (recurring)'}`,
    metadata: {
      text,
      schedule,
      isOneTime,
      skillId: 'reminders',
    },
  };
}

/** Validate: check result has success + required metadata fields. */
export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error || 'Reminder creation failed' };
  }

  const metadata = result.metadata;
  if (!metadata || !metadata.schedule || !metadata.text) {
    return { valid: false, feedback: 'Missing schedule or text in reminder result' };
  }

  return { valid: true };
}
