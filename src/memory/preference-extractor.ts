/**
 * User preference extraction.
 * After each conversation, scans for patterns in communication style,
 * schedule preferences, and common requests. Stores extracted preferences
 * in the user_profile table for injection into the system prompt.
 * See Sprint 1: Enhanced Memory & Learning.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { orchestratorLogger } from '../utils/logger.js';

/** A preference extracted from conversation text. */
interface ExtractedPreference {
  key: string;
  value: string;
  confidence: number;
}

/** Patterns for detecting communication style preferences. */
const STYLE_PATTERNS: Array<{ pattern: RegExp; key: string; extractor: (match: RegExpMatchArray) => string }> = [
  {
    pattern: /(?:call me|my name is|i'm|i am)\s+(\w+)/i,
    key: 'preferred_name',
    extractor: (match) => match[1],
  },
  {
    pattern: /(?:i prefer|please use|always use)\s+(formal|casual|brief|detailed)\s+(?:language|tone|style|responses)/i,
    key: 'communication_style',
    extractor: (match) => match[1].toLowerCase(),
  },
  {
    pattern: /(?:i(?:'m| am) in|my timezone is|i live in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    key: 'timezone_hint',
    extractor: (match) => match[1],
  },
  {
    pattern: /(?:i work|my work hours|i'm available)\s+(?:from\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    key: 'work_hours',
    extractor: (match) => `${match[1]} to ${match[2]}`,
  },
];

/** Patterns for detecting common request types. */
const REQUEST_PATTERNS: Array<{ pattern: RegExp; key: string; value: string }> = [
  { pattern: /\b(?:check|read|open)\s+(?:my\s+)?emails?\b/i, key: 'common_request', value: 'email_check' },
  { pattern: /\b(?:what'?s?\s+(?:on\s+)?my|check\s+(?:my\s+)?)calendar\b/i, key: 'common_request', value: 'calendar_check' },
  { pattern: /\b(?:weather|forecast|temperature)\b/i, key: 'common_request', value: 'weather_check' },
  { pattern: /\b(?:remind|reminder|set\s+(?:a\s+)?reminder)\b/i, key: 'common_request', value: 'reminders' },
  { pattern: /\b(?:summarize|summary|brief)\b/i, key: 'common_request', value: 'summarization' },
];

/**
 * Extract preferences from a conversation transcript and persist them.
 * Deterministic extraction — no LLM calls. Scans for patterns in user messages.
 *
 * @param db - Database connection.
 * @param userMessages - Array of the user's messages from the conversation.
 */
export function extractAndStorePreferences(
  db: BetterSqlite3.Database,
  userMessages: string[],
): void {
  try {
    const allText = userMessages.join(' ');
    const preferences: ExtractedPreference[] = [];

    // Extract communication style preferences
    for (const { pattern, key, extractor } of STYLE_PATTERNS) {
      const match = allText.match(pattern);
      if (match) {
        preferences.push({
          key,
          value: extractor(match),
          confidence: 0.7,
        });
      }
    }

    // Track common request types
    for (const { pattern, key, value } of REQUEST_PATTERNS) {
      if (pattern.test(allText)) {
        preferences.push({ key: `${key}:${value}`, value, confidence: 0.5 });
      }
    }

    // Detect response length preference from user feedback
    const shortResponses = (allText.match(/\b(?:shorter|brief|concise|tl;?dr)\b/gi) ?? []).length;
    const longResponses = (allText.match(/\b(?:more detail|elaborate|explain more|longer)\b/gi) ?? []).length;
    if (shortResponses > longResponses && shortResponses > 0) {
      preferences.push({ key: 'response_length', value: 'concise', confidence: 0.6 });
    } else if (longResponses > shortResponses && longResponses > 0) {
      preferences.push({ key: 'response_length', value: 'detailed', confidence: 0.6 });
    }

    // Persist extracted preferences
    for (const pref of preferences) {
      upsertPreference(db, pref.key, pref.value, 'inferred', pref.confidence);
    }

    if (preferences.length > 0) {
      orchestratorLogger.debug(
        { count: preferences.length, keys: preferences.map((p) => p.key) },
        'Preferences extracted from conversation',
      );
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    orchestratorLogger.warn({ error: msg }, 'Failed to extract preferences');
  }
}

/**
 * Upsert a preference into the user_profile table.
 * If the key already exists, updates the value only if the new confidence
 * is higher or the value is different with sufficient confidence.
 *
 * @param db - Database connection.
 * @param key - Preference key.
 * @param value - Preference value.
 * @param source - Source of the preference (inferred, explicit, system).
 * @param confidence - Confidence score (0-1).
 */
export function upsertPreference(
  db: BetterSqlite3.Database,
  key: string,
  value: string,
  source: 'inferred' | 'explicit' | 'system',
  confidence: number,
): void {
  const existing = db.prepare(
    'SELECT id, value, confidence, source FROM user_profile WHERE key = ?',
  ).get(key) as { id: number; value: string; confidence: number; source: string } | undefined;

  if (existing) {
    // Explicit always wins over inferred
    const sourceRank = { system: 3, explicit: 2, inferred: 1 };
    const existingRank = sourceRank[existing.source as keyof typeof sourceRank] ?? 0;
    const newRank = sourceRank[source] ?? 0;

    if (newRank > existingRank || (newRank === existingRank && confidence > existing.confidence)) {
      db.prepare(
        `UPDATE user_profile
         SET value = ?, source = ?, confidence = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(value, source, confidence, existing.id);
    } else if (existing.value === value) {
      // Same value — boost confidence
      const boostedConfidence = Math.min(1.0, existing.confidence + 0.05);
      db.prepare(
        `UPDATE user_profile
         SET confidence = ?, access_count = access_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(boostedConfidence, existing.id);
    }
  } else {
    db.prepare(
      `INSERT INTO user_profile (key, value, source, confidence)
       VALUES (?, ?, ?, ?)`,
    ).run(key, value, source, confidence);
  }
}

/**
 * Load all user profile entries for injection into the system prompt.
 *
 * @param db - Database connection.
 * @returns Array of profile entries sorted by confidence descending.
 */
export function loadUserProfile(
  db: BetterSqlite3.Database,
): Array<{ key: string; value: string; confidence: number }> {
  const rows = db.prepare(
    `SELECT key, value, confidence
     FROM user_profile
     ORDER BY confidence DESC, updated_at DESC`,
  ).all() as Array<{ key: string; value: string; confidence: number }>;

  return rows;
}
