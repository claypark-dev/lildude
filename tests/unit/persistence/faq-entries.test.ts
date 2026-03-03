import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createFaqEntry,
  getFaqEntry,
  listFaqEntries,
  updateFaqEntry,
  deleteFaqEntry,
  searchFaqEntries,
  incrementFaqAccessCount,
} from '../../../src/persistence/faq-entries.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '003_waves_foundation.sql',
    '009_contacts.sql',
    '010_contact_profiles.sql',
    '011_external_waves.sql',
    '013_party_waves.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('faq entries', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createFaqEntry', () => {
    it('creates a FAQ entry with defaults', () => {
      const entry = createFaqEntry(db, {
        question: 'What are your business hours?',
        answer: 'Monday to Friday, 9am to 5pm.',
      });

      expect(entry.id).toMatch(/^faq_/);
      expect(entry.question).toBe('What are your business hours?');
      expect(entry.answer).toBe('Monday to Friday, 9am to 5pm.');
      expect(entry.category).toBe('general');
      expect(entry.enabled).toBe(true);
      expect(entry.accessCount).toBe(0);
      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.updatedAt).toBeInstanceOf(Date);
    });

    it('creates a FAQ entry with a custom category', () => {
      const entry = createFaqEntry(db, {
        question: 'How do I reset my password?',
        answer: 'Click the forgot password link on the login page.',
        category: 'support',
      });

      expect(entry.category).toBe('support');
    });
  });

  describe('getFaqEntry', () => {
    it('retrieves a FAQ entry by ID', () => {
      const created = createFaqEntry(db, {
        question: 'Do you offer refunds?',
        answer: 'Yes, within 30 days.',
      });
      const fetched = getFaqEntry(db, created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.question).toBe('Do you offer refunds?');
    });

    it('returns null for unknown ID', () => {
      expect(getFaqEntry(db, 'faq_nonexistent')).toBeNull();
    });
  });

  describe('listFaqEntries', () => {
    it('returns all enabled entries by default', () => {
      createFaqEntry(db, { question: 'Q1', answer: 'A1' });
      createFaqEntry(db, { question: 'Q2', answer: 'A2' });

      const entries = listFaqEntries(db);
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.enabled)).toBe(true);
    });

    it('filters by category', () => {
      createFaqEntry(db, { question: 'General Q', answer: 'A', category: 'general' });
      createFaqEntry(db, { question: 'Support Q', answer: 'A', category: 'support' });
      createFaqEntry(db, { question: 'Support Q2', answer: 'A2', category: 'support' });

      const supportEntries = listFaqEntries(db, 'support');
      expect(supportEntries).toHaveLength(2);
      expect(supportEntries.every((e) => e.category === 'support')).toBe(true);
    });

    it('returns disabled entries when enabledOnly is false', () => {
      const entry = createFaqEntry(db, { question: 'Hidden Q', answer: 'A' });
      updateFaqEntry(db, entry.id, { enabled: false });

      const enabledOnly = listFaqEntries(db, undefined, true);
      expect(enabledOnly).toHaveLength(0);

      const all = listFaqEntries(db, undefined, false);
      expect(all).toHaveLength(1);
      expect(all[0].enabled).toBe(false);
    });
  });

  describe('updateFaqEntry', () => {
    it('updates the question of a FAQ entry', () => {
      const entry = createFaqEntry(db, { question: 'Old question?', answer: 'Old answer.' });
      const updated = updateFaqEntry(db, entry.id, { question: 'New question?' });

      expect(updated).not.toBeNull();
      expect(updated!.question).toBe('New question?');
      expect(updated!.answer).toBe('Old answer.');
    });

    it('updates the enabled flag of a FAQ entry', () => {
      const entry = createFaqEntry(db, { question: 'Active Q?', answer: 'A.' });
      expect(entry.enabled).toBe(true);

      const updated = updateFaqEntry(db, entry.id, { enabled: false });
      expect(updated!.enabled).toBe(false);
    });
  });

  describe('deleteFaqEntry', () => {
    it('removes the FAQ entry from the database', () => {
      const entry = createFaqEntry(db, { question: 'Temporary Q?', answer: 'A.' });
      deleteFaqEntry(db, entry.id);

      expect(getFaqEntry(db, entry.id)).toBeNull();
    });
  });

  describe('searchFaqEntries', () => {
    beforeEach(() => {
      createFaqEntry(db, {
        question: 'How do I contact support?',
        answer: 'Email us at support@example.com.',
        category: 'support',
      });
      createFaqEntry(db, {
        question: 'What payment methods do you accept?',
        answer: 'We accept credit cards and PayPal.',
        category: 'billing',
      });
      createFaqEntry(db, {
        question: 'Where are you located?',
        answer: 'We are fully remote.',
        category: 'general',
      });
    });

    it('finds entries by question keyword', () => {
      const results = searchFaqEntries(db, 'payment');

      expect(results).toHaveLength(1);
      expect(results[0].question).toContain('payment');
    });

    it('finds entries by answer keyword', () => {
      const results = searchFaqEntries(db, 'PayPal');

      expect(results).toHaveLength(1);
      expect(results[0].answer).toContain('PayPal');
    });

    it('returns empty array for no match', () => {
      const results = searchFaqEntries(db, 'xyzzy_no_match_here');
      expect(results).toEqual([]);
    });
  });

  describe('incrementFaqAccessCount', () => {
    it('increments the access count for a FAQ entry', () => {
      const entry = createFaqEntry(db, { question: 'Frequently asked?', answer: 'Yes.' });
      expect(entry.accessCount).toBe(0);

      incrementFaqAccessCount(db, entry.id);
      incrementFaqAccessCount(db, entry.id);

      const updated = getFaqEntry(db, entry.id);
      expect(updated!.accessCount).toBe(2);
    });
  });
});
