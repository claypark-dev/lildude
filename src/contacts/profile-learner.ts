/**
 * Contact Profile Learner.
 * Extracts and stores facts about each contact Lil Dude interacts with.
 * Deterministic extraction (no LLM cost) — pattern-based from conversation text.
 *
 * What Lil Dude learns about contacts:
 * - Preferred name and communication style
 * - Timezone and availability hints
 * - Common topics and request patterns
 * - Relationship context (how they relate to the owner)
 * - Interaction frequency and recency
 */

import type BetterSqlite3 from 'better-sqlite3';
import { orchestratorLogger } from '../utils/logger.js';

/** A fact learned about a contact. */
export interface ContactFact {
  key: string;
  value: string;
  confidence: number;
}

/** A stored contact profile entry. */
export interface ContactProfileEntry {
  id: number;
  contactId: string;
  key: string;
  value: string;
  source: 'inferred' | 'explicit' | 'system';
  confidence: number;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Raw DB row for contact_profiles. */
interface ContactProfileDbRow {
  id: number;
  contact_id: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  access_count: number;
  created_at: string;
  updated_at: string;
}

/** Patterns for extracting contact details from conversation text. */
const CONTACT_PATTERNS: Array<{
  pattern: RegExp;
  key: string;
  extractor: (match: RegExpMatchArray) => string;
  confidence: number;
}> = [
  // Name preferences
  {
    pattern: /(?:(?:call me|my name is|i'm|i am|this is)\s+)(\w+(?:\s+\w+)?)/i,
    key: 'preferred_name',
    extractor: (match) => match[1].trim(),
    confidence: 0.8,
  },
  // Timezone / location
  {
    pattern: /(?:i(?:'m| am) in|i live in|based in|from)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/i,
    key: 'location',
    extractor: (match) => match[1].trim(),
    confidence: 0.7,
  },
  // Communication preference
  {
    pattern: /(?:i prefer|please use|can you use)\s+(formal|casual|brief|detailed|simple)\b/i,
    key: 'communication_style',
    extractor: (match) => match[1].toLowerCase(),
    confidence: 0.75,
  },
  // Availability
  {
    pattern: /(?:i(?:'m| am) (?:usually )?(?:available|free|online))\s+(?:from\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    key: 'availability',
    extractor: (match) => `${match[1]} to ${match[2]}`,
    confidence: 0.7,
  },
  // Language preference
  {
    pattern: /(?:i speak|my language is|respond in)\s+(english|spanish|french|german|chinese|japanese|korean|portuguese|arabic|hindi|russian)/i,
    key: 'language',
    extractor: (match) => match[1].toLowerCase(),
    confidence: 0.8,
  },
  // Job / role
  {
    pattern: /(?:i(?:'m| am) (?:a |an )?|i work as (?:a |an )?)(\w+(?:\s+\w+)?)\s+(?:at|for|in)\s+(\w+(?:\s+\w+)*)/i,
    key: 'role_at_company',
    extractor: (match) => `${match[1]} at ${match[2]}`,
    confidence: 0.6,
  },
];

/** Topic patterns to track common conversation themes. */
const TOPIC_PATTERNS: Array<{ pattern: RegExp; topic: string }> = [
  { pattern: /\b(?:meeting|calendar|schedule|appointment)\b/i, topic: 'scheduling' },
  { pattern: /\b(?:email|message|send|reply)\b/i, topic: 'communication' },
  { pattern: /\b(?:project|task|deadline|deliverable)\b/i, topic: 'work' },
  { pattern: /\b(?:flight|travel|hotel|trip)\b/i, topic: 'travel' },
  { pattern: /\b(?:birthday|anniversary|party|celebration)\b/i, topic: 'events' },
  { pattern: /\b(?:weather|forecast|rain|sunny)\b/i, topic: 'weather' },
  { pattern: /\b(?:stock|invest|market|portfolio)\b/i, topic: 'finance' },
];

/**
 * Map a raw database row to a ContactProfileEntry.
 */
function mapRow(row: ContactProfileDbRow): ContactProfileEntry {
  return {
    id: row.id,
    contactId: row.contact_id,
    key: row.key,
    value: row.value,
    source: row.source as 'inferred' | 'explicit' | 'system',
    confidence: row.confidence,
    accessCount: row.access_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Extract facts about a contact from their messages and store them.
 * Deterministic — no LLM cost. Called after each conversation with an external user.
 *
 * @param db - Database connection.
 * @param contactId - The contact's ID.
 * @param messages - The contact's messages from the conversation.
 */
export function learnFromConversation(
  db: BetterSqlite3.Database,
  contactId: string,
  messages: string[],
): void {
  try {
    const allText = messages.join(' ');
    const facts: ContactFact[] = [];

    // Extract contact details from patterns
    for (const { pattern, key, extractor, confidence } of CONTACT_PATTERNS) {
      const match = allText.match(pattern);
      if (match) {
        facts.push({ key, value: extractor(match), confidence });
      }
    }

    // Track common topics
    const topicCounts: Record<string, number> = {};
    for (const { pattern, topic } of TOPIC_PATTERNS) {
      const matches = allText.match(new RegExp(pattern.source, 'gi'));
      if (matches) {
        topicCounts[topic] = (topicCounts[topic] ?? 0) + matches.length;
      }
    }

    // Store top topics as facts
    const sortedTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    for (const [topic, count] of sortedTopics) {
      if (count >= 2) {
        facts.push({
          key: `topic:${topic}`,
          value: `Frequently discusses ${topic}`,
          confidence: Math.min(0.9, 0.4 + count * 0.1),
        });
      }
    }

    // Track message style
    const avgLength = messages.reduce((sum, m) => sum + m.length, 0) / Math.max(messages.length, 1);
    if (avgLength < 50) {
      facts.push({ key: 'message_style', value: 'brief', confidence: 0.5 });
    } else if (avgLength > 200) {
      facts.push({ key: 'message_style', value: 'detailed', confidence: 0.5 });
    }

    // Store all extracted facts
    for (const fact of facts) {
      upsertContactFact(db, contactId, fact.key, fact.value, 'inferred', fact.confidence);
    }

    // Update interaction count
    upsertContactFact(
      db,
      contactId,
      'interaction_count',
      String(getInteractionCount(db, contactId) + 1),
      'system',
      1.0,
    );

    if (facts.length > 0) {
      orchestratorLogger.debug(
        { contactId, factCount: facts.length, keys: facts.map(f => f.key) },
        'Contact facts extracted from conversation',
      );
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    orchestratorLogger.warn({ contactId, error: msg }, 'Failed to learn from conversation');
  }
}

/**
 * Upsert a fact into the contact_profiles table.
 * If the key already exists for this contact, updates based on confidence ranking.
 *
 * @param db - Database connection.
 * @param contactId - The contact's ID.
 * @param key - The fact key.
 * @param value - The fact value.
 * @param source - Source of the fact (inferred, explicit, system).
 * @param confidence - Confidence score (0-1).
 */
export function upsertContactFact(
  db: BetterSqlite3.Database,
  contactId: string,
  key: string,
  value: string,
  source: 'inferred' | 'explicit' | 'system',
  confidence: number,
): void {
  const existing = db.prepare(
    'SELECT id, value, confidence, source FROM contact_profiles WHERE contact_id = ? AND key = ?',
  ).get(contactId, key) as { id: number; value: string; confidence: number; source: string } | undefined;

  if (existing) {
    const sourceRank: Record<string, number> = { system: 3, explicit: 2, inferred: 1 };
    const existingRank = sourceRank[existing.source] ?? 0;
    const newRank = sourceRank[source] ?? 0;

    if (source === 'system' || newRank > existingRank || (newRank === existingRank && confidence > existing.confidence)) {
      db.prepare(
        `UPDATE contact_profiles
         SET value = ?, source = ?, confidence = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(value, source, confidence, existing.id);
    } else if (existing.value === value) {
      // Same value — boost confidence
      const boosted = Math.min(1.0, existing.confidence + 0.05);
      db.prepare(
        `UPDATE contact_profiles
         SET confidence = ?, access_count = access_count + 1, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(boosted, existing.id);
    }
  } else {
    db.prepare(
      `INSERT INTO contact_profiles (contact_id, key, value, source, confidence)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(contactId, key, value, source, confidence);
  }
}

/**
 * Load all profile entries for a contact.
 *
 * @param db - Database connection.
 * @param contactId - The contact's ID.
 * @returns Array of ContactProfileEntry sorted by confidence descending.
 */
export function loadContactProfile(
  db: BetterSqlite3.Database,
  contactId: string,
): ContactProfileEntry[] {
  const rows = db.prepare(
    `SELECT * FROM contact_profiles
     WHERE contact_id = ?
     ORDER BY confidence DESC, updated_at DESC`,
  ).all(contactId) as ContactProfileDbRow[];

  return rows.map(mapRow);
}

/**
 * Get a specific fact about a contact.
 *
 * @param db - Database connection.
 * @param contactId - The contact's ID.
 * @param key - The fact key to retrieve.
 * @returns The fact value or null if not found.
 */
export function getContactFact(
  db: BetterSqlite3.Database,
  contactId: string,
  key: string,
): string | null {
  const row = db.prepare(
    'SELECT value FROM contact_profiles WHERE contact_id = ? AND key = ?',
  ).get(contactId, key) as { value: string } | undefined;

  if (row) {
    // Bump access count
    db.prepare(
      `UPDATE contact_profiles
       SET access_count = access_count + 1, updated_at = datetime('now')
       WHERE contact_id = ? AND key = ?`,
    ).run(contactId, key);
  }

  return row?.value ?? null;
}

/**
 * Build a contact knowledge summary for inclusion in the system prompt.
 * Used when processing messages from this contact.
 *
 * @param db - Database connection.
 * @param contactId - The contact's ID.
 * @returns Formatted string of what Lil Dude knows about this contact.
 */
export function buildContactKnowledgeSection(
  db: BetterSqlite3.Database,
  contactId: string,
): string {
  const entries = loadContactProfile(db, contactId);
  if (entries.length === 0) {
    return '';
  }

  // Filter out system-level entries like interaction_count from the visible section
  const visibleEntries = entries.filter(
    (e) => e.source !== 'system' && e.confidence >= 0.4,
  );

  if (visibleEntries.length === 0) {
    return '';
  }

  const lines = visibleEntries.map((e) => `- ${e.key}: ${e.value}`);
  return `## What I Know About This Contact\n${lines.join('\n')}`;
}

/**
 * Delete all learned facts about a contact.
 * Used when a contact is deleted.
 *
 * @param db - Database connection.
 * @param contactId - The contact's ID.
 */
export function clearContactProfile(
  db: BetterSqlite3.Database,
  contactId: string,
): void {
  db.prepare('DELETE FROM contact_profiles WHERE contact_id = ?').run(contactId);
}

/**
 * Get the interaction count for a contact.
 */
function getInteractionCount(
  db: BetterSqlite3.Database,
  contactId: string,
): number {
  const row = db.prepare(
    'SELECT value FROM contact_profiles WHERE contact_id = ? AND key = ?',
  ).get(contactId, 'interaction_count') as { value: string } | undefined;

  return row ? parseInt(row.value, 10) : 0;
}
