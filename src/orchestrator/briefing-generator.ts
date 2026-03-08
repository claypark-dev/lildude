/**
 * Daily Briefing Generator.
 * Assembles a structured briefing from all active waves, tasks, cron jobs,
 * cost data, and connected integrations (email, calendar).
 * No LLM calls — only deterministic DB queries and API fetches.
 *
 * See HLD Section 6.4 for briefing architecture.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { getRecentTasks, getTasksByStatus } from '../persistence/tasks.js';
import { getDailyTotalCost, getMonthlyTotalCost } from '../persistence/token-usage.js';
import { getEnabledCronJobs } from '../persistence/cron-jobs.js';
import { getAllWaves } from '../waves/registry.js';
import { listTokens } from '../integrations/oauth-store.js';
import { listEmails } from '../integrations/gmail.js';
import { listEvents } from '../integrations/google-calendar.js';
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
  activeWaves: number;
  scheduledJobs: number;
  pendingTasks: number;
  todayCostUsd: number;
  monthlyCostUsd: number;
}

/** Optional OAuth accessor passed to the briefing for fetching integration data. */
export interface BriefingOAuthDeps {
  getAccessToken: (provider: string) => Promise<string | null>;
}

/**
 * Generate a daily briefing by querying all available data sources.
 * No LLM calls — only DB queries and optional API fetches for integrations.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param oauthDeps - Optional OAuth deps for fetching live email/calendar data.
 * @returns A structured DailyBriefing object.
 */
export async function generateBriefing(
  db: BetterSqlite3.Database,
  oauthDeps?: BriefingOAuthDeps,
): Promise<DailyBriefing> {
  briefingLogger.info('Generating daily briefing');

  const now = new Date();
  const greeting = buildGreeting(now);
  const summary = buildSummary(db);
  const sections: BriefingSection[] = [];

  sections.push(buildIntegrationsSection(db));

  // Fetch live email + calendar data if OAuth is available
  const hasGoogleToken = hasGoogleOAuthToken(db);
  if (hasGoogleToken && oauthDeps) {
    const [emailSection, calendarSection] = await Promise.all([
      buildEmailSection(oauthDeps),
      buildCalendarSection(oauthDeps),
    ]);
    sections.push(emailSection);
    sections.push(calendarSection);
  } else if (!hasGoogleToken) {
    sections.push(buildNoEmailSection());
    sections.push(buildNoCalendarSection());
  }

  sections.push(buildRecentlyLearnedSection(db));
  sections.push(buildWavesSection());
  sections.push(buildTasksSection(db));
  sections.push(buildScheduleSection(db));
  sections.push(buildCostSection(db));

  briefingLogger.info(
    { sectionCount: sections.length, activeWaves: summary.activeWaves },
    'Daily briefing generated',
  );

  return {
    generatedAt: now.toISOString(),
    greeting,
    sections,
    summary,
  };
}

/** Check if a Google OAuth token exists in the database. */
function hasGoogleOAuthToken(db: BetterSqlite3.Database): boolean {
  try {
    const tokens = listTokens(db);
    return tokens.some((t) => t.provider === 'google');
  } catch {
    return false;
  }
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
  const waves = getAllWaves();
  const cronJobs = getEnabledCronJobs(db);
  const pendingTasks = getTasksByStatus(db, 'pending');
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = new Date().toISOString().slice(0, 7);

  return {
    activeWaves: waves.size,
    scheduledJobs: cronJobs.length,
    pendingTasks: pendingTasks.length,
    todayCostUsd: getDailyTotalCost(db, today),
    monthlyCostUsd: getMonthlyTotalCost(db, currentMonth),
  };
}

/** Build the integrations section showing connected services. */
function buildIntegrationsSection(db: BetterSqlite3.Database): BriefingSection {
  const items: BriefingItem[] = [];

  try {
    const tokens = listTokens(db);

    if (tokens.length === 0) {
      items.push({
        label: 'No integrations connected',
        value: 'Connect Google or Microsoft via Settings > Integrations',
        status: 'neutral',
      });
    } else {
      for (const token of tokens) {
        const expired = token.expiresAt ? new Date(token.expiresAt) < new Date() : false;
        items.push({
          label: `${token.provider} (${token.accountLabel})`,
          value: token.scope ? `Scopes: ${token.scope.split(' ').length}` : 'Connected',
          status: expired ? 'warning' : 'good',
        });
      }
    }
  } catch {
    items.push({
      label: 'Integration check failed',
      value: 'Could not load integration status',
      status: 'warning',
    });
  }

  return { title: 'Integrations', icon: '\uD83D\uDD17', items };
}

// ─── Email Section ──────────────────────────────────────────────────────────

/** Build the email section by fetching unread count from Gmail. */
async function buildEmailSection(oauthDeps: BriefingOAuthDeps): Promise<BriefingSection> {
  const items: BriefingItem[] = [];

  try {
    const accessToken = await oauthDeps.getAccessToken('google');
    if (!accessToken) {
      return buildNoEmailSection();
    }

    const result = await listEmails(accessToken, {
      maxResults: 10,
      unreadOnly: true,
    });

    if (!result.success) {
      items.push({
        label: 'Email check failed',
        value: result.error ?? 'Could not fetch emails',
        status: 'warning',
      });
      return { title: 'Email', icon: '\u2709', items };
    }

    const emails = result.emails ?? [];
    const unreadCount = emails.length;

    if (unreadCount === 0) {
      items.push({
        label: 'Inbox zero',
        value: 'No unread emails',
        status: 'good',
      });
    } else {
      items.push({
        label: 'Unread emails',
        value: `${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`,
        status: unreadCount > 5 ? 'warning' : 'info',
      });

      // Show top 3 unread subjects
      for (const email of emails.slice(0, 3)) {
        items.push({
          label: email.subject || '(no subject)',
          value: `From: ${email.from}`,
          status: 'neutral',
        });
      }

      if (unreadCount > 3) {
        items.push({
          label: `+${unreadCount - 3} more`,
          value: 'Say "check my email" to see all',
          status: 'neutral',
        });
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    briefingLogger.warn({ error: message }, 'Failed to build email section');
    items.push({
      label: 'Email unavailable',
      value: 'Could not connect to Gmail',
      status: 'warning',
    });
  }

  return { title: 'Email', icon: '\u2709', items };
}

/** Placeholder email section when Google isn't connected. */
function buildNoEmailSection(): BriefingSection {
  return {
    title: 'Email',
    icon: '\u2709',
    items: [{
      label: 'Gmail not connected',
      value: 'Connect Google via Settings > Integrations to see emails here',
      status: 'neutral',
    }],
  };
}

// ─── Calendar Section ───────────────────────────────────────────────────────

/** Build the calendar section by fetching today's events. */
async function buildCalendarSection(oauthDeps: BriefingOAuthDeps): Promise<BriefingSection> {
  const items: BriefingItem[] = [];

  try {
    const accessToken = await oauthDeps.getAccessToken('google');
    if (!accessToken) {
      return buildNoCalendarSection();
    }

    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await listEvents(
      accessToken,
      now.toISOString(),
      endOfDay.toISOString(),
      20,
    );

    if (!result.success) {
      items.push({
        label: 'Calendar check failed',
        value: result.error ?? 'Could not fetch events',
        status: 'warning',
      });
      return { title: 'Calendar', icon: '\uD83D\uDCC5', items };
    }

    const events = result.events ?? [];

    if (events.length === 0) {
      items.push({
        label: 'No events today',
        value: 'Your calendar is clear for the rest of the day',
        status: 'good',
      });
    } else {
      items.push({
        label: "Today's events",
        value: `${events.length} event${events.length === 1 ? '' : 's'} remaining`,
        status: 'info',
      });

      for (const event of events.slice(0, 5)) {
        const startTime = formatEventTime(event.start);
        const locationText = event.location ? ` | ${event.location}` : '';
        items.push({
          label: event.summary,
          value: `${startTime}${locationText}`,
          status: 'neutral',
        });
      }

      if (events.length > 5) {
        items.push({
          label: `+${events.length - 5} more events`,
          value: 'Say "check my calendar" to see all',
          status: 'neutral',
        });
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    briefingLogger.warn({ error: message }, 'Failed to build calendar section');
    items.push({
      label: 'Calendar unavailable',
      value: 'Could not connect to Google Calendar',
      status: 'warning',
    });
  }

  return { title: 'Calendar', icon: '\uD83D\uDCC5', items };
}

/** Placeholder calendar section when Google isn't connected. */
function buildNoCalendarSection(): BriefingSection {
  return {
    title: 'Calendar',
    icon: '\uD83D\uDCC5',
    items: [{
      label: 'Calendar not connected',
      value: 'Connect Google via Settings > Integrations to see events here',
      status: 'neutral',
    }],
  };
}

/** Format an event start time for display. */
function formatEventTime(isoStr: string): string {
  try {
    const date = new Date(isoStr);
    if (isNaN(date.getTime())) return isoStr;
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

// ─── Recently Learned Section ────────────────────────────────────────────────

/**
 * Build a section showing recently learned facts with low confidence,
 * giving the user a chance to confirm or deny them.
 */
function buildRecentlyLearnedSection(db: BetterSqlite3.Database): BriefingSection {
  const items: BriefingItem[] = [];

  try {
    // Find recent facts with low confidence that haven't been accessed much
    const recentFacts = db.prepare(`
      SELECT category, key, value, confidence, created_at
      FROM knowledge
      WHERE confidence < 0.6
        AND access_count < 2
        AND superseded_by IS NULL
        AND created_at > datetime('now', '-7 days')
      ORDER BY created_at DESC
      LIMIT 5
    `).all() as Array<{
      category: string;
      key: string;
      value: string;
      confidence: number;
      created_at: string;
    }>;

    if (recentFacts.length === 0) {
      items.push({
        label: 'No new facts to confirm',
        value: 'Everything looks good',
        status: 'good',
      });
    } else {
      for (const fact of recentFacts) {
        const displayKey = fact.key.replace(/_/g, ' ').replace(/^favorite /, 'fav ');
        items.push({
          label: `${displayKey}: ${fact.value}`,
          value: `Confidence: ${Math.round(fact.confidence * 100)}% — say "correct" or "wrong" to update`,
          status: fact.confidence < 0.4 ? 'warning' : 'info',
        });
      }
    }
  } catch {
    // Knowledge table may not have the new columns yet — silently skip
    items.push({
      label: 'Memory check skipped',
      value: 'Could not load recent facts',
      status: 'neutral',
    });
  }

  return { title: 'Recently Learned', icon: '\uD83E\uDDE0', items };
}

// ─── Other Sections ─────────────────────────────────────────────────────────

/** Build the registered waves section listing all available capabilities. */
function buildWavesSection(): BriefingSection {
  const waves = getAllWaves();
  const items: BriefingItem[] = [];

  for (const [name, wave] of waves) {
    const manifest = wave.manifest;
    items.push({
      label: name,
      value: manifest.description,
      status: manifest.deterministic ? 'good' : 'info',
    });
  }

  if (items.length === 0) {
    items.push({
      label: 'No waves loaded',
      value: 'Install waves in ~/.lil-dude/waves/installed/',
      status: 'neutral',
    });
  }

  return { title: 'Active Waves', icon: '\u26A1', items };
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
