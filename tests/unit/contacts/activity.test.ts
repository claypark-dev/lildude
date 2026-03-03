import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getContactActivity, getExternalActivitySummary, getContactActivities } from '../../../src/contacts/activity.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  db.pragma('foreign_keys = OFF');
  const files = [
    '001_initial.sql',
    '009_contacts.sql',
    '010_contact_profiles.sql',
    '011_external_waves.sql',
    '012_contact_groups.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

function insertContact(db: Database.Database, id: string, name: string, trustLevel = 'known'): void {
  db.prepare(
    `INSERT INTO contacts (id, name, trust_level, is_favorite, permitted_waves, channel_ids, rate_limit_per_hour, budget_cap_usd, tags)
     VALUES (?, ?, ?, 0, '[]', '{}', 10, 0, '[]')`,
  ).run(id, name, trustLevel);
}

function insertConversation(db: Database.Database, id: string, contactId: string): void {
  db.prepare(
    `INSERT INTO conversations (id, channel_type, channel_id, message_count, contact_id)
     VALUES (?, 'test', 'test', 1, ?)`,
  ).run(id, contactId);
}

function insertAuditEvent(db: Database.Database, contactId: string, eventType: string, detail?: string): void {
  db.prepare(
    `INSERT INTO external_audit (contact_id, event_type, detail)
     VALUES (?, ?, ?)`,
  ).run(contactId, eventType, detail ?? null);
}

function insertRelayedMessage(db: Database.Database, id: string, contactId: string, status = 'unread'): void {
  db.prepare(
    `INSERT INTO relayed_messages (id, contact_id, message, urgency, status, channel_type, channel_id)
     VALUES (?, ?, 'test msg', 'normal', ?, 'test', 'test')`,
  ).run(id, contactId, status);
}

function insertMeetingRequest(db: Database.Database, id: string, contactId: string, status = 'pending'): void {
  db.prepare(
    `INSERT INTO meeting_requests (id, contact_id, proposed_time, duration_minutes, subject, status)
     VALUES (?, ?, datetime('now'), 30, 'Test Meeting', ?)`,
  ).run(id, contactId, status);
}

describe('contact activity', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getContactActivity', () => {
    it('returns zeroed metrics for contact with no activity', () => {
      insertContact(db, 'c1', 'Alice');
      const activity = getContactActivity(db, 'c1');
      expect(activity.contactId).toBe('c1');
      expect(activity.messageCount).toBe(0);
      expect(activity.lastMessageAt).toBeNull();
      expect(activity.totalSpendUsd).toBe(0);
      expect(activity.wavesTriggered).toBe(0);
      expect(activity.wavesBlocked).toBe(0);
      expect(activity.meetingRequests).toBe(0);
      expect(activity.relayedMessages).toBe(0);
      expect(activity.rateLimitEvents).toBe(0);
    });

    it('counts conversations linked to the contact', () => {
      insertContact(db, 'c1', 'Alice');
      insertConversation(db, 'conv1', 'c1');
      insertConversation(db, 'conv2', 'c1');
      insertConversation(db, 'conv3', 'c2'); // Different contact

      const activity = getContactActivity(db, 'c1');
      expect(activity.messageCount).toBe(2);
    });

    it('tracks last message date', () => {
      insertContact(db, 'c1', 'Alice');
      insertConversation(db, 'conv1', 'c1');

      const activity = getContactActivity(db, 'c1');
      expect(activity.lastMessageAt).toBeInstanceOf(Date);
    });

    it('counts waves triggered from audit log', () => {
      insertContact(db, 'c1', 'Alice');
      insertAuditEvent(db, 'c1', 'wave_triggered', 'weather-checker');
      insertAuditEvent(db, 'c1', 'wave_triggered', 'todo-manager');
      insertAuditEvent(db, 'c1', 'wave_blocked', 'dangerous-wave');

      const activity = getContactActivity(db, 'c1');
      expect(activity.wavesTriggered).toBe(2);
      expect(activity.wavesBlocked).toBe(1);
    });

    it('counts meeting requests', () => {
      insertContact(db, 'c1', 'Alice');
      insertMeetingRequest(db, 'mtg1', 'c1');
      insertMeetingRequest(db, 'mtg2', 'c1', 'approved');

      const activity = getContactActivity(db, 'c1');
      expect(activity.meetingRequests).toBe(2);
    });

    it('counts relayed messages', () => {
      insertContact(db, 'c1', 'Alice');
      insertRelayedMessage(db, 'msg1', 'c1');
      insertRelayedMessage(db, 'msg2', 'c1', 'read');

      const activity = getContactActivity(db, 'c1');
      expect(activity.relayedMessages).toBe(2);
    });

    it('counts rate limit events', () => {
      insertContact(db, 'c1', 'Alice');
      insertAuditEvent(db, 'c1', 'rate_limited');
      insertAuditEvent(db, 'c1', 'rate_limited');

      const activity = getContactActivity(db, 'c1');
      expect(activity.rateLimitEvents).toBe(2);
    });

    it('returns defaults for non-existent contact', () => {
      const activity = getContactActivity(db, 'nonexistent');
      expect(activity.messageCount).toBe(0);
      expect(activity.totalSpendUsd).toBe(0);
    });
  });

  describe('getExternalActivitySummary', () => {
    it('returns zeroed summary when empty', () => {
      const summary = getExternalActivitySummary(db);
      expect(summary.totalExternalMessages).toBe(0);
      expect(summary.unreadMessages).toBe(0);
      expect(summary.pendingMeetingRequests).toBe(0);
      expect(summary.recentEvents).toEqual([]);
    });

    it('counts external conversations', () => {
      insertContact(db, 'c1', 'Alice');
      insertConversation(db, 'conv1', 'c1');
      insertConversation(db, 'conv2', 'c1');
      // Conversation without contact_id should not be counted
      db.prepare(
        `INSERT INTO conversations (id, channel_type, channel_id, message_count)
         VALUES ('conv3', 'test', 'test', 1)`,
      ).run();

      const summary = getExternalActivitySummary(db);
      expect(summary.totalExternalMessages).toBe(2);
    });

    it('counts unread relayed messages', () => {
      insertContact(db, 'c1', 'Alice');
      insertRelayedMessage(db, 'msg1', 'c1', 'unread');
      insertRelayedMessage(db, 'msg2', 'c1', 'unread');
      insertRelayedMessage(db, 'msg3', 'c1', 'read');

      const summary = getExternalActivitySummary(db);
      expect(summary.unreadMessages).toBe(2);
    });

    it('counts pending meeting requests', () => {
      insertContact(db, 'c1', 'Alice');
      insertMeetingRequest(db, 'mtg1', 'c1', 'pending');
      insertMeetingRequest(db, 'mtg2', 'c1', 'approved');
      insertMeetingRequest(db, 'mtg3', 'c1', 'pending');

      const summary = getExternalActivitySummary(db);
      expect(summary.pendingMeetingRequests).toBe(2);
    });

    it('returns recent audit events with contact names', () => {
      insertContact(db, 'c1', 'Alice');
      insertAuditEvent(db, 'c1', 'message_received', 'Hello');
      insertAuditEvent(db, 'c1', 'wave_triggered', 'weather');

      const summary = getExternalActivitySummary(db, 10);
      expect(summary.recentEvents).toHaveLength(2);
      expect(summary.recentEvents[0].contactName).toBe('Alice');
      expect(summary.recentEvents[0].eventType).toBe('wave_triggered');
    });

    it('respects limit parameter', () => {
      insertContact(db, 'c1', 'Alice');
      for (let idx = 0; idx < 5; idx++) {
        insertAuditEvent(db, 'c1', 'message_received', `msg ${idx}`);
      }

      const summary = getExternalActivitySummary(db, 3);
      expect(summary.recentEvents).toHaveLength(3);
    });
  });

  describe('getContactActivities', () => {
    it('returns activities for multiple contacts', () => {
      insertContact(db, 'c1', 'Alice');
      insertContact(db, 'c2', 'Bob');
      insertConversation(db, 'conv1', 'c1');
      insertAuditEvent(db, 'c2', 'wave_triggered', 'test');

      const activities = getContactActivities(db, ['c1', 'c2']);
      expect(activities.size).toBe(2);
      expect(activities.get('c1')!.messageCount).toBe(1);
      expect(activities.get('c2')!.wavesTriggered).toBe(1);
    });

    it('handles empty array', () => {
      const activities = getContactActivities(db, []);
      expect(activities.size).toBe(0);
    });
  });
});
