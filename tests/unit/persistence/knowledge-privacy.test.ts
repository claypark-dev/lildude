/**
 * Tests for the knowledge privacy data access layer.
 * Validates visibility filtering, search isolation, and audit logging
 * to ensure party waves cannot access owner-private knowledge.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setKnowledgeVisibility,
  searchKnowledgeByVisibility,
  listKnowledgeByVisibility,
  countKnowledgeByVisibility,
  logKnowledgeAccess,
  getKnowledgeAccessLogs,
} from '../../../src/persistence/knowledge-privacy.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '003_waves_foundation.sql',
    '004_fts5_knowledge.sql',
    '015_knowledge_privacy.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

/**
 * Insert a knowledge entry directly into the DB for test setup.
 * Returns the inserted row ID.
 */
function insertKnowledge(
  db: Database.Database,
  category: string,
  key: string,
  value: string,
  visibility: 'owner' | 'shared' = 'owner',
): number {
  const result = db.prepare(
    `INSERT INTO knowledge (category, key, value, visibility)
     VALUES (?, ?, ?, ?)`,
  ).run(category, key, value, visibility);
  return result.lastInsertRowid as number;
}

/**
 * Insert a knowledge embedding for a given knowledge entry.
 */
function insertEmbedding(
  db: Database.Database,
  knowledgeId: number,
  visibility: 'owner' | 'shared' = 'owner',
): void {
  db.prepare(
    `INSERT INTO knowledge_embeddings (knowledge_id, embedding, model, dimensions, visibility)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(knowledgeId, Buffer.from([1, 2, 3]), 'test-model', 3, visibility);
}

describe('knowledge-privacy DAL', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── setKnowledgeVisibility ────────────────────────────────────────────

  describe('setKnowledgeVisibility', () => {
    it('sets visibility from owner to shared', () => {
      const id = insertKnowledge(db, 'personal', 'email', 'test@example.com', 'owner');

      const updated = setKnowledgeVisibility(db, id, 'shared');

      expect(updated).toBe(true);
      const row = db.prepare('SELECT visibility FROM knowledge WHERE id = ?').get(id) as { visibility: string };
      expect(row.visibility).toBe('shared');
    });

    it('sets visibility from shared to owner', () => {
      const id = insertKnowledge(db, 'faq', 'hours', '9-5', 'shared');

      const updated = setKnowledgeVisibility(db, id, 'owner');

      expect(updated).toBe(true);
      const row = db.prepare('SELECT visibility FROM knowledge WHERE id = ?').get(id) as { visibility: string };
      expect(row.visibility).toBe('owner');
    });

    it('returns false for non-existent knowledge ID', () => {
      const updated = setKnowledgeVisibility(db, 99999, 'shared');

      expect(updated).toBe(false);
    });

    it('also updates the corresponding knowledge_embeddings visibility', () => {
      const id = insertKnowledge(db, 'facts', 'city', 'Portland', 'owner');
      insertEmbedding(db, id, 'owner');

      setKnowledgeVisibility(db, id, 'shared');

      const embRow = db.prepare(
        'SELECT visibility FROM knowledge_embeddings WHERE knowledge_id = ?',
      ).get(id) as { visibility: string };
      expect(embRow.visibility).toBe('shared');
    });

    it('does not update embeddings when knowledge ID does not exist', () => {
      const realId = insertKnowledge(db, 'facts', 'city', 'Portland', 'owner');
      insertEmbedding(db, realId, 'owner');

      setKnowledgeVisibility(db, 99999, 'shared');

      const embRow = db.prepare(
        'SELECT visibility FROM knowledge_embeddings WHERE knowledge_id = ?',
      ).get(realId) as { visibility: string };
      expect(embRow.visibility).toBe('owner');
    });
  });

  // ─── searchKnowledgeByVisibility ───────────────────────────────────────

  describe('searchKnowledgeByVisibility', () => {
    it('returns only shared entries when searching with visibility=shared', () => {
      insertKnowledge(db, 'faq', 'hours', 'Mon-Fri 9-5', 'shared');
      insertKnowledge(db, 'personal', 'schedule', 'Owner meetings Mon-Fri', 'owner');

      const results = searchKnowledgeByVisibility(db, 'Mon', 'shared');

      expect(results).toHaveLength(1);
      expect(results[0].visibility).toBe('shared');
      expect(results[0].key).toBe('hours');
    });

    it('returns only owner entries when searching with visibility=owner', () => {
      insertKnowledge(db, 'faq', 'hours', 'Mon-Fri 9-5', 'shared');
      insertKnowledge(db, 'personal', 'schedule', 'Owner meetings Mon-Fri', 'owner');

      const results = searchKnowledgeByVisibility(db, 'Mon', 'owner');

      expect(results).toHaveLength(1);
      expect(results[0].visibility).toBe('owner');
      expect(results[0].key).toBe('schedule');
    });

    it('searches case-insensitively in key and value', () => {
      insertKnowledge(db, 'faq', 'Office Hours', 'nine to five', 'shared');

      const byKey = searchKnowledgeByVisibility(db, 'office', 'shared');
      expect(byKey).toHaveLength(1);

      const byValue = searchKnowledgeByVisibility(db, 'NINE', 'shared');
      expect(byValue).toHaveLength(1);
    });

    it('filters by category when provided', () => {
      insertKnowledge(db, 'faq', 'hours', 'Mon-Fri', 'shared');
      insertKnowledge(db, 'support', 'hours', 'Weekdays only', 'shared');

      const results = searchKnowledgeByVisibility(db, 'hours', 'shared', 'faq');

      expect(results).toHaveLength(1);
      expect(results[0].category).toBe('faq');
    });

    it('returns empty array when no entries match visibility', () => {
      insertKnowledge(db, 'personal', 'ssn', '123-45-6789', 'owner');

      const results = searchKnowledgeByVisibility(db, 'ssn', 'shared');

      expect(results).toHaveLength(0);
    });

    it('returns all matching shared entries ordered by created_at desc', () => {
      insertKnowledge(db, 'faq', 'q1', 'answer about support', 'shared');
      // Force a different created_at by inserting with explicit timestamp
      db.prepare(
        `INSERT INTO knowledge (category, key, value, visibility, created_at)
         VALUES (?, ?, ?, ?, datetime('now', '+1 second'))`,
      ).run('faq', 'q2', 'answer about support tickets', 'shared');

      const results = searchKnowledgeByVisibility(db, 'support', 'shared');

      expect(results).toHaveLength(2);
      // Most recent first (q2 has later created_at)
      expect(results[0].key).toBe('q2');
      expect(results[1].key).toBe('q1');
    });

    it('maps returned rows to correct TypeScript interface', () => {
      insertKnowledge(db, 'faq', 'greeting', 'Hello world', 'shared');

      const results = searchKnowledgeByVisibility(db, 'Hello', 'shared');

      expect(results).toHaveLength(1);
      const row = results[0];
      expect(typeof row.id).toBe('number');
      expect(row.category).toBe('faq');
      expect(row.key).toBe('greeting');
      expect(row.value).toBe('Hello world');
      expect(row.visibility).toBe('shared');
      expect(typeof row.confidence).toBe('number');
      expect(row.createdAt).toBeInstanceOf(Date);
    });
  });

  // ─── listKnowledgeByVisibility ─────────────────────────────────────────

  describe('listKnowledgeByVisibility', () => {
    it('lists all shared entries', () => {
      insertKnowledge(db, 'faq', 'q1', 'a1', 'shared');
      insertKnowledge(db, 'faq', 'q2', 'a2', 'shared');
      insertKnowledge(db, 'personal', 'secret', 'hidden', 'owner');

      const sharedEntries = listKnowledgeByVisibility(db, 'shared');

      expect(sharedEntries).toHaveLength(2);
      expect(sharedEntries.every((e) => e.visibility === 'shared')).toBe(true);
    });

    it('lists all owner entries', () => {
      insertKnowledge(db, 'personal', 's1', 'v1', 'owner');
      insertKnowledge(db, 'personal', 's2', 'v2', 'owner');
      insertKnowledge(db, 'faq', 'pub', 'val', 'shared');

      const ownerEntries = listKnowledgeByVisibility(db, 'owner');

      expect(ownerEntries).toHaveLength(2);
      expect(ownerEntries.every((e) => e.visibility === 'owner')).toBe(true);
    });

    it('returns empty array when no entries have the given visibility', () => {
      insertKnowledge(db, 'faq', 'q1', 'a1', 'shared');

      const ownerEntries = listKnowledgeByVisibility(db, 'owner');

      expect(ownerEntries).toHaveLength(0);
    });
  });

  // ─── countKnowledgeByVisibility ────────────────────────────────────────

  describe('countKnowledgeByVisibility', () => {
    it('counts shared entries correctly', () => {
      insertKnowledge(db, 'faq', 'q1', 'a1', 'shared');
      insertKnowledge(db, 'faq', 'q2', 'a2', 'shared');
      insertKnowledge(db, 'personal', 'secret', 'hidden', 'owner');

      expect(countKnowledgeByVisibility(db, 'shared')).toBe(2);
    });

    it('counts owner entries correctly', () => {
      insertKnowledge(db, 'personal', 's1', 'v1', 'owner');
      insertKnowledge(db, 'faq', 'pub', 'val', 'shared');

      expect(countKnowledgeByVisibility(db, 'owner')).toBe(1);
    });

    it('returns 0 when no entries exist', () => {
      expect(countKnowledgeByVisibility(db, 'shared')).toBe(0);
      expect(countKnowledgeByVisibility(db, 'owner')).toBe(0);
    });
  });

  // ─── logKnowledgeAccess ────────────────────────────────────────────────

  describe('logKnowledgeAccess', () => {
    it('logs a successful search access', () => {
      logKnowledgeAccess(db, 1, 'faq-responder', 'contact-123', 'search', true);

      const logs = getKnowledgeAccessLogs(db, 10);
      expect(logs).toHaveLength(1);
      expect(logs[0].knowledgeId).toBe(1);
      expect(logs[0].waveName).toBe('faq-responder');
      expect(logs[0].contactId).toBe('contact-123');
      expect(logs[0].accessType).toBe('search');
      expect(logs[0].wasAllowed).toBe(true);
    });

    it('logs a blocked access with wasAllowed=false', () => {
      logKnowledgeAccess(db, 5, 'malicious-wave', 'attacker-1', 'blocked', false);

      const logs = getKnowledgeAccessLogs(db, 10);
      expect(logs).toHaveLength(1);
      expect(logs[0].wasAllowed).toBe(false);
      expect(logs[0].accessType).toBe('blocked');
    });

    it('allows null knowledgeId for searches that returned no results', () => {
      logKnowledgeAccess(db, null, 'faq-responder', 'contact-1', 'search', true);

      const logs = getKnowledgeAccessLogs(db, 10);
      expect(logs).toHaveLength(1);
      expect(logs[0].knowledgeId).toBeNull();
    });
  });

  // ─── getKnowledgeAccessLogs ────────────────────────────────────────────

  describe('getKnowledgeAccessLogs', () => {
    it('returns logs ordered by created_at descending', () => {
      logKnowledgeAccess(db, 1, 'wave-a', 'c1', 'search', true);
      logKnowledgeAccess(db, 2, 'wave-b', 'c2', 'read', true);
      logKnowledgeAccess(db, 3, 'wave-c', 'c3', 'blocked', false);

      const logs = getKnowledgeAccessLogs(db, 10);

      expect(logs).toHaveLength(3);
      // Most recent first
      expect(logs[0].waveName).toBe('wave-c');
      expect(logs[1].waveName).toBe('wave-b');
      expect(logs[2].waveName).toBe('wave-a');
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        logKnowledgeAccess(db, i, `wave-${i}`, `c-${i}`, 'search', true);
      }

      const logs = getKnowledgeAccessLogs(db, 3);

      expect(logs).toHaveLength(3);
    });

    it('returns empty array when no logs exist', () => {
      const logs = getKnowledgeAccessLogs(db, 10);

      expect(logs).toHaveLength(0);
    });

    it('maps all fields correctly including boolean wasAllowed', () => {
      logKnowledgeAccess(db, 42, 'test-wave', 'contact-abc', 'read', true);

      const logs = getKnowledgeAccessLogs(db);
      expect(logs).toHaveLength(1);

      const log = logs[0];
      expect(typeof log.id).toBe('number');
      expect(log.knowledgeId).toBe(42);
      expect(log.waveName).toBe('test-wave');
      expect(log.contactId).toBe('contact-abc');
      expect(log.accessType).toBe('read');
      expect(log.wasAllowed).toBe(true);
      expect(typeof log.createdAt).toBe('string');
    });
  });
});
