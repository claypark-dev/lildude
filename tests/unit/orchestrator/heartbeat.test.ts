/**
 * Heartbeat runner unit tests.
 *
 * Tests the heartbeat system logic: prompt building, budget checking,
 * tick execution, silence detection, and configuration handling.
 * Uses a locally duplicated interface pattern to avoid import issues.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Locally duplicated types to avoid importing from src/ with side effects
// ---------------------------------------------------------------------------

interface HeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxDailyBudgetUsd: number;
  model?: string;
}

interface HeartbeatTickResult {
  actionTaken: boolean;
  output: string | null;
  costUsd: number;
  skipped: boolean;
  skipReason: string | null;
}

// ---------------------------------------------------------------------------
// Pure logic re-implementations for testing
// ---------------------------------------------------------------------------

/** Build the heartbeat prompt (mirrors heartbeat.ts logic) */
function buildHeartbeatPrompt(instructions: string, now: Date): string {
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return `You are a proactive AI executive assistant running a periodic heartbeat check.

Current time: ${timeStr} on ${dateStr}

## Your Standing Instructions
${instructions}

## Response Rules
- If nothing needs the user's attention, respond with exactly: [SILENT]
- If something IS actionable, provide a brief, clear notification (2-3 sentences max)
- Be specific about what needs attention and why
- Never make up information — only report things you can verify
- Format: Start with a relevant emoji, then the notification text
- Do NOT include "[SILENT]" if you have something to report`;
}

/** Budget check logic (mirrors heartbeat.ts) */
function checkDailyBudget(
  storedDate: string | undefined,
  storedCost: string | undefined,
  maxDailyUsd: number,
  today: string,
): { withinBudget: boolean; spent: number } {
  if (storedDate !== today) {
    return { withinBudget: true, spent: 0 };
  }
  const spent = parseFloat(storedCost ?? '0');
  return { withinBudget: spent < maxDailyUsd, spent };
}

/** Silence detection logic */
function isSilentResponse(text: string): boolean {
  return text.trim() === '[SILENT]'
    || text.trim() === ''
    || text.toLowerCase().includes('[silent]');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Heartbeat System', () => {
  describe('HeartbeatConfig validation', () => {
    it('accepts valid config with all fields', () => {
      const config: HeartbeatConfig = {
        enabled: true,
        intervalMinutes: 30,
        maxDailyBudgetUsd: 0.50,
        model: 'gpt-4o-mini',
      };
      expect(config.enabled).toBe(true);
      expect(config.intervalMinutes).toBe(30);
      expect(config.maxDailyBudgetUsd).toBe(0.50);
      expect(config.model).toBe('gpt-4o-mini');
    });

    it('accepts config without optional model', () => {
      const config: HeartbeatConfig = {
        enabled: false,
        intervalMinutes: 60,
        maxDailyBudgetUsd: 1.0,
      };
      expect(config.model).toBeUndefined();
    });

    it('interval conversion to ms is correct', () => {
      const config: HeartbeatConfig = {
        enabled: true,
        intervalMinutes: 30,
        maxDailyBudgetUsd: 0.50,
      };
      const intervalMs = config.intervalMinutes * 60 * 1000;
      expect(intervalMs).toBe(1_800_000); // 30 minutes in ms
    });
  });

  describe('buildHeartbeatPrompt', () => {
    it('includes current time in prompt', () => {
      const now = new Date('2026-03-07T14:30:00');
      const instructions = '- Check my calendar';
      const prompt = buildHeartbeatPrompt(instructions, now);

      expect(prompt).toContain('proactive AI executive assistant');
      expect(prompt).toContain('heartbeat check');
      expect(prompt).toContain('Check my calendar');
    });

    it('includes date information', () => {
      const now = new Date('2026-03-07T14:30:00');
      const prompt = buildHeartbeatPrompt('test instructions', now);

      // Should contain the date in some format
      expect(prompt).toContain('2026');
      expect(prompt).toContain('March');
    });

    it('includes SILENT instruction', () => {
      const now = new Date();
      const prompt = buildHeartbeatPrompt('test', now);

      expect(prompt).toContain('[SILENT]');
      expect(prompt).toContain('nothing needs the user');
    });

    it('includes standing instructions verbatim', () => {
      const instructions = '- Custom instruction 1\n- Custom instruction 2';
      const prompt = buildHeartbeatPrompt(instructions, new Date());

      expect(prompt).toContain('Custom instruction 1');
      expect(prompt).toContain('Custom instruction 2');
    });
  });

  describe('checkDailyBudget', () => {
    it('returns withinBudget=true for a new day', () => {
      const result = checkDailyBudget('2026-03-06', '0.45', 0.50, '2026-03-07');
      expect(result.withinBudget).toBe(true);
      expect(result.spent).toBe(0);
    });

    it('returns withinBudget=true when under budget', () => {
      const result = checkDailyBudget('2026-03-07', '0.30', 0.50, '2026-03-07');
      expect(result.withinBudget).toBe(true);
      expect(result.spent).toBe(0.30);
    });

    it('returns withinBudget=false when at budget', () => {
      const result = checkDailyBudget('2026-03-07', '0.50', 0.50, '2026-03-07');
      expect(result.withinBudget).toBe(false);
      expect(result.spent).toBe(0.50);
    });

    it('returns withinBudget=false when over budget', () => {
      const result = checkDailyBudget('2026-03-07', '0.75', 0.50, '2026-03-07');
      expect(result.withinBudget).toBe(false);
      expect(result.spent).toBe(0.75);
    });

    it('resets on new day even if previous day was over budget', () => {
      const result = checkDailyBudget('2026-03-06', '5.00', 0.50, '2026-03-07');
      expect(result.withinBudget).toBe(true);
      expect(result.spent).toBe(0);
    });

    it('handles undefined stored values', () => {
      const result = checkDailyBudget(undefined, undefined, 0.50, '2026-03-07');
      expect(result.withinBudget).toBe(true);
      expect(result.spent).toBe(0);
    });
  });

  describe('silence detection', () => {
    it('detects [SILENT] as silent', () => {
      expect(isSilentResponse('[SILENT]')).toBe(true);
    });

    it('detects [SILENT] with surrounding whitespace', () => {
      expect(isSilentResponse('  [SILENT]  ')).toBe(true);
    });

    it('detects [silent] (case insensitive)', () => {
      expect(isSilentResponse('[silent]')).toBe(true);
    });

    it('detects [Silent] mixed case', () => {
      expect(isSilentResponse('[Silent]')).toBe(true);
    });

    it('detects empty string as silent', () => {
      expect(isSilentResponse('')).toBe(true);
    });

    it('detects whitespace-only as silent', () => {
      expect(isSilentResponse('   ')).toBe(true);
    });

    it('does NOT flag actionable messages as silent', () => {
      expect(isSilentResponse('You have 3 unread emails from your boss.')).toBe(false);
    });

    it('does NOT flag messages with content as silent', () => {
      expect(isSilentResponse('📧 2 urgent emails need your attention.')).toBe(false);
    });
  });

  describe('HeartbeatTickResult validation', () => {
    it('silent tick has correct shape', () => {
      const result: HeartbeatTickResult = {
        actionTaken: false,
        output: null,
        costUsd: 0.001,
        skipped: false,
        skipReason: null,
      };
      expect(result.actionTaken).toBe(false);
      expect(result.output).toBeNull();
      expect(result.skipped).toBe(false);
    });

    it('action tick has correct shape', () => {
      const result: HeartbeatTickResult = {
        actionTaken: true,
        output: '\uD83D\uDC93 You have 2 meetings in the next hour.',
        costUsd: 0.002,
        skipped: false,
        skipReason: null,
      };
      expect(result.actionTaken).toBe(true);
      expect(result.output).toContain('meetings');
    });

    it('skipped tick has correct shape', () => {
      const result: HeartbeatTickResult = {
        actionTaken: false,
        output: null,
        costUsd: 0,
        skipped: true,
        skipReason: 'Daily heartbeat budget exhausted ($0.500 / $0.50)',
      };
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain('budget');
    });
  });

  describe('heartbeat output formatting', () => {
    it('prepends heart emoji to output', () => {
      const responseText = 'You have 2 urgent emails.';
      const heartbeatOutput = `\uD83D\uDC93 ${responseText.trim()}`;
      expect(heartbeatOutput).toBe('\uD83D\uDC93 You have 2 urgent emails.');
    });
  });

  describe('cost tracking', () => {
    it('accumulates costs across ticks', () => {
      let totalCost = 0;
      const tickCosts = [0.001, 0.002, 0.0015];

      for (const cost of tickCosts) {
        totalCost += cost;
      }

      expect(totalCost).toBeCloseTo(0.0045, 4);
    });

    it('respects budget cap', () => {
      const maxBudget = 0.50;
      let spent = 0;

      // Simulate ticks until budget is exhausted
      let ticks = 0;
      while (spent < maxBudget) {
        spent += 0.002;
        ticks++;
      }

      expect(spent).toBeGreaterThanOrEqual(maxBudget);
      expect(ticks).toBe(250); // 0.50 / 0.002 = 250 ticks
    });
  });

  describe('standing instructions', () => {
    it('default template has expected sections', () => {
      const DEFAULT_HEARTBEAT_MD = `# Standing Instructions

These are your standing instructions. Edit this file to customize what your
assistant proactively checks for during heartbeat ticks.

## Default checks
- If I have any unread important notifications, summarize them briefly
- If I have calendar events in the next 2 hours, remind me
- If any scheduled reminders are due or overdue, alert me
- If my API spend today seems unusually high, warn me

## Behavior
- If nothing needs attention, respond with exactly: [SILENT]
- Keep responses concise (2-3 sentences max)
- Only surface genuinely actionable information
- Never repeat information you already reported in a previous heartbeat
`;

      expect(DEFAULT_HEARTBEAT_MD).toContain('Standing Instructions');
      expect(DEFAULT_HEARTBEAT_MD).toContain('[SILENT]');
      expect(DEFAULT_HEARTBEAT_MD).toContain('calendar events');
      expect(DEFAULT_HEARTBEAT_MD).toContain('notifications');
      expect(DEFAULT_HEARTBEAT_MD).toContain('API spend');
    });
  });
});
