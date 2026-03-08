/**
 * Convert cron expressions to human-readable descriptions.
 * Covers common patterns — falls back to the raw expression for exotic ones.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, '0');
  return `${h}:${m} ${period}`;
}

function parseDayRange(field: string): string {
  // e.g. "1-5" → "Mon–Fri", "0,6" → "Sat, Sun"
  if (field === '*') return '';
  if (field === '1-5') return 'Mon\u2013Fri';
  if (field === '0,6' || field === '6,0') return 'Sat & Sun';

  const parts = field.split(',');
  const names = parts.map((p) => {
    if (p.includes('-')) {
      const [start, end] = p.split('-').map(Number);
      return `${DAYS_SHORT[start]}\u2013${DAYS_SHORT[end]}`;
    }
    const n = Number(p);
    return Number.isNaN(n) ? p : DAYS[n] ?? p;
  });

  return names.join(', ');
}

/** Convert a 5-field cron expression to a human-readable string. */
export function cronToHuman(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes: */N * * * *
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = Number(minute.slice(2));
    if (n === 1) return 'Every minute';
    return `Every ${n} minutes`;
  }

  // Every N hours: 0 */N * * *
  if (hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = Number(hour.slice(2));
    if (n === 1) return 'Every hour';
    return `Every ${n} hours`;
  }

  // Fixed time patterns: M H * * DOW  or  M H DOM * *
  const m = Number(minute);
  const h = Number(hour);

  if (Number.isNaN(m) || Number.isNaN(h)) return expression;

  const time = formatTime(h, m);

  // Daily: M H * * *
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${time}`;
  }

  // Specific days of week: M H * * DOW
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = parseDayRange(dayOfWeek);
    return `${days} at ${time}`;
  }

  // Specific day of month: M H DOM * *
  if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    const dom = Number(dayOfMonth);
    if (!Number.isNaN(dom)) {
      const suffix = dom === 1 || dom === 21 || dom === 31 ? 'st'
        : dom === 2 || dom === 22 ? 'nd'
          : dom === 3 || dom === 23 ? 'rd' : 'th';
      return `${dom}${suffix} of each month at ${time}`;
    }
  }

  // Fallback
  return expression;
}
