/**
 * Tests for the daily briefing generator.
 * Validates briefing assembly from all data sources (skills, tasks, cron, costs).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { generateBriefing, type DailyBriefing } from '../../../src/orchestrator/briefing-generator.js';
import { registerSkill, clearRegistry } from '../../../src/skills/registry.js';
import type { Skill, SkillManifest, SkillPlan, ToolResult } from '../../../src/types/index.js';

/** Create an in-memory SQLite database with the required tables. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      type TEXT NOT NULL DEFAULT 'chat',
      description TEXT,
      channel_type TEXT,
      channel_id TEXT,
      user_id TEXT,
      token_budget_usd REAL,
      tokens_spent_usd REAL NOT NULL DEFAULT 0,
      model_used TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      round_trip_number INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE cron_jobs (
      id TEXT PRIMARY KEY,
      schedule TEXT NOT NULL,
      task_description TEXT NOT NULL,
      skill_id TEXT,
      uses_ai INTEGER NOT NULL DEFAULT 0,
      estimated_cost_per_run REAL NOT NULL DEFAULT 0,
      last_run_at TEXT,
      last_run_status TEXT,
      next_run_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

/** Create a minimal Skill object for testing. */
function createTestSkill(name: string, deterministic: boolean): Skill {
  const manifest: SkillManifest = {
    name,
    version: '1.0.0',
    description: `${name} skill for testing`,
    author: 'test',
    permissions: {
      domains: [],
      shell: [],
      directories: [],
      requiresBrowser: false,
      requiresOAuth: [],
    },
    triggers: [name],
    deterministic,
    tools: [],
    minTier: 'basic' as const,
    entryPoint: 'index.js',
  };

  return {
    manifest,
    plan: async (_input: string, _ctx: Record<string, unknown>): Promise<SkillPlan> => ({
      steps: [],
      estimatedCostUsd: 0,
      isDeterministic: deterministic,
    }),
    execute: async (_plan: SkillPlan): Promise<ToolResult> => ({
      success: true,
      output: 'test output',
    }),
  };
}

describe('BriefingGenerator', () => {
  let db: Database.Database;

  beforeEach(() => {
    clearRegistry();
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('generateBriefing', () => {
    it('returns a valid DailyBriefing structure', () => {
      const briefing = generateBriefing(db);

      expect(briefing).toBeDefined();
      expect(briefing.generatedAt).toBeTruthy();
      expect(briefing.greeting).toBeTruthy();
      expect(briefing.sections).toBeInstanceOf(Array);
      expect(briefing.summary).toBeDefined();
    });

    it('includes all four sections', () => {
      const briefing = generateBriefing(db);

      const sectionTitles = briefing.sections.map((s) => s.title);
      expect(sectionTitles).toContain('Active Skills');
      expect(sectionTitles).toContain('Recent Tasks');
      expect(sectionTitles).toContain('Scheduled Jobs');
      expect(sectionTitles).toContain('Cost Overview');
    });

    it('sets generatedAt to a valid ISO timestamp', () => {
      const briefing = generateBriefing(db);
      const date = new Date(briefing.generatedAt);
      expect(date.getTime()).not.toBeNaN();
    });
  });

  describe('greeting', () => {
    it('returns a morning greeting before noon', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-19T09:00:00'));

      const briefing = generateBriefing(db);
      expect(briefing.greeting).toContain('morning');

      vi.useRealTimers();
    });

    it('returns an afternoon greeting between noon and 5pm', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-19T14:00:00'));

      const briefing = generateBriefing(db);
      expect(briefing.greeting).toContain('afternoon');

      vi.useRealTimers();
    });

    it('returns an evening greeting after 5pm', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-19T20:00:00'));

      const briefing = generateBriefing(db);
      expect(briefing.greeting).toContain('evening');

      vi.useRealTimers();
    });
  });

  describe('summary', () => {
    it('reports zero active skills when none registered', () => {
      const briefing = generateBriefing(db);
      expect(briefing.summary.activeSkills).toBe(0);
    });

    it('counts registered skills', () => {
      registerSkill('reminders', createTestSkill('reminders', true));
      registerSkill('web-search', createTestSkill('web-search', false));

      const briefing = generateBriefing(db);
      expect(briefing.summary.activeSkills).toBe(2);
    });

    it('counts scheduled jobs', () => {
      db.prepare(
        `INSERT INTO cron_jobs (id, schedule, task_description, enabled) VALUES (?, ?, ?, 1)`,
      ).run('job-1', '0 9 * * *', 'Morning reminder');

      db.prepare(
        `INSERT INTO cron_jobs (id, schedule, task_description, enabled) VALUES (?, ?, ?, 1)`,
      ).run('job-2', '*/30 * * * *', 'Stock check');

      const briefing = generateBriefing(db);
      expect(briefing.summary.scheduledJobs).toBe(2);
    });

    it('counts pending tasks', () => {
      db.prepare(
        `INSERT INTO tasks (id, status, type, description) VALUES (?, 'pending', 'chat', ?)`,
      ).run('task-1', 'Waiting task');

      db.prepare(
        `INSERT INTO tasks (id, status, type, description) VALUES (?, 'completed', 'chat', ?)`,
      ).run('task-2', 'Done task');

      const briefing = generateBriefing(db);
      expect(briefing.summary.pendingTasks).toBe(1);
    });

    it('reports daily and monthly costs', () => {
      const today = new Date().toISOString().slice(0, 10);
      db.prepare(
        `INSERT INTO token_usage (task_id, provider, model, input_tokens, output_tokens, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('task-1', 'anthropic', 'claude-3-haiku', 100, 50, 0.0025, `${today}T10:00:00`);

      const briefing = generateBriefing(db);
      expect(briefing.summary.todayCostUsd).toBe(0.0025);
      expect(briefing.summary.monthlyCostUsd).toBe(0.0025);
    });
  });

  describe('skills section', () => {
    it('shows "no skills loaded" when registry is empty', () => {
      const briefing = generateBriefing(db);
      const skillsSection = briefing.sections.find((s) => s.title === 'Active Skills');

      expect(skillsSection).toBeDefined();
      expect(skillsSection!.items).toHaveLength(1);
      expect(skillsSection!.items[0].label).toBe('No skills loaded');
    });

    it('lists registered skills with descriptions', () => {
      registerSkill('reminders', createTestSkill('reminders', true));
      registerSkill('web-search', createTestSkill('web-search', false));

      const briefing = generateBriefing(db);
      const skillsSection = briefing.sections.find((s) => s.title === 'Active Skills');

      expect(skillsSection!.items).toHaveLength(2);

      const reminderItem = skillsSection!.items.find((i) => i.label === 'reminders');
      expect(reminderItem).toBeDefined();
      expect(reminderItem!.status).toBe('good'); // deterministic

      const searchItem = skillsSection!.items.find((i) => i.label === 'web-search');
      expect(searchItem).toBeDefined();
      expect(searchItem!.status).toBe('info'); // non-deterministic
    });
  });

  describe('tasks section', () => {
    it('shows "no recent tasks" when empty', () => {
      const briefing = generateBriefing(db);
      const tasksSection = briefing.sections.find((s) => s.title === 'Recent Tasks');

      expect(tasksSection).toBeDefined();
      expect(tasksSection!.items).toHaveLength(1);
      expect(tasksSection!.items[0].label).toBe('No recent tasks');
    });

    it('lists recent tasks with status and cost', () => {
      db.prepare(
        `INSERT INTO tasks (id, status, type, description, tokens_spent_usd) VALUES (?, ?, ?, ?, ?)`,
      ).run('task-1', 'completed', 'chat', 'Set a reminder', 0.0015);

      db.prepare(
        `INSERT INTO tasks (id, status, type, description, tokens_spent_usd) VALUES (?, ?, ?, ?, ?)`,
      ).run('task-2', 'failed', 'skill', 'Search the web', 0.003);

      const briefing = generateBriefing(db);
      const tasksSection = briefing.sections.find((s) => s.title === 'Recent Tasks');

      expect(tasksSection!.items).toHaveLength(2);

      const completedTask = tasksSection!.items.find((i) => i.label === 'Set a reminder');
      expect(completedTask).toBeDefined();
      expect(completedTask!.value).toContain('completed');
      expect(completedTask!.status).toBe('good');

      const failedTask = tasksSection!.items.find((i) => i.label === 'Search the web');
      expect(failedTask).toBeDefined();
      expect(failedTask!.value).toContain('failed');
      expect(failedTask!.status).toBe('warning');
    });

    it('limits to 10 recent tasks', () => {
      for (let idx = 0; idx < 15; idx++) {
        db.prepare(
          `INSERT INTO tasks (id, status, type, description, tokens_spent_usd) VALUES (?, ?, ?, ?, ?)`,
        ).run(`task-${idx}`, 'completed', 'chat', `Task ${idx}`, 0.001);
      }

      const briefing = generateBriefing(db);
      const tasksSection = briefing.sections.find((s) => s.title === 'Recent Tasks');
      expect(tasksSection!.items).toHaveLength(10);
    });
  });

  describe('schedule section', () => {
    it('shows "no scheduled jobs" when empty', () => {
      const briefing = generateBriefing(db);
      const schedSection = briefing.sections.find((s) => s.title === 'Scheduled Jobs');

      expect(schedSection).toBeDefined();
      expect(schedSection!.items).toHaveLength(1);
      expect(schedSection!.items[0].label).toBe('No scheduled jobs');
    });

    it('lists enabled cron jobs with next run and last status', () => {
      const futureTime = new Date(Date.now() + 3_600_000).toISOString(); // 1 hour from now
      db.prepare(
        `INSERT INTO cron_jobs (id, schedule, task_description, next_run_at, last_run_status, enabled)
         VALUES (?, ?, ?, ?, ?, 1)`,
      ).run('job-1', '0 9 * * *', 'Morning reminder', futureTime, 'success');

      const briefing = generateBriefing(db);
      const schedSection = briefing.sections.find((s) => s.title === 'Scheduled Jobs');

      expect(schedSection!.items).toHaveLength(1);
      expect(schedSection!.items[0].label).toBe('Morning reminder');
      expect(schedSection!.items[0].value).toContain('in');
      expect(schedSection!.items[0].status).toBe('good');
    });

    it('excludes disabled cron jobs', () => {
      db.prepare(
        `INSERT INTO cron_jobs (id, schedule, task_description, enabled) VALUES (?, ?, ?, 0)`,
      ).run('job-disabled', '0 9 * * *', 'Disabled reminder');

      const briefing = generateBriefing(db);
      const schedSection = briefing.sections.find((s) => s.title === 'Scheduled Jobs');
      expect(schedSection!.items[0].label).toBe('No scheduled jobs');
    });

    it('shows "never run" status for new jobs', () => {
      db.prepare(
        `INSERT INTO cron_jobs (id, schedule, task_description, enabled) VALUES (?, ?, ?, 1)`,
      ).run('job-new', '0 9 * * *', 'New job');

      const briefing = generateBriefing(db);
      const schedSection = briefing.sections.find((s) => s.title === 'Scheduled Jobs');

      expect(schedSection!.items[0].value).toContain('never run');
      expect(schedSection!.items[0].status).toBe('neutral');
    });
  });

  describe('cost section', () => {
    it('shows zero costs when no token usage', () => {
      const briefing = generateBriefing(db);
      const costSection = briefing.sections.find((s) => s.title === 'Cost Overview');

      expect(costSection).toBeDefined();
      expect(costSection!.items).toHaveLength(2);
      expect(costSection!.items[0].value).toBe('$0.0000');
      expect(costSection!.items[1].value).toBe('$0.0000');
    });

    it('reports daily cost with correct status', () => {
      const today = new Date().toISOString().slice(0, 10);
      db.prepare(
        `INSERT INTO token_usage (task_id, provider, model, input_tokens, output_tokens, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('task-1', 'anthropic', 'claude-3-haiku', 1000, 500, 1.5, `${today}T12:00:00`);

      const briefing = generateBriefing(db);
      const costSection = briefing.sections.find((s) => s.title === 'Cost Overview');
      const dailyItem = costSection!.items.find((i) => i.label === "Today's Spend");

      expect(dailyItem!.value).toBe('$1.5000');
      expect(dailyItem!.status).toBe('warning'); // > $1.00
    });

    it('marks low cost as good status', () => {
      const today = new Date().toISOString().slice(0, 10);
      db.prepare(
        `INSERT INTO token_usage (task_id, provider, model, input_tokens, output_tokens, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('task-1', 'anthropic', 'claude-3-haiku', 100, 50, 0.005, `${today}T12:00:00`);

      const briefing = generateBriefing(db);
      const costSection = briefing.sections.find((s) => s.title === 'Cost Overview');
      const dailyItem = costSection!.items.find((i) => i.label === "Today's Spend");

      expect(dailyItem!.status).toBe('good'); // < $1.00
    });
  });

  describe('section icons', () => {
    it('each section has an icon', () => {
      const briefing = generateBriefing(db);
      for (const section of briefing.sections) {
        expect(section.icon).toBeTruthy();
      }
    });
  });
});
