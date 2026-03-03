import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  logExternalEvent,
  getExternalAuditByContact,
  getExternalAuditByType,
  countExternalEvents,
} from '../../../src/persistence/external-audit.js';
import { createContact } from '../../../src/persistence/contacts.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = ['001_initial.sql', '009_contacts.sql', '010_contact_profiles.sql'];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('external audit', () => {
  let db: Database.Database;
  let contactId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const contact = createContact(db, { name: 'Alice' });
    contactId = contact.id;
  });

  afterEach(() => {
    db.close();
  });

  describe('logExternalEvent', () => {
    it('logs a message received event', () => {
      const entry = logExternalEvent(db, contactId, 'message_received', 'Hello from Alice');

      expect(entry.id).toBeDefined();
      expect(entry.contactId).toBe(contactId);
      expect(entry.eventType).toBe('message_received');
      expect(entry.detail).toBe('Hello from Alice');
      expect(entry.createdAt).toBeInstanceOf(Date);
    });

    it('logs an event without detail', () => {
      const entry = logExternalEvent(db, contactId, 'rate_limited');

      expect(entry.detail).toBeNull();
    });

    it('logs wave blocked event', () => {
      const entry = logExternalEvent(db, contactId, 'wave_blocked', 'stock-monitor: insufficient trust');

      expect(entry.eventType).toBe('wave_blocked');
      expect(entry.detail).toContain('insufficient trust');
    });
  });

  describe('getExternalAuditByContact', () => {
    it('returns events for a contact most recent first', () => {
      logExternalEvent(db, contactId, 'message_received', 'First');
      logExternalEvent(db, contactId, 'wave_triggered', 'Second');
      logExternalEvent(db, contactId, 'message_received', 'Third');

      const events = getExternalAuditByContact(db, contactId);
      expect(events).toHaveLength(3);
      expect(events[0].detail).toBe('Third');
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        logExternalEvent(db, contactId, 'message_received', `msg ${i}`);
      }

      const events = getExternalAuditByContact(db, contactId, 5);
      expect(events).toHaveLength(5);
    });

    it('returns empty for unknown contact', () => {
      expect(getExternalAuditByContact(db, 'nobody')).toEqual([]);
    });
  });

  describe('getExternalAuditByType', () => {
    it('filters by event type', () => {
      logExternalEvent(db, contactId, 'message_received', 'msg');
      logExternalEvent(db, contactId, 'wave_triggered', 'wave');
      logExternalEvent(db, contactId, 'message_received', 'msg2');

      const events = getExternalAuditByType(db, 'message_received');
      expect(events).toHaveLength(2);
      expect(events.every(e => e.eventType === 'message_received')).toBe(true);
    });
  });

  describe('countExternalEvents', () => {
    it('counts events since a date', () => {
      logExternalEvent(db, contactId, 'message_received');
      logExternalEvent(db, contactId, 'message_received');
      logExternalEvent(db, contactId, 'wave_triggered');

      const since = new Date(Date.now() - 60_000); // 1 minute ago
      const count = countExternalEvents(db, contactId, 'message_received', since);
      expect(count).toBe(2);
    });

    it('returns 0 for no matching events', () => {
      const since = new Date(Date.now() - 60_000);
      expect(countExternalEvents(db, contactId, 'rate_limited', since)).toBe(0);
    });
  });
});
