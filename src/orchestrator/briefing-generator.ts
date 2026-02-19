/**
 * Daily Briefing Generator.
 * Assembles a structured briefing from all active skills, tasks, cron jobs,
 * and cost data. Purely deterministic — no LLM calls required.
 *
 * See HLD Section 6.4 for briefing architecture.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { getRecentTasks, getTasksByStatus } from '../persistence/tasks.js';
import { getDailyTotalCost, getMonthlyTotalCost } from '../persistence/token-usage.js';
import { getEnabledCronJobs } from '../persistence/cron-jobs.js';
import { getAllSkills } from '../skills/registry.js';
import { createModuleLogger } from '../utils/logger.js';

const briefingLogger = createModuleLogger('briefing');

/** A single section in the daily briefing. */
export interface BriefingSection {
  title: string;
  icon: string;
  items: BriefingItem[];
}

/** A single item within a briefing section. */
export interface BriefingItem {
  label: string;
  value: string;
  status?: 'good' | 'warning' | 'info' | 'neutral';
}

/** Complete daily briefing response shape. */
export interface DailyBriefing {
  generatedAt: string;
  greeting: string;
  sections: BriefingSection[];
  summary: BriefingSummary;
}

/** High-level summary counts for the briefing header. */
export interface BriefingSummary {
  activeSkills: number;
  scheduledJobs: number;
  pendingTasks: number;
  todayCostUsd: number;
  monthlyCostUsd: number;
}

/**
 * Generate a daily briefing by querying all available data sources.
 * This is purely deterministic — no LLM calls, no token cost.
 * @param db - The better-sqlite3 Database instance.
 * @returns A structured DailyBriefing object.
 */
export function generateBriefing(db: BetterSqlite3.Database): DailyBriefing {
  briefingLogger.info('Generating daily briefing');

  const now = new Date();
  const greeting = buildGreeting(now);
  const summary = buildSummary(db);
  const sections: BriefingSection[] = [];

  sections.push(buildSkillsSection());
  sections.push(buildTasksSection(db));
  sections.push(buildScheduleSection(db));
  sections.push(buildCostSection(db));

  briefingLogger.info(
    { sectionCount: sections.length, activeSkills: summary.activeSkills },
    'Daily briefing generated',
  );

  return {
    generatedAt: now.toISOString(),
    greeting,
    sections,
    summary,
  };
}

/** Build a time-appropriate greeting message. */
function buildGreeting(now: Date): string {
  const hour = now.getHours();

  if (hour < 12) return 'Good morning! Here is your daily briefing.';
  if (hour < 17) return 'Good afternoon! Here is your daily briefing.';
  return 'Good evening! Here is your daily briefing.';
}

/** Build the summary counts used by the briefing header. */
function buildSummary(db: BetterSqlite3.Database): BriefingSummary {
  const skills = getAllSkills();
  const cronJobs = getEnabledCronJobs(db);
  const pendingTasks = getTasksByStatus(db, 'pending');
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = new Date().toISOString().slice(0, 7);

  return {
    activeSkills: skills.size,
    scheduledJobs: cronJobs.length,
    pendingTasks: pendingTasks.length,
    todayCostUsd: getDailyTotalCost(db, today),
    monthlyCostUsd: getMonthlyTotalCost(db, currentMonth),
  };
}

/** Build the registered skills section listing all available capabilities. */
function buildSkillsSection(): BriefingSection {
  const skills = getAllSkills();
  const items: BriefingItem[] = [];

  for (const [name, skill] of skills) {
    const manifest = skill.manifest;
    items.push({
      label: name,
      value: manifest.description,
      status: manifest.deterministic ? 'good' : 'info',
    });
  }

  if (items.length === 0) {
    items.push({
      label: 'No skills loaded',
      value: 'Install skills in ~/.lil-dude/skills/installed/',
      status: 'neutral',
    });
  }

  return { title: 'Active Skills', icon: '\u26A1', items };
}

/** Build the recent tasks section showing task activity. */
function buildTasksSection(db: BetterSqlite3.Database): BriefingSection {
  const recentTasks = getRecentTasks(db, 10);
  const items: BriefingItem[] = [];

  if (recentTasks.length === 0) {
    items.push({
      label: 'No recent tasks',
      value: 'Send a message to get started',
      status: 'neutral',
    });
    return { title: 'Recent Tasks', icon: '\u2611', items };
  }

  for (const task of recentTasks) {
    const statusMap: Record<string, BriefingItem['status']> = {
      completed: 'good',
      failed: 'warning',
      running: 'info',
      pending: 'neutral',
      killed: 'warning',
      awaiting_approval: 'info',
    };

    items.push({
      label: task.description ?? `Task ${task.id.slice(0, 8)}`,
      value: `${task.status} — $${task.tokensSpentUsd.toFixed(4)}`,
      status: statusMap[task.status] ?? 'neutral',
    });
  }

  return { title: 'Recent Tasks', icon: '\u2611', items };
}

/** Build the scheduled jobs section from cron_jobs table. */
function buildScheduleSection(db: BetterSqlite3.Database): BriefingSection {
  const cronJobs = getEnabledCronJobs(db);
  const items: BriefingItem[] = [];

  if (cronJobs.length === 0) {
    items.push({
      label: 'No scheduled jobs',
      value: 'Set a reminder to create a scheduled job',
      status: 'neutral',
    });
    return { title: 'Scheduled Jobs', icon: '\u23F0', items };
  }

  for (const job of cronJobs) {
    const nextRun = job.nextRunAt
      ? formatRelativeTime(job.nextRunAt)
      : 'not scheduled';

    const lastStatus = job.lastRunStatus ?? 'never run';
    const statusValue = lastStatus === 'success' ? 'good' : lastStatus === 'never run' ? 'neutral' : 'warning';

    items.push({
      label: job.taskDescription,
      value: `Next: ${nextRun} | Last: ${lastStatus}`,
      status: statusValue,
    });
  }

  return { title: 'Scheduled Jobs', icon: '\u23F0', items };
}

/** Build the cost section showing today's and monthly spend. */
function buildCostSection(db: BetterSqlite3.Database): BriefingSection {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = new Date().toISOString().slice(0, 7);

  const dailyCost = getDailyTotalCost(db, today);
  const monthlyCost = getMonthlyTotalCost(db, currentMonth);

  const items: BriefingItem[] = [
    {
      label: "Today's Spend",
      value: `$${dailyCost.toFixed(4)}`,
      status: dailyCost > 1.0 ? 'warning' : 'good',
    },
    {
      label: 'Monthly Spend',
      value: `$${monthlyCost.toFixed(4)}`,
      status: monthlyCost > 10.0 ? 'warning' : 'good',
    },
  ];

  return { title: 'Cost Overview', icon: '\uD83D\uDCB0', items };
}

/**
 * Format a Date as a human-readable relative time string.
 * @param date - The future date to format relative to now.
 * @returns A string like "in 2 hours" or "in 30 minutes".
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) return 'overdue';

  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `in ${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `in ${diffHours}h ${diffMinutes % 60}m`;

  const diffDays = Math.floor(diffHours / 24);
  return `in ${diffDays}d ${diffHours % 24}h`;
}
