/**
 * Timezone Converter Wave — observe tier.
 * Converts times between timezones using Intl.DateTimeFormat.
 * Fully deterministic, no external API needed.
 */

const TZ_ALIASES = {
  'est': 'America/New_York', 'edt': 'America/New_York',
  'cst': 'America/Chicago', 'cdt': 'America/Chicago',
  'mst': 'America/Denver', 'mdt': 'America/Denver',
  'pst': 'America/Los_Angeles', 'pdt': 'America/Los_Angeles',
  'gmt': 'Etc/GMT', 'utc': 'Etc/UTC',
  'bst': 'Europe/London', 'cet': 'Europe/Paris',
  'jst': 'Asia/Tokyo', 'kst': 'Asia/Seoul',
  'ist': 'Asia/Kolkata', 'aest': 'Australia/Sydney',
  'london': 'Europe/London', 'paris': 'Europe/Paris',
  'tokyo': 'Asia/Tokyo', 'new york': 'America/New_York',
  'los angeles': 'America/Los_Angeles', 'chicago': 'America/Chicago',
  'sydney': 'Australia/Sydney', 'berlin': 'Europe/Berlin',
  'dubai': 'Asia/Dubai', 'singapore': 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong', 'mumbai': 'Asia/Kolkata',
  'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai',
};

function resolveTz(input) {
  const lower = input.toLowerCase().trim();
  return TZ_ALIASES[lower] || input;
}

function parseTimeInput(input) {
  const timeMatch = input.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  const fromMatch = input.match(/(?:from|in)\s+([a-z\s]+?)(?:\s+to\s+|\s+in\s+|$)/i);
  const toMatch = input.match(/(?:to|in)\s+([a-z\s]+?)(?:\?|$)/i);

  return {
    time: timeMatch ? timeMatch[1] : null,
    fromTz: fromMatch ? resolveTz(fromMatch[1]) : null,
    toTz: toMatch ? resolveTz(toMatch[1]) : null,
  };
}

function formatTime(date, timezone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric', minute: '2-digit',
      hour12: true, timeZoneName: 'short',
    }).format(date);
  } catch {
    return null;
  }
}

export async function plan(userInput, _context) {
  const parsed = parseTimeInput(userInput);
  return {
    steps: [{ type: 'compute', description: 'Convert timezone', params: parsed }],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: parsed,
  };
}

export async function execute(wavePlan) {
  const { toTz } = wavePlan.extractedParams;

  try {
    if (!toTz) {
      return { success: false, output: '', error: 'Please specify a timezone (e.g., "time in Tokyo").' };
    }

    const now = new Date();
    const formatted = formatTime(now, toTz);

    if (!formatted) {
      return { success: false, output: '', error: `Unknown timezone: ${toTz}` };
    }

    return {
      success: true,
      output: `Current time in ${toTz}: ${formatted}`,
      metadata: { waveId: 'timezone-converter', timezone: toTz },
    };
  } catch (error) {
    return { success: false, output: '', error: `Timezone conversion failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function validate(result) {
  return result.success ? { valid: true } : { valid: false, feedback: result.error };
}
