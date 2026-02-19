import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { createDatabase } from '../../../src/persistence/db.js';
import { createCronJob, getCronJob } from '../../../src/persistence/cron-jobs.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';
import type { SkillPlan, ToolResult } from '../../../src/types/index.js';

// Dynamic import for the reminders skill module (.js file)
const SKILL_MODULE_PATH = join(__dirname, '..', '..', '..', 'skills', 'bundled', 'reminders', 'index.js');

interface RemindersModule {
  plan: (userInput: string, context: Record<string, unknown>) => Promise<SkillPlan>;
  execute: (plan: SkillPlan) => Promise<ToolResult>;
  validate: (result: ToolResult) => Promise<{ valid: boolean; feedback?: string }>;
  parseTimeExpression: (input: string, now?: Date) => { schedule: string; isOneTime: boolean } | null;
  extractReminderText: (input: string) => string;
}

let skillModule: RemindersModule;

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('reminders skill', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;

  beforeEach(async () => {
    dbManager = createTestDb();
    db = dbManager.db;
    // Dynamic import of the JS module
    skillModule = await import(SKILL_MODULE_PATH) as RemindersModule;
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  // ─── parseTimeExpression tests ──────────────────────────────────────────────

  describe('parseTimeExpression', () => {
    it('parses "every hour" to "0 * * * *"', () => {
      const result = skillModule.parseTimeExpression('remind me to drink water every hour');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 * * * *');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "every day" to "0 9 * * *"', () => {
      const result = skillModule.parseTimeExpression('remind me every day to check email');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 9 * * *');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "every day at 3pm" to "0 15 * * *"', () => {
      const result = skillModule.parseTimeExpression('remind me every day at 3pm to stretch');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 15 * * *');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "every monday" to "0 9 * * 1"', () => {
      const result = skillModule.parseTimeExpression('remind me every monday to review tasks');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 9 * * 1');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "every friday at 5pm" to "0 17 * * 5"', () => {
      const result = skillModule.parseTimeExpression('remind me every friday at 5pm to wrap up');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 17 * * 5');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "daily" as recurring', () => {
      const result = skillModule.parseTimeExpression('daily reminder to exercise');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 9 * * *');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "weekly" as recurring', () => {
      const result = skillModule.parseTimeExpression('set a weekly reminder for standup');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 9 * * 1');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "monthly" as recurring', () => {
      const result = skillModule.parseTimeExpression('monthly reminder to pay bills');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 9 1 * *');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "every 5 minutes" correctly', () => {
      const result = skillModule.parseTimeExpression('remind me every 5 minutes to check');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('*/5 * * * *');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "every 30 minutes" correctly', () => {
      const result = skillModule.parseTimeExpression('alert every 30 minutes');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('*/30 * * * *');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "tomorrow at 9am" as a one-time job', () => {
      const now = new Date('2026-02-19T10:00:00Z');
      const result = skillModule.parseTimeExpression('remind me tomorrow at 9am to call mom', now);
      expect(result).not.toBeNull();
      expect(result!.isOneTime).toBe(true);
      // Tomorrow is Feb 20
      expect(result!.schedule).toBe('0 9 20 2 *');
    });

    it('parses "today at 3pm" as a one-time job', () => {
      const now = new Date('2026-02-19T10:00:00Z');
      const result = skillModule.parseTimeExpression('remind me today at 3pm to take medicine', now);
      expect(result).not.toBeNull();
      expect(result!.isOneTime).toBe(true);
      expect(result!.schedule).toBe('0 15 19 2 *');
    });

    it('parses "in 30 minutes" as a one-time job', () => {
      const now = new Date('2026-02-19T10:00:00Z');
      const result = skillModule.parseTimeExpression('remind me in 30 minutes to check oven', now);
      expect(result).not.toBeNull();
      expect(result!.isOneTime).toBe(true);
      expect(result!.schedule).toBe('30 10 19 2 *');
    });

    it('parses "in 2 hours" as a one-time job', () => {
      const now = new Date('2026-02-19T10:00:00Z');
      const result = skillModule.parseTimeExpression('remind me in 2 hours to eat lunch', now);
      expect(result).not.toBeNull();
      expect(result!.isOneTime).toBe(true);
      expect(result!.schedule).toBe('0 12 19 2 *');
    });

    it('returns null for unparseable input', () => {
      const result = skillModule.parseTimeExpression('remind me sometime soon maybe');
      expect(result).toBeNull();
    });

    it('parses "every minute" correctly', () => {
      const result = skillModule.parseTimeExpression('remind me every minute');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('* * * * *');
      expect(result!.isOneTime).toBe(false);
    });

    it('parses "every weekday" correctly', () => {
      const result = skillModule.parseTimeExpression('remind me every weekday');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 9 * * 1-5');
      expect(result!.isOneTime).toBe(false);
    });
  });

  // ─── extractReminderText tests ──────────────────────────────────────────────

  describe('extractReminderText', () => {
    it('strips "remind me to" prefix', () => {
      const text = skillModule.extractReminderText('remind me to drink water every hour');
      expect(text).toBe('drink water');
    });

    it('strips "set a reminder to" prefix', () => {
      const text = skillModule.extractReminderText('set a reminder to call mom tomorrow at 9am');
      expect(text).toBe('call mom');
    });

    it('returns "Reminder" for empty result', () => {
      const text = skillModule.extractReminderText('remind me every hour');
      expect(text).toBe('Reminder');
    });

    it('handles "remind me" without "to"', () => {
      const text = skillModule.extractReminderText('remind me drink water every hour');
      expect(text).toBe('drink water');
    });
  });

  // ─── plan() tests ──────────────────────────────────────────────────────────

  describe('plan()', () => {
    it('extracts correct params for "remind me to drink water every hour"', async () => {
      const plan = await skillModule.plan('remind me to drink water every hour', {});
      expect(plan.isDeterministic).toBe(true);
      expect(plan.estimatedCostUsd).toBe(0);
      expect(plan.extractedParams.schedule).toBe('0 * * * *');
      expect(plan.extractedParams.text).toBe('drink water');
      expect(plan.extractedParams.isOneTime).toBe(false);
      expect(plan.extractedParams.parseError).toBeNull();
    });

    it('extracts correct params for "remind me tomorrow at 9am to call mom"', async () => {
      const now = new Date('2026-02-19T10:00:00Z');
      const plan = await skillModule.plan('remind me tomorrow at 9am to call mom', {
        now: now.toISOString(),
      });
      expect(plan.extractedParams.schedule).toBe('0 9 20 2 *');
      expect(plan.extractedParams.text).toBe('call mom');
      expect(plan.extractedParams.isOneTime).toBe(true);
      expect(plan.extractedParams.parseError).toBeNull();
    });

    it('sets parseError for unparseable input', async () => {
      const plan = await skillModule.plan('remind me whenever you feel like it', {});
      expect(plan.extractedParams.parseError).toBeTruthy();
      expect(plan.extractedParams.schedule).toBeNull();
    });

    it('has exactly one step', async () => {
      const plan = await skillModule.plan('remind me every hour to drink water', {});
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe('api_call');
    });
  });

  // ─── execute() tests ───────────────────────────────────────────────────────

  describe('execute()', () => {
    it('returns success for valid plan', async () => {
      const plan = await skillModule.plan('remind me to drink water every hour', {});
      const result = await skillModule.execute(plan);
      expect(result.success).toBe(true);
      expect(result.output).toContain('drink water');
      expect(result.output).toContain('0 * * * *');
      expect(result.output).toContain('recurring');
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.schedule).toBe('0 * * * *');
      expect(result.metadata!.isOneTime).toBe(false);
    });

    it('returns failure for unparseable plan', async () => {
      const plan = await skillModule.plan('remind me sometime', {});
      const result = await skillModule.execute(plan);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('marks one-time reminders in output', async () => {
      const now = new Date('2026-02-19T10:00:00Z');
      const plan = await skillModule.plan('remind me tomorrow at 9am to call mom', {
        now: now.toISOString(),
      });
      const result = await skillModule.execute(plan);
      expect(result.success).toBe(true);
      expect(result.output).toContain('one-time');
      expect(result.metadata!.isOneTime).toBe(true);
    });
  });

  // ─── validate() tests ──────────────────────────────────────────────────────

  describe('validate()', () => {
    it('returns valid for successful result with metadata', async () => {
      const result: ToolResult = {
        success: true,
        output: 'Reminder set: "test" with schedule "0 * * * *" (recurring)',
        metadata: { text: 'test', schedule: '0 * * * *', isOneTime: false },
      };
      const validation = await skillModule.validate(result);
      expect(validation.valid).toBe(true);
    });

    it('returns invalid for failed result', async () => {
      const result: ToolResult = {
        success: false,
        output: '',
        error: 'Could not parse time',
      };
      const validation = await skillModule.validate(result);
      expect(validation.valid).toBe(false);
      expect(validation.feedback).toBeTruthy();
    });

    it('returns invalid for result missing metadata', async () => {
      const result: ToolResult = {
        success: true,
        output: 'Something',
      };
      const validation = await skillModule.validate(result);
      expect(validation.valid).toBe(false);
    });
  });

  // ─── Integration: cron job persistence ──────────────────────────────────────

  describe('end-to-end with database', () => {
    it('creates a cron job from a reminder plan', async () => {
      const plan = await skillModule.plan('remind me to drink water every hour', {});
      const result = await skillModule.execute(plan);
      expect(result.success).toBe(true);

      // Now use the metadata to create a real cron job
      const metadata = result.metadata as { text: string; schedule: string; isOneTime: boolean; skillId: string };
      const cronJob = createCronJob(db, {
        schedule: metadata.schedule,
        taskDescription: metadata.text,
        skillId: metadata.skillId,
        usesAi: false,
      });

      expect(cronJob.id).toBeDefined();
      expect(cronJob.schedule).toBe('0 * * * *');
      expect(cronJob.taskDescription).toBe('drink water');
      expect(cronJob.skillId).toBe('reminders');
      expect(cronJob.enabled).toBe(true);

      // Verify it persists
      const retrieved = getCronJob(db, cronJob.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.schedule).toBe('0 * * * *');
    });

    it('creates a one-time cron job from "tomorrow at 9am"', async () => {
      const now = new Date('2026-02-19T10:00:00Z');
      const plan = await skillModule.plan('remind me tomorrow at 9am to call mom', {
        now: now.toISOString(),
      });
      const result = await skillModule.execute(plan);
      expect(result.success).toBe(true);

      const metadata = result.metadata as { text: string; schedule: string; isOneTime: boolean; skillId: string };
      const cronJob = createCronJob(db, {
        schedule: metadata.schedule,
        taskDescription: metadata.text,
        skillId: metadata.skillId,
        nextRunAt: new Date('2026-02-20T09:00:00Z'),
      });

      expect(cronJob.schedule).toBe('0 9 20 2 *');
      expect(cronJob.taskDescription).toBe('call mom');
      expect(cronJob.nextRunAt).toBeInstanceOf(Date);

      const retrieved = getCronJob(db, cronJob.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.schedule).toBe('0 9 20 2 *');
    });

    it('handles various natural language time patterns', async () => {
      const testCases = [
        { input: 'remind me every 5 minutes to look away from screen', expectedSchedule: '*/5 * * * *' },
        { input: 'remind me every monday to review tasks', expectedSchedule: '0 9 * * 1' },
        { input: 'set a reminder every day at 8am to meditate', expectedSchedule: '0 8 * * *' },
        { input: 'monthly reminder to pay rent', expectedSchedule: '0 9 1 * *' },
      ];

      for (const testCase of testCases) {
        const plan = await skillModule.plan(testCase.input, {});
        const result = await skillModule.execute(plan);

        expect(result.success).toBe(true);
        expect(result.metadata!.schedule).toBe(testCase.expectedSchedule);

        // Persist to DB
        const metadata = result.metadata as { text: string; schedule: string; skillId: string };
        const cronJob = createCronJob(db, {
          schedule: metadata.schedule,
          taskDescription: metadata.text,
          skillId: metadata.skillId,
        });
        expect(cronJob.id).toBeDefined();
        expect(cronJob.schedule).toBe(testCase.expectedSchedule);
      }
    });
  });
});
