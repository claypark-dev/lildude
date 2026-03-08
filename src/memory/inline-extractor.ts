/**
 * Real-time inline fact extraction.
 * Runs on every user message BEFORE context is built — zero LLM cost.
 * Deterministic regex-based extraction for relationships, personal facts,
 * corrections, and temporal updates.
 *
 * Part of the Memory System Re-engineering (Sprint A, Gap 1).
 */

import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('inline-extractor');

/** A fact extracted from a single user message. */
export interface InlineFact {
  category: string;
  key: string;
  value: string;
  confidence: number;
  /** True if the message contains a correction signal (e.g. "actually", "I changed"). */
  isCorrection: boolean;
  /** Optional entity names detected in this fact. */
  entities?: Array<{ name: string; type: EntityType }>;
}

export type EntityType = 'person' | 'organization' | 'project' | 'location' | 'event';

// ── Relationship Patterns ─────────────────────────────────────────────

interface RelationshipPattern {
  pattern: RegExp;
  keyBuilder: (match: RegExpMatchArray) => string;
  valueBuilder: (match: RegExpMatchArray) => string;
  entityName: (match: RegExpMatchArray) => string;
  entityType: EntityType;
}

const RELATIONSHIP_PATTERNS: RelationshipPattern[] = [
  {
    // "Sarah is my manager", "Bob is my coworker"
    pattern: /\b(\w+(?:\s+\w+)?)\s+is\s+my\s+(manager|boss|coworker|colleague|friend|partner|wife|husband|sister|brother|mom|mother|dad|father|doctor|dentist|therapist|accountant|lawyer|assistant|mentor|teacher)\b/i,
    keyBuilder: (m) => `relationship:${m[1].toLowerCase()}`,
    valueBuilder: (m) => m[2].toLowerCase(),
    entityName: (m) => m[1],
    entityType: 'person',
  },
  {
    // "my manager is Sarah", "my dentist is Dr. Kim"
    pattern: /\bmy\s+(manager|boss|coworker|colleague|friend|partner|wife|husband|sister|brother|mom|mother|dad|father|doctor|dentist|therapist|accountant|lawyer|assistant|mentor|teacher)\s+is\s+(\w+(?:\s+\w+)?)\b/i,
    keyBuilder: (m) => `relationship:${m[2].toLowerCase()}`,
    valueBuilder: (m) => m[1].toLowerCase(),
    entityName: (m) => m[2],
    entityType: 'person',
  },
  {
    // "I work at Google", "I work for Anthropic"
    pattern: /\bI\s+work\s+(?:at|for)\s+([A-Z]\w+(?:\s+[A-Z]\w+)*)\b/,
    keyBuilder: () => 'employer',
    valueBuilder: (m) => m[1],
    entityName: (m) => m[1],
    entityType: 'organization',
  },
];

// ── Personal Fact Patterns ────────────────────────────────────────────

interface FactPattern {
  pattern: RegExp;
  key: string;
  valueExtractor: (match: RegExpMatchArray) => string;
  confidence: number;
  entityType?: EntityType;
}

const PERSONAL_FACT_PATTERNS: FactPattern[] = [
  {
    // "I live in Seattle", "I'm based in Portland"
    pattern: /\bi\s+(?:live|am based|reside)\s+in\s+([A-Z]\w+(?:\s+[A-Z]\w+)*)/i,
    key: 'lives_in',
    valueExtractor: (m) => m[1],
    confidence: 0.8,
    entityType: 'location',
  },
  {
    // "my birthday is March 15", "my birthday is on 3/15"
    pattern: /\bmy\s+birthday\s+is\s+(?:on\s+)?(\w+\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}\/\d{1,2})/i,
    key: 'user_birthday',
    valueExtractor: (m) => m[1],
    confidence: 0.9,
  },
  {
    // "my email is clay@example.com"
    pattern: /\bmy\s+email\s+(?:is|address is)\s+([\w.+-]+@[\w.-]+\.\w+)/i,
    key: 'user_email',
    valueExtractor: (m) => m[1],
    confidence: 0.9,
  },
  {
    // "my phone number is 555-1234"
    pattern: /\bmy\s+(?:phone|cell|mobile)\s+(?:number\s+)?is\s+([\d\s().+-]+)/i,
    key: 'user_phone',
    valueExtractor: (m) => m[1].trim(),
    confidence: 0.9,
  },
  {
    // "my favorite color is blue"
    pattern: /\bmy\s+favorite\s+(\w+)\s+is\s+(\w+(?:\s+\w+)?)\b/i,
    key: 'favorite',
    valueExtractor: (m) => `${m[1].toLowerCase()}: ${m[2].toLowerCase()}`,
    confidence: 0.7,
  },
];

// ── Contact Fact Patterns (associate info with a named person) ───────

interface ContactFactPattern {
  pattern: RegExp;
  keyBuilder: (match: RegExpMatchArray) => string;
  valueExtractor: (match: RegExpMatchArray) => string;
  entityName: (match: RegExpMatchArray) => string;
  confidence: number;
}

const CONTACT_FACT_PATTERNS: ContactFactPattern[] = [
  {
    // "Sarah's email is sarah@work.com"
    pattern: /\b(\w+(?:\s+\w+)?)'?s?\s+email\s+(?:is|address is)\s+([\w.+-]+@[\w.-]+\.\w+)/i,
    keyBuilder: (m) => `${m[1].toLowerCase()}_email`,
    valueExtractor: (m) => m[2],
    entityName: (m) => m[1],
    confidence: 0.85,
  },
  {
    // "Sarah's phone is 555-1234"
    pattern: /\b(\w+(?:\s+\w+)?)'?s?\s+(?:phone|cell|mobile)\s+(?:number\s+)?is\s+([\d\s().+-]+)/i,
    keyBuilder: (m) => `${m[1].toLowerCase()}_phone`,
    valueExtractor: (m) => m[2].trim(),
    entityName: (m) => m[1],
    confidence: 0.85,
  },
  {
    // "Sarah's birthday is June 5"
    pattern: /\b(\w+(?:\s+\w+)?)'?s?\s+birthday\s+is\s+(?:on\s+)?(\w+\s+\d{1,2}(?:st|nd|rd|th)?)/i,
    keyBuilder: (m) => `${m[1].toLowerCase()}_birthday`,
    valueExtractor: (m) => m[2],
    entityName: (m) => m[1],
    confidence: 0.85,
  },
];

// ── Correction Detection ──────────────────────────────────────────────

const CORRECTION_SIGNALS = /\b(?:actually|correction|no[,.]?\s+(?:it'?s|I)|I\s+(?:changed|switched|moved|updated|now))\b/i;

/** Pronouns/determiners to exclude from contact fact entity names. */
const PRONOUNS = new Set(['my', 'your', 'his', 'her', 'their', 'our', 'its', 'the', 'a', 'an']);

// ── Temporal Update Patterns ──────────────────────────────────────────

interface TemporalPattern {
  pattern: RegExp;
  keyBuilder: (match: RegExpMatchArray) => string;
  valueExtractor: (match: RegExpMatchArray) => string;
  confidence: number;
}

const TEMPORAL_PATTERNS: TemporalPattern[] = [
  {
    // "I just moved to Portland", "I recently switched to part-time"
    pattern: /\bi\s+(?:just|recently)\s+(moved to|switched to|started|changed to|updated to)\s+(.+?)(?:\.|$)/i,
    keyBuilder: (m) => {
      const action = m[1].toLowerCase();
      if (action.includes('moved')) return 'lives_in';
      if (action.includes('switched') || action.includes('changed')) return 'recent_change';
      if (action.includes('started')) return 'recent_start';
      return 'recent_update';
    },
    valueExtractor: (m) => m[2].trim(),
    confidence: 0.8,
  },
  {
    // "starting Monday I'll be working from home"
    pattern: /\bstarting\s+(\w+(?:\s+\w+)?)[,.]?\s+I(?:'ll|\s+will)\s+(?:be\s+)?(.+?)(?:\.|$)/i,
    keyBuilder: () => 'upcoming_change',
    valueExtractor: (m) => `starting ${m[1]}: ${m[2].trim()}`,
    confidence: 0.7,
  },
];

// ── Main Extraction Function ──────────────────────────────────────────

/**
 * Extract facts from a single user message.
 * Pure function — no side effects, no DB access, no LLM calls.
 *
 * @param message - The raw user message text.
 * @returns Array of extracted facts (may be empty).
 */
export function extractInlineFacts(message: string): InlineFact[] {
  if (!message || message.length < 5) return [];

  const facts: InlineFact[] = [];
  const isCorrection = CORRECTION_SIGNALS.test(message);

  // Relationship patterns
  for (const rp of RELATIONSHIP_PATTERNS) {
    const match = message.match(rp.pattern);
    if (match) {
      facts.push({
        category: 'user_fact',
        key: rp.keyBuilder(match),
        value: rp.valueBuilder(match),
        confidence: 0.8,
        isCorrection,
        entities: [{ name: rp.entityName(match), type: rp.entityType }],
      });
    }
  }

  // Personal fact patterns
  for (const fp of PERSONAL_FACT_PATTERNS) {
    const match = message.match(fp.pattern);
    if (match) {
      const entities = fp.entityType
        ? [{ name: fp.valueExtractor(match), type: fp.entityType }]
        : undefined;
      facts.push({
        category: fp.key === 'favorite' ? 'user_preference' : 'user_fact',
        key: fp.key === 'favorite' ? `favorite_${match[1].toLowerCase()}` : fp.key,
        value: fp.valueExtractor(match),
        confidence: fp.confidence,
        isCorrection,
        entities,
      });
    }
  }

  // Contact fact patterns (skip if entity is a pronoun like "my", "your", etc.)
  for (const cfp of CONTACT_FACT_PATTERNS) {
    const match = message.match(cfp.pattern);
    if (match) {
      const entityName = cfp.entityName(match);
      if (!PRONOUNS.has(entityName.toLowerCase())) {
        facts.push({
          category: 'user_fact',
          key: cfp.keyBuilder(match),
          value: cfp.valueExtractor(match),
          confidence: cfp.confidence,
          isCorrection,
          entities: [{ name: entityName, type: 'person' }],
        });
      }
    }
  }

  // Temporal update patterns
  for (const tp of TEMPORAL_PATTERNS) {
    const match = message.match(tp.pattern);
    if (match) {
      facts.push({
        category: 'user_fact',
        key: tp.keyBuilder(match),
        value: tp.valueExtractor(match),
        confidence: tp.confidence,
        isCorrection: true, // temporal updates are implicitly corrections
      });
    }
  }

  if (facts.length > 0) {
    log.debug(
      { factCount: facts.length, keys: facts.map((f) => f.key) },
      'Inline facts extracted from user message',
    );
  }

  return facts;
}
