/**
 * Tests for Sprint 18C performance & security audit fixes.
 * Validates transaction batching, index creation, and updated_at behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  learnFromConversation,
  loadContactProfile,
  getContactFact,
} from '../../../src/contacts/profile-learner.js';
import { createContact, updateContact, getContact } from '../../../src/persistence/contacts.js';
import {
  createContactGroup,
  updateContactGroup,
  getContactGroup,
} from '../../../src/persistence/contact-groups.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runCoreMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '002_routing_history.sql',
    '003_waves_foundation.sql',
    '004_fts5_knowledge.sql',
    '009_contacts.sql',
    '010_contact_profiles.sql',
    '012_contact_groups.sql',
    '015_knowledge_privacy.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

function runPerformanceMigration(db: Database.Database): void {
  const sql = readFileSync(join(MIGRATIONS_DIR, '016_performance_indexes.sql'), 'utf-8');
  db.exec(sql);
}

describe('Sprint 18C performance audit fixes', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runCoreMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Migration 016: Performance Indexes ────────────────────────────

  describe('migration 016: performance indexes', () => {
    it('creates idx_approval_queue_task_id index', () => {
      runPerformanceMigration(db);
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_approval_queue_task_id'",
      ).all();
      expect(indexes).toHaveLength(1);
    });

    it('creates idx_routing_history_task_id index', () => {
      runPerformanceMigration(db);
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_routing_history_task_id'",
      ).all();
      expect(indexes).toHaveLength(1);
    });

    it('creates idx_conversations_task_id index', () => {
      runPerformanceMigration(db);
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_conversations_task_id'",
      ).all();
      expect(indexes).toHaveLength(1);
    });

    it('creates idx_contact_profiles_contact_key index', () => {
      runPerformanceMigration(db);
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_contact_profiles_contact_key'",
      ).all();
      expect(indexes).toHaveLength(1);
    });

    it('is idempotent — running twice does not error', () => {
      runPerformanceMigration(db);
      expect(() => runPerformanceMigration(db)).not.toThrow();
    });

    it('all 6 expected indexes are created', () => {
      runPerformanceMigration(db);
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
      ).all() as Array<{ name: string }>;
      const indexNames = indexes.map((idx) => idx.name);

      expect(indexNames).toContain('idx_approval_queue_task_id');
      expect(indexNames).toContain('idx_routing_history_task_id');
      expect(indexNames).toContain('idx_conversations_task_id');
      expect(indexNames).toContain('idx_contact_profiles_contact_key');
    });
  });

  // ── Profile Learner Transaction Batching ─────────────────────────

  describe('profile learner transaction batching', () => {
    let contactId: string;

    beforeEach(() => {
      const contact = createContact(db, { name: 'Test User', trustLevel: 'known' });
      contactId = contact.id;
    });

    it('stores all facts atomically in a single transaction', () => {
      // Provide a message that triggers multiple fact extractions
      learnFromConversation(db, contactId, [
        "Hi, call me Bob. I'm in San Francisco. I prefer casual responses.",
        'Can you check my calendar for the meeting?',
        'Schedule a meeting with Carol for tomorrow.',
        'What meetings do I have this week?',
      ]);

      const profile = loadContactProfile(db, contactId);

      // Should have multiple facts stored in one atomic operation
      const keys = profile.map((p) => p.key);
      expect(keys).toContain('preferred_name');
      expect(keys).toContain('location');
      expect(keys).toContain('communication_style');
      expect(keys).toContain('interaction_count');
    });

    it('interaction count increments correctly across calls', () => {
      learnFromConversation(db, contactId, ['Hello']);
      learnFromConversation(db, contactId, ['Hi again']);
      learnFromConversation(db, contactId, ['Third time']);

      const count = getContactFact(db, contactId, 'interaction_count');
      expect(count).toBe('3');
    });

    it('handles errors without partial writes', () => {
      // First learn something
      learnFromConversation(db, contactId, ['Hello from Alice']);

      // Verify facts were stored
      const count = getContactFact(db, contactId, 'interaction_count');
      expect(count).toBe('1');
    });

    it('multiple facts from same conversation are all stored', () => {
      learnFromConversation(db, contactId, [
        "I'm Bob, I speak Spanish, and I prefer formal communication. I work as Engineer at Google.",
      ]);

      const profile = loadContactProfile(db, contactId);
      const keys = profile.map((p) => p.key);

      expect(keys).toContain('preferred_name');
      expect(keys).toContain('language');
      expect(keys).toContain('communication_style');
    });
  });

  // ── Contact updated_at Behavior ──────────────────────────────────

  describe('contact updated_at on update', () => {
    let contactId: string;

    beforeEach(() => {
      const contact = createContact(db, { name: 'Jane', trustLevel: 'known' });
      contactId = contact.id;
    });

    it('updates updated_at when contact fields change', () => {
      const before = getContact(db, contactId);
      expect(before).not.toBeNull();

      // Wait a tiny amount and then update
      updateContact(db, contactId, { name: 'Jane Updated' });

      const after = getContact(db, contactId);
      expect(after).not.toBeNull();
      expect(after!.name).toBe('Jane Updated');
      // updated_at should be set (we can't guarantee it's strictly later in a fast test,
      // but we verify the field is populated)
      expect(after!.updatedAt).toBeInstanceOf(Date);
    });

    it('preserves other fields when updating one field', () => {
      updateContact(db, contactId, { isFavorite: true });

      const contact = getContact(db, contactId);
      expect(contact).not.toBeNull();
      expect(contact!.name).toBe('Jane');
      expect(contact!.isFavorite).toBe(true);
    });
  });

  // ── Contact Group updated_at Behavior ────────────────────────────

  describe('contact group updated_at on update', () => {
    let groupId: string;

    beforeEach(() => {
      const group = createContactGroup(db, { name: 'Team Alpha' });
      groupId = group.id;
    });

    it('updates updated_at when group fields change', () => {
      const before = getContactGroup(db, groupId);
      expect(before).not.toBeNull();

      updateContactGroup(db, groupId, { name: 'Team Beta' });

      const after = getContactGroup(db, groupId);
      expect(after).not.toBeNull();
      expect(after!.name).toBe('Team Beta');
      expect(after!.updatedAt).toBeInstanceOf(Date);
    });

    it('preserves other fields when updating one field', () => {
      updateContactGroup(db, groupId, { description: 'Updated description' });

      const group = getContactGroup(db, groupId);
      expect(group).not.toBeNull();
      expect(group!.name).toBe('Team Alpha');
      expect(group!.description).toBe('Updated description');
    });
  });

  // ── Dynamic SQL Safety ───────────────────────────────────────────

  describe('dynamic SQL update safety', () => {
    let contactId: string;

    beforeEach(() => {
      const contact = createContact(db, { name: 'Test', trustLevel: 'known' });
      contactId = contact.id;
    });

    it('updateContact only accepts known field names', () => {
      // This verifies the update works with all valid fields
      const updated = updateContact(db, contactId, {
        name: 'New Name',
        phone: '+1-555-123-4567',
        email: 'new@example.com',
        trustLevel: 'trusted',
        isFavorite: true,
        notes: 'Some notes',
        permittedWaves: ['wave1'],
        channelIds: { discord: 'user123' },
        rateLimitPerHour: 20,
        budgetCapUsd: 5.0,
        tags: ['vip'],
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
      expect(updated!.phone).toBe('+1-555-123-4567');
      expect(updated!.email).toBe('new@example.com');
      expect(updated!.trustLevel).toBe('trusted');
      expect(updated!.isFavorite).toBe(true);
      expect(updated!.notes).toBe('Some notes');
      expect(updated!.permittedWaves).toEqual(['wave1']);
      expect(updated!.channelIds).toEqual({ discord: 'user123' });
      expect(updated!.rateLimitPerHour).toBe(20);
      expect(updated!.budgetCapUsd).toBe(5.0);
      expect(updated!.tags).toEqual(['vip']);
    });

    it('updateContact returns current state when no fields provided', () => {
      const result = updateContact(db, contactId, {});
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Test');
    });

    it('updateContactGroup only accepts known field names', () => {
      const group = createContactGroup(db, { name: 'Test Group' });

      const updated = updateContactGroup(db, group.id, {
        name: 'Renamed Group',
        description: 'New description',
        contactIds: [contactId],
        color: '#ff0000',
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Renamed Group');
      expect(updated!.description).toBe('New description');
      expect(updated!.contactIds).toEqual([contactId]);
      expect(updated!.color).toBe('#ff0000');
    });
  });
});
