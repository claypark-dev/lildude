/**
 * Availability Check Wave — observe tier.
 * Returns owner's free time slots WITHOUT revealing event titles or details.
 * Privacy-first: external users only see "busy" or "free" blocks.
 * Deterministic execution.
 */

/**
 * Generate available time slots for a given date range.
 * Excludes busy blocks (returned as opaque "busy" markers).
 * @param {Array<{start: string, end: string}>} busyBlocks - Busy time blocks from calendar.
 * @param {string} startDate - Start of range (ISO date).
 * @param {string} endDate - End of range (ISO date).
 * @param {number} durationMinutes - Minimum slot duration.
 * @returns {Array<{start: string, end: string}>} Available slots.
 */
function findFreeSlots(busyBlocks, startDate, endDate, durationMinutes) {
  const workdayStart = 9; // 9 AM
  const workdayEnd = 17; // 5 PM
  const minDuration = durationMinutes || 30;

  // Parse date strings as local dates (not UTC) to avoid timezone offset issues
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const end = new Date(ey, em - 1, ed);
  const freeSlots = [];

  // Iterate through each day
  const current = new Date(start);
  while (current <= end) {
    const dayStart = new Date(current);
    dayStart.setHours(workdayStart, 0, 0, 0);

    const dayEnd = new Date(current);
    dayEnd.setHours(workdayEnd, 0, 0, 0);

    // Skip weekends
    const dayOfWeek = current.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    // Find busy blocks for this day
    const dayBusy = busyBlocks
      .map((b) => ({
        start: new Date(b.start),
        end: new Date(b.end),
      }))
      .filter((b) => b.start < dayEnd && b.end > dayStart)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    // Find gaps between busy blocks
    let slotStart = dayStart;
    for (const busy of dayBusy) {
      if (busy.start > slotStart) {
        const gapMinutes = (busy.start.getTime() - slotStart.getTime()) / 60000;
        if (gapMinutes >= minDuration) {
          freeSlots.push({
            start: slotStart.toISOString(),
            end: busy.start.toISOString(),
          });
        }
      }
      if (busy.end > slotStart) {
        slotStart = busy.end;
      }
    }

    // Check remaining time after last busy block
    if (slotStart < dayEnd) {
      const gapMinutes = (dayEnd.getTime() - slotStart.getTime()) / 60000;
      if (gapMinutes >= minDuration) {
        freeSlots.push({
          start: slotStart.toISOString(),
          end: dayEnd.toISOString(),
        });
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return freeSlots;
}

/**
 * Format free slots as human-readable text.
 */
function formatSlots(slots) {
  if (slots.length === 0) {
    return 'No available time slots found in the requested range.';
  }

  const lines = slots.map((slot) => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const day = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${day}: ${startTime} – ${endTime}`;
  });

  return `Available time slots:\n${lines.join('\n')}`;
}

export async function plan(userInput, _context) {
  // Default: check availability for the next 3 business days
  const now = new Date();
  const startDate = now.toISOString().split('T')[0];
  const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Try to extract duration from input
  const durationMatch = userInput.match(/(\d+)\s*(?:min|minute|hour|hr)/i);
  let durationMinutes = 30;
  if (durationMatch) {
    const value = parseInt(durationMatch[1], 10);
    if (userInput.match(/hour|hr/i)) {
      durationMinutes = value * 60;
    } else {
      durationMinutes = value;
    }
  }

  return {
    steps: [
      {
        type: 'api_call',
        description: 'Check calendar for busy blocks and compute free slots',
        params: { startDate, endDate, durationMinutes },
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: { startDate, endDate, durationMinutes },
  };
}

export async function execute(wavePlan) {
  const { startDate, endDate, durationMinutes } = wavePlan.extractedParams;

  try {
    // In real execution, this would call Google Calendar FreeBusy API
    // For now, return a deterministic result with mock data
    const busyBlocks = wavePlan.extractedParams._busyBlocks || [];
    const freeSlots = findFreeSlots(
      busyBlocks,
      String(startDate),
      String(endDate),
      Number(durationMinutes) || 30,
    );

    return {
      success: true,
      output: formatSlots(freeSlots),
      metadata: {
        waveId: 'availability-check',
        slotCount: freeSlots.length,
        startDate,
        endDate,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to check availability: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error || 'Availability check failed' };
  }
  return { valid: true };
}
