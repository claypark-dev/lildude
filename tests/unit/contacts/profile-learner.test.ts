import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  learnFromConversation,
  upsertContactFact,
  loadContactProfile,
  getContactFact,
  buildContactKnowledgeSection,
  clearContactProfile,
} from '../../../src/contacts/profile-learner.js';
import { createContact } from '../../../src/persistence/contacts.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = ['001_initial.sql', '009_contacts.sql', '010_contact_profiles.sql'];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('contact profile learner', () => {
  let db: Database.Database;
  let contactId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const contact = createContact(db, { name: 'Alice', trustLevel: 'known' });
    contactId = contact.id;
  });

  afterEach(() => {
    db.close();
  });

  describe('learnFromConversation', () => {
    it('extracts preferred name', () => {
      learnFromConversation(db, contactId, ['Hi, my name is Bob']);

      const profile = loadContactProfile(db, contactId);
      const nameFact = profile.find((p) => p.key === 'preferred_name');
      expect(nameFact).toBeDefined();
      expect(nameFact!.value).toBe('Bob');
    });

    it('extracts location', () => {
      learnFromConversation(db, contactId, ["I'm in San Francisco"]);

      const fact = getContactFact(db, contactId, 'location');
      expect(fact).toBe('San Francisco');
    });

    it('extracts communication style', () => {
      learnFromConversation(db, contactId, ['I prefer casual responses']);

      const fact = getContactFact(db, contactId, 'communication_style');
      expect(fact).toBe('casual');
    });

    it('tracks common topics', () => {
      learnFromConversation(db, contactId, [
        'Can you check my calendar for the meeting?',
        'Schedule a meeting with Bob for tomorrow',
        'What meetings do I have this week?',
      ]);

      const profile = loadContactProfile(db, contactId);
      const topicFact = profile.find((p) => p.key === 'topic:scheduling');
      expect(topicFact).toBeDefined();
    });

    it('detects brief message style', () => {
      learnFromConversation(db, contactId, [
        'Hi',
        'Check email',
        'Thanks',
      ]);

      const fact = getContactFact(db, contactId, 'message_style');
      expect(fact).toBe('brief');
    });

    it('increments interaction count', () => {
      learnFromConversation(db, contactId, ['Hello']);
      learnFromConversation(db, contactId, ['How are you?']);

      const count = getContactFact(db, contactId, 'interaction_count');
      expect(count).toBe('2');
    });

    it('handles empty messages without error', () => {
      expect(() => learnFromConversation(db, contactId, [])).not.toThrow();
    });
  });

  describe('upsertContactFact', () => {
    it('creates a new fact', () => {
      upsertContactFact(db, contactId, 'test_key', 'test_value', 'inferred', 0.7);

      const value = getContactFact(db, contactId, 'test_key');
      expect(value).toBe('test_value');
    });

    it('updates when higher confidence source provides same key', () => {
      upsertContactFact(db, contactId, 'name', 'Bob', 'inferred', 0.5);
      upsertContactFact(db, contactId, 'name', 'Robert', 'explicit', 0.8);

      const value = getContactFact(db, contactId, 'name');
      expect(value).toBe('Robert');
    });

    it('boosts confidence when same value is seen again', () => {
      upsertContactFact(db, contactId, 'city', 'Seattle', 'inferred', 0.5);
      upsertContactFact(db, contactId, 'city', 'Seattle', 'inferred', 0.5);

      const profile = loadContactProfile(db, contactId);
      const fact = profile.find((p) => p.key === 'city');
      expect(fact!.confidence).toBeGreaterThan(0.5);
    });

    it('does not downgrade from explicit to inferred', () => {
      upsertContactFact(db, contactId, 'name', 'Bob', 'explicit', 0.9);
      upsertContactFact(db, contactId, 'name', 'Robert', 'inferred', 0.5);

      const value = getContactFact(db, contactId, 'name');
      expect(value).toBe('Bob');
    });
  });

  describe('loadContactProfile', () => {
    it('returns all facts sorted by confidence', () => {
      upsertContactFact(db, contactId, 'low', 'value', 'inferred', 0.3);
      upsertContactFact(db, contactId, 'high', 'value', 'explicit', 0.9);
      upsertContactFact(db, contactId, 'mid', 'value', 'inferred', 0.6);

      const profile = loadContactProfile(db, contactId);
      expect(profile).toHaveLength(3);
      expect(profile[0].key).toBe('high');
      expect(profile[1].key).toBe('mid');
      expect(profile[2].key).toBe('low');
    });

    it('returns empty array for unknown contact', () => {
      const profile = loadContactProfile(db, 'nonexistent');
      expect(profile).toEqual([]);
    });
  });

  describe('getContactFact', () => {
    it('returns the fact value', () => {
      upsertContactFact(db, contactId, 'color', 'blue', 'explicit', 0.8);

      expect(getContactFact(db, contactId, 'color')).toBe('blue');
    });

    it('returns null for unknown key', () => {
      expect(getContactFact(db, contactId, 'nonexistent')).toBeNull();
    });

    it('increments access count on retrieval', () => {
      upsertContactFact(db, contactId, 'color', 'blue', 'explicit', 0.8);

      getContactFact(db, contactId, 'color');
      getContactFact(db, contactId, 'color');

      const profile = loadContactProfile(db, contactId);
      const fact = profile.find((p) => p.key === 'color');
      expect(fact!.accessCount).toBe(2);
    });
  });

  describe('buildContactKnowledgeSection', () => {
    it('builds formatted knowledge section', () => {
      upsertContactFact(db, contactId, 'location', 'Seattle', 'inferred', 0.7);
      upsertContactFact(db, contactId, 'style', 'casual', 'explicit', 0.8);

      const section = buildContactKnowledgeSection(db, contactId);
      expect(section).toContain('## What I Know About This Contact');
      expect(section).toContain('location: Seattle');
      expect(section).toContain('style: casual');
    });

    it('returns empty string when no facts', () => {
      expect(buildContactKnowledgeSection(db, contactId)).toBe('');
    });

    it('excludes system-level facts', () => {
      upsertContactFact(db, contactId, 'interaction_count', '5', 'system', 1.0);
      upsertContactFact(db, contactId, 'name', 'Alice', 'explicit', 0.8);

      const section = buildContactKnowledgeSection(db, contactId);
      expect(section).not.toContain('interaction_count');
      expect(section).toContain('name: Alice');
    });

    it('excludes low-confidence facts', () => {
      upsertContactFact(db, contactId, 'maybe', 'uncertain', 'inferred', 0.2);

      const section = buildContactKnowledgeSection(db, contactId);
      expect(section).toBe('');
    });
  });

  describe('clearContactProfile', () => {
    it('removes all facts for a contact', () => {
      upsertContactFact(db, contactId, 'a', '1', 'inferred', 0.5);
      upsertContactFact(db, contactId, 'b', '2', 'inferred', 0.5);

      clearContactProfile(db, contactId);

      const profile = loadContactProfile(db, contactId);
      expect(profile).toHaveLength(0);
    });
  });
});
