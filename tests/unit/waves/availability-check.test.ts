import { describe, it, expect } from 'vitest';
import { plan, execute, validate } from '../../../waves/bundled/availability-check/index.js';

/**
 * Helper: build a local-timezone date string for a given weekday.
 * Returns the next occurrence of the given weekday (0=Sun..6=Sat)
 * as a YYYY-MM-DD string using local time.
 */
function nextWeekday(dayOfWeek: number): string {
  const now = new Date();
  const current = now.getDay();
  const daysUntil = (dayOfWeek - current + 7) % 7 || 7;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntil);
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build busy blocks in local timezone hours for a given date string (YYYY-MM-DD).
 */
function localBusyBlock(dateStr: string, startHour: number, endHour: number) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, startHour, 0, 0, 0);
  const end = new Date(y, m - 1, d, endHour, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

describe('availability-check wave', () => {
  describe('plan', () => {
    it('returns deterministic plan with default parameters', async () => {
      const result = await plan('When are you free?', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.extractedParams.startDate).toBeDefined();
      expect(result.extractedParams.endDate).toBeDefined();
      expect(result.extractedParams.durationMinutes).toBe(30);
      expect(result.steps).toHaveLength(1);
    });

    it('extracts duration in minutes from input', async () => {
      const result = await plan('Do you have 45 minutes free?', {});
      expect(result.extractedParams.durationMinutes).toBe(45);
    });

    it('extracts duration in hours from input', async () => {
      const result = await plan('I need 2 hours of your time', {});
      expect(result.extractedParams.durationMinutes).toBe(120);
    });

    it('uses default 30 min when no duration specified', async () => {
      const result = await plan('Are you available this week?', {});
      expect(result.extractedParams.durationMinutes).toBe(30);
    });
  });

  describe('execute', () => {
    it('returns free slots when no busy blocks on a weekday', async () => {
      const monday = nextWeekday(1);
      const wavePlan = {
        extractedParams: {
          startDate: monday,
          endDate: monday,
          durationMinutes: 30,
          _busyBlocks: [],
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Available time slots');
      expect(result.metadata.waveId).toBe('availability-check');
      expect(result.metadata.slotCount).toBe(1); // one 9-5 block
    });

    it('excludes busy blocks from free slots', async () => {
      const monday = nextWeekday(1);
      const wavePlan = {
        extractedParams: {
          startDate: monday,
          endDate: monday,
          durationMinutes: 30,
          _busyBlocks: [
            localBusyBlock(monday, 9, 12),
            localBusyBlock(monday, 14, 15),
          ],
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      // Gaps: 12-14 (2h) and 15-17 (2h) → 2 slots
      expect(result.metadata.slotCount).toBe(2);
    });

    it('skips weekends', async () => {
      const saturday = nextWeekday(6);
      // Sunday is one day after Saturday
      const [sy, sm, sd] = saturday.split('-').map(Number);
      const sunDate = new Date(sy, sm - 1, sd + 1);
      const sunday = `${sunDate.getFullYear()}-${String(sunDate.getMonth() + 1).padStart(2, '0')}-${String(sunDate.getDate()).padStart(2, '0')}`;
      const wavePlan = {
        extractedParams: {
          startDate: saturday,
          endDate: sunday,
          durationMinutes: 30,
          _busyBlocks: [],
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.metadata.slotCount).toBe(0);
    });

    it('filters out slots shorter than requested duration', async () => {
      const monday = nextWeekday(1);
      const wavePlan = {
        extractedParams: {
          startDate: monday,
          endDate: monday,
          durationMinutes: 120,
          _busyBlocks: [
            localBusyBlock(monday, 9, 10),
            localBusyBlock(monday, 11, 17),
          ],
        },
      };

      const result = await execute(wavePlan);

      // 1-hour gap (10-11) too short for 2h → 0 slots
      expect(result.success).toBe(true);
      expect(result.metadata.slotCount).toBe(0);
    });

    it('handles empty busy blocks array', async () => {
      const monday = nextWeekday(1);
      const tuesday = nextWeekday(2);
      const wavePlan = {
        extractedParams: {
          startDate: monday,
          endDate: tuesday,
          durationMinutes: 30,
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.metadata.slotCount).toBeGreaterThan(0);
    });

    it('handles multi-day weekday range', async () => {
      // Use Mon-Fri of same week to guarantee 5 weekdays
      const monday = nextWeekday(1);
      const [my, mm, md] = monday.split('-').map(Number);
      const friDate = new Date(my, mm - 1, md + 4);
      const friday = `${friDate.getFullYear()}-${String(friDate.getMonth() + 1).padStart(2, '0')}-${String(friDate.getDate()).padStart(2, '0')}`;

      const wavePlan = {
        extractedParams: {
          startDate: monday,
          endDate: friday,
          durationMinutes: 30,
          _busyBlocks: [],
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.metadata.slotCount).toBe(5);
    });
  });

  describe('validate', () => {
    it('returns valid for successful result', async () => {
      const result = await validate({ success: true, output: 'Slots' });
      expect(result.valid).toBe(true);
    });

    it('returns invalid for failed result', async () => {
      const result = await validate({ success: false, error: 'API error' });
      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('API error');
    });
  });
});
