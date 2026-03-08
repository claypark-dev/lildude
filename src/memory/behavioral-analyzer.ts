/**
 * Behavioral preference inference from conversation history.
 * Analyzes conversation_logs via SQL aggregation to detect
 * recurring patterns — zero LLM cost.
 *
 * Runs daily via the learning journal (Sprint B, Gap 3).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { createModuleLogger } from '../utils/logger.js';
import { upsertKnowledge } from '../persistence/knowledge.js';

const log = createModuleLogger('behavioral-analyzer');

/** Summary of a behavioral analysis run. */
export interface BehavioralAnalysisResult {
  /** Number of new behavioral preferences inferred. */
  inferred: number;
  /** Keys of the inferred preferences. */
  keys: string[];
}

/**
 * Analyze conversation history to infer behavioral preferences.
 * All analysis is deterministic SQL aggregation — no LLM calls.
 *
 * @param db - Database connection.
 * @param lookbackDays - Number of days of history to analyze. Defaults to 30.
 * @returns Summary of inferred preferences.
 */
export function analyzeBehavioralPatterns(
  db: BetterSqlite3.Database,
  lookbackDays = 30,
): BehavioralAnalysisResult {
  const result: BehavioralAnalysisResult = { inferred: 0, keys: [] };

  try {
    const activeHoursResult = inferActiveHours(db, lookbackDays);
    if (activeHoursResult) {
      upsertKnowledge(db, {
        category: 'user_preference',
        key: 'active_hours',
        value: activeHoursResult,
        confidence: 0.4,
      });
      result.inferred++;
      result.keys.push('active_hours');
    }

    const peakDay = inferPeakDay(db, lookbackDays);
    if (peakDay) {
      upsertKnowledge(db, {
        category: 'user_preference',
        key: 'peak_usage_day',
        value: peakDay,
        confidence: 0.4,
      });
      result.inferred++;
      result.keys.push('peak_usage_day');
    }

    const avgLength = inferResponseLengthPreference(db, lookbackDays);
    if (avgLength) {
      upsertKnowledge(db, {
        category: 'user_preference',
        key: 'response_length',
        value: avgLength,
        confidence: 0.4,
      });
      result.inferred++;
      result.keys.push('response_length');
    }

    const topTopics = inferRecurringTopics(db, lookbackDays);
    if (topTopics) {
      upsertKnowledge(db, {
        category: 'learned_automation',
        key: 'recurring_topics',
        value: topTopics,
        confidence: 0.4,
      });
      result.inferred++;
      result.keys.push('recurring_topics');
    }

    if (result.inferred > 0) {
      log.info(result, 'Behavioral analysis completed');
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ error: msg }, 'Behavioral analysis failed');
  }

  return result;
}

/**
 * Infer the user's most active hours from conversation timestamps.
 * Groups user messages by hour and finds the peak period.
 */
function inferActiveHours(
  db: BetterSqlite3.Database,
  lookbackDays: number,
): string | null {
  const rows = db.prepare(`
    SELECT
      CAST(strftime('%H', created_at) AS INTEGER) as hour,
      COUNT(*) as msg_count
    FROM conversation_logs
    WHERE role = 'user'
      AND created_at > datetime('now', '-' || ? || ' days')
    GROUP BY hour
    HAVING msg_count >= 3
    ORDER BY msg_count DESC
    LIMIT 3
  `).all(lookbackDays) as Array<{ hour: number; msg_count: number }>;

  if (rows.length === 0) return null;

  // Build a readable active hours string
  const hours = rows.map((r) => {
    const h = r.hour;
    if (h < 6) return 'early morning';
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    if (h < 21) return 'evening';
    return 'night';
  });

  const uniquePeriods = [...new Set(hours)];
  return `Most active: ${uniquePeriods.join(', ')} (${rows[0].msg_count}+ messages)`;
}

/**
 * Infer the user's busiest day of the week.
 */
function inferPeakDay(
  db: BetterSqlite3.Database,
  lookbackDays: number,
): string | null {
  const row = db.prepare(`
    SELECT
      CASE CAST(strftime('%w', created_at) AS INTEGER)
        WHEN 0 THEN 'Sunday'
        WHEN 1 THEN 'Monday'
        WHEN 2 THEN 'Tuesday'
        WHEN 3 THEN 'Wednesday'
        WHEN 4 THEN 'Thursday'
        WHEN 5 THEN 'Friday'
        WHEN 6 THEN 'Saturday'
      END as day_name,
      COUNT(*) as msg_count
    FROM conversation_logs
    WHERE role = 'user'
      AND created_at > datetime('now', '-' || ? || ' days')
    GROUP BY CAST(strftime('%w', created_at) AS INTEGER)
    ORDER BY msg_count DESC
    LIMIT 1
  `).get(lookbackDays) as { day_name: string; msg_count: number } | undefined;

  if (!row || row.msg_count < 5) return null;
  return `${row.day_name} (${row.msg_count} messages in last ${lookbackDays} days)`;
}

/**
 * Infer whether the user prefers short or detailed responses.
 * Looks for follow-up messages containing length signals.
 */
function inferResponseLengthPreference(
  db: BetterSqlite3.Database,
  lookbackDays: number,
): string | null {
  // Count messages with "shorter", "brief", "concise" vs "more detail", "elaborate", "explain more"
  const shortSignals = db.prepare(`
    SELECT COUNT(*) as cnt FROM conversation_logs
    WHERE role = 'user'
      AND created_at > datetime('now', '-' || ? || ' days')
      AND (
        content LIKE '%shorter%' OR content LIKE '%brief%' OR content LIKE '%concise%'
        OR content LIKE '%too long%' OR content LIKE '%summarize%' OR content LIKE '%tldr%'
      )
  `).get(lookbackDays) as { cnt: number };

  const longSignals = db.prepare(`
    SELECT COUNT(*) as cnt FROM conversation_logs
    WHERE role = 'user'
      AND created_at > datetime('now', '-' || ? || ' days')
      AND (
        content LIKE '%more detail%' OR content LIKE '%elaborate%' OR content LIKE '%explain more%'
        OR content LIKE '%too short%' OR content LIKE '%expand%'
      )
  `).get(lookbackDays) as { cnt: number };

  if (shortSignals.cnt >= 3 && shortSignals.cnt > longSignals.cnt * 2) {
    return 'prefers concise responses';
  }
  if (longSignals.cnt >= 3 && longSignals.cnt > shortSignals.cnt * 2) {
    return 'prefers detailed responses';
  }
  return null;
}

/**
 * Detect recurring request topics from user messages.
 * Uses simple keyword frequency analysis.
 */
function inferRecurringTopics(
  db: BetterSqlite3.Database,
  lookbackDays: number,
): string | null {
  // Get user messages from the lookback period
  const messages = db.prepare(`
    SELECT content FROM conversation_logs
    WHERE role = 'user'
      AND created_at > datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC
    LIMIT 200
  `).all(lookbackDays) as Array<{ content: string }>;

  if (messages.length < 10) return null;

  // Extract meaningful words and count frequencies
  const wordFreq = new Map<string, number>();
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'must', 'need', 'dare',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
    'this', 'that', 'these', 'those', 'it', 'its', 'my', 'your', 'his',
    'her', 'our', 'their', 'me', 'him', 'you', 'us', 'them', 'who',
    'what', 'which', 'when', 'where', 'why', 'how', 'all', 'each',
    'just', 'about', 'like', 'get', 'got', 'make', 'know', 'think',
    'want', 'please', 'thanks', 'thank', 'hey', 'hello', 'help',
  ]);

  for (const msg of messages) {
    const words = msg.content
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));

    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
    }
  }

  // Get top recurring words (appearing in 5+ messages)
  const topWords = [...wordFreq.entries()]
    .filter(([, count]) => count >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  if (topWords.length === 0) return null;
  return topWords.join(', ');
}
