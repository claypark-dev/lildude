/**
 * Learning Journal — Daily SQL aggregation engine.
 * Generates daily summaries of task volume, success rates, common
 * request types, cost trends, and feedback data. No LLM calls —
 * only deterministic DB queries.
 *
 * Designed to be called once per day (e.g. via cron) or on demand.
 * Results are stored in the learning_journal table and fed into
 * the morning briefing.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { createModuleLogger } from '../utils/logger.js';
import { getDailyTotalCost } from '../persistence/token-usage.js';
import { getDailyFeedbackCounts } from '../persistence/user-feedback.js';
import { getTopFailureTypes, type TopFailureType } from '../persistence/failure-patterns.js';
import { getTopWavesByUsage, type TopWaveUsage } from '../persistence/wave-effectiveness.js';
import { runKnowledgeLifecycle } from '../memory/knowledge-lifecycle.js';
import { analyzeBehavioralPatterns } from '../memory/behavioral-analyzer.js';

const journalLogger = createModuleLogger('learning-journal');

/** A single learning journal entry. */
export interface JournalEntry {
  id: number;
  date: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalCostUsd: number;
  avgQualityScore: number | null;
  topWaves: TopWaveUsage[];
  topFailureTypes: TopFailureType[];
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  summary: string | null;
  createdAt: string;
}

/** Raw row from the learning_journal table. */
interface JournalDbRow {
  id: number;
  date: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  total_cost_usd: number;
  avg_quality_score: number | null;
  top_waves: string | null;
  top_failure_types: string | null;
  positive_feedback_count: number;
  negative_feedback_count: number;
  summary: string | null;
  created_at: string;
}

/**
 * Generate and store a daily journal entry for the given date.
 * Aggregates data from tasks, token_usage, user_feedback, routing_history,
 * failure_patterns, and generated_waves tables.
 *
 * @param db - The database instance.
 * @param date - The date to aggregate (YYYY-MM-DD). Defaults to yesterday.
 * @returns The generated journal entry.
 */
export function generateDailyJournal(
  db: BetterSqlite3.Database,
  date?: string,
): JournalEntry {
  const targetDate = date ?? getYesterday();

  journalLogger.info({ date: targetDate }, 'Generating daily learning journal');

  try {
    // Check for existing entry to avoid duplicates
    const existing = db.prepare(
      'SELECT id FROM learning_journal WHERE date = ?',
    ).get(targetDate) as { id: number } | undefined;

    if (existing) {
      journalLogger.info({ date: targetDate }, 'Journal entry already exists, skipping');
      return getJournalEntry(db, targetDate)!;
    }

    // Aggregate task stats
    const taskStats = db.prepare(`
      SELECT
        COUNT(*) as total_tasks,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed_tasks,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed_tasks
      FROM tasks
      WHERE DATE(created_at) = ?
    `).get(targetDate) as {
      total_tasks: number;
      completed_tasks: number;
      failed_tasks: number;
    };

    // Aggregate quality scores from routing history
    const qualityStats = db.prepare(`
      SELECT AVG(quality_score) as avg_score
      FROM routing_history
      WHERE DATE(created_at) = ? AND quality_score IS NOT NULL
    `).get(targetDate) as { avg_score: number | null };

    // Get daily cost
    const totalCostUsd = getDailyTotalCost(db, targetDate);

    // Get feedback counts
    const feedbackCounts = getDailyFeedbackCounts(db, targetDate);

    // Get top waves and failure types
    const topWaves = getTopWavesByUsage(db, 5);
    const topFailureTypes = getTopFailureTypes(db, targetDate, 5);

    // Store the journal entry
    const stmt = db.prepare(`
      INSERT INTO learning_journal (
        date, total_tasks, completed_tasks, failed_tasks,
        total_cost_usd, avg_quality_score, top_waves, top_failure_types,
        positive_feedback_count, negative_feedback_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      targetDate,
      taskStats.total_tasks,
      taskStats.completed_tasks,
      taskStats.failed_tasks,
      totalCostUsd,
      qualityStats.avg_score,
      JSON.stringify(topWaves),
      JSON.stringify(topFailureTypes),
      feedbackCounts.positiveCount,
      feedbackCounts.negativeCount,
    );

    const entry: JournalEntry = {
      id: Number(result.lastInsertRowid),
      date: targetDate,
      totalTasks: taskStats.total_tasks,
      completedTasks: taskStats.completed_tasks,
      failedTasks: taskStats.failed_tasks,
      totalCostUsd,
      avgQualityScore: qualityStats.avg_score,
      topWaves,
      topFailureTypes,
      positiveFeedbackCount: feedbackCounts.positiveCount,
      negativeFeedbackCount: feedbackCounts.negativeCount,
      summary: null,
      createdAt: new Date().toISOString(),
    };

    journalLogger.info(
      { date: targetDate, totalTasks: entry.totalTasks, completedTasks: entry.completedTasks },
      'Daily journal entry generated',
    );

    // Run knowledge lifecycle (eviction, decay, dedup) alongside the daily journal
    try {
      const lifecycleResult = runKnowledgeLifecycle(db);
      journalLogger.info(
        { ...lifecycleResult, date: targetDate },
        'Knowledge lifecycle completed during daily journal',
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      journalLogger.warn({ error: msg }, 'Knowledge lifecycle failed (non-fatal)');
    }

    // Run behavioral analysis to infer preferences from conversation patterns
    try {
      const behavioralResult = analyzeBehavioralPatterns(db);
      if (behavioralResult.inferred > 0) {
        journalLogger.info(
          { ...behavioralResult, date: targetDate },
          'Behavioral analysis completed during daily journal',
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      journalLogger.warn({ error: msg }, 'Behavioral analysis failed (non-fatal)');
    }

    return entry;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    journalLogger.error({ date: targetDate, error: message }, 'Failed to generate journal');
    throw new PersistenceError(`Failed to generate daily journal: ${message}`);
  }
}

/**
 * Get a journal entry for a specific date.
 *
 * @param db - The database instance.
 * @param date - The date string (YYYY-MM-DD).
 * @returns The journal entry or null.
 */
export function getJournalEntry(
  db: BetterSqlite3.Database,
  date: string,
): JournalEntry | null {
  try {
    const row = db.prepare(
      'SELECT * FROM learning_journal WHERE date = ?',
    ).get(date) as JournalDbRow | undefined;

    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get journal entry: ${message}`);
  }
}

/**
 * Get recent journal entries for display.
 *
 * @param db - The database instance.
 * @param limit - Maximum entries to return.
 * @returns Recent journal entries ordered by date descending.
 */
export function getRecentJournals(
  db: BetterSqlite3.Database,
  limit = 7,
): JournalEntry[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM learning_journal ORDER BY date DESC LIMIT ?',
    ).all(limit) as JournalDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get recent journals: ${message}`);
  }
}

/** Get yesterday's date as YYYY-MM-DD. */
function getYesterday(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}

/** Map a raw DB row to a typed JournalEntry. */
function mapRow(row: JournalDbRow): JournalEntry {
  return {
    id: row.id,
    date: row.date,
    totalTasks: row.total_tasks,
    completedTasks: row.completed_tasks,
    failedTasks: row.failed_tasks,
    totalCostUsd: row.total_cost_usd,
    avgQualityScore: row.avg_quality_score,
    topWaves: safeParseJson<TopWaveUsage[]>(row.top_waves, []),
    topFailureTypes: safeParseJson<TopFailureType[]>(row.top_failure_types, []),
    positiveFeedbackCount: row.positive_feedback_count,
    negativeFeedbackCount: row.negative_feedback_count,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

/** Safely parse JSON with a fallback value. */
function safeParseJson<T>(jsonStr: string | null, fallback: T): T {
  if (!jsonStr) return fallback;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}
