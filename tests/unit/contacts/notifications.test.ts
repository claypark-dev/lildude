import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getNotificationPrefs,
  updateNotificationPrefs,
  deleteNotificationPrefs,
  isContactMuted,
  shouldNotify,
  listCustomNotificationPrefs,
} from '../../../src/contacts/notifications.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
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

function insertContact(db: Database.Database, id: string, name: string): void {
  db.prepare(
    `INSERT INTO contacts (id, name, trust_level, is_favorite, permitted_waves, channel_ids, rate_limit_per_hour, budget_cap_usd, tags)
     VALUES (?, ?, 'known', 0, '[]', '{}', 10, 0, '[]')`,
  ).run(id, name);
}

describe('contact notifications', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getNotificationPrefs', () => {
    it('returns defaults when no prefs are set', () => {
      insertContact(db, 'c1', 'Alice');
      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.contactId).toBe('c1');
      expect(prefs.muteUntil).toBeNull();
      expect(prefs.notifyChannel).toBeNull();
      expect(prefs.digestFrequency).toBe('realtime');
      expect(prefs.notifyOnMessage).toBe(true);
      expect(prefs.notifyOnWave).toBe(true);
      expect(prefs.notifyOnMeeting).toBe(true);
    });

    it('returns stored prefs when they exist', () => {
      insertContact(db, 'c1', 'Alice');
      db.prepare(
        `INSERT INTO contact_notifications (contact_id, digest_frequency, notify_on_message)
         VALUES ('c1', 'daily', 0)`,
      ).run();

      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.digestFrequency).toBe('daily');
      expect(prefs.notifyOnMessage).toBe(false);
      expect(prefs.notifyOnWave).toBe(true);
    });
  });

  describe('updateNotificationPrefs', () => {
    it('creates prefs if they do not exist', () => {
      insertContact(db, 'c1', 'Alice');
      const prefs = updateNotificationPrefs(db, 'c1', { digestFrequency: 'hourly' });
      expect(prefs.digestFrequency).toBe('hourly');
    });

    it('updates digest frequency', () => {
      insertContact(db, 'c1', 'Alice');
      updateNotificationPrefs(db, 'c1', { digestFrequency: 'daily' });
      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.digestFrequency).toBe('daily');
    });

    it('updates notify channel', () => {
      insertContact(db, 'c1', 'Alice');
      updateNotificationPrefs(db, 'c1', { notifyChannel: 'discord' });
      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.notifyChannel).toBe('discord');
    });

    it('updates mute_until', () => {
      insertContact(db, 'c1', 'Alice');
      const futureDate = new Date(Date.now() + 3600000);
      updateNotificationPrefs(db, 'c1', { muteUntil: futureDate });
      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.muteUntil).toBeInstanceOf(Date);
    });

    it('clears mute_until with null', () => {
      insertContact(db, 'c1', 'Alice');
      const futureDate = new Date(Date.now() + 3600000);
      updateNotificationPrefs(db, 'c1', { muteUntil: futureDate });
      updateNotificationPrefs(db, 'c1', { muteUntil: null });
      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.muteUntil).toBeNull();
    });

    it('disables message notifications', () => {
      insertContact(db, 'c1', 'Alice');
      updateNotificationPrefs(db, 'c1', { notifyOnMessage: false });
      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.notifyOnMessage).toBe(false);
    });

    it('disables wave notifications', () => {
      insertContact(db, 'c1', 'Alice');
      updateNotificationPrefs(db, 'c1', { notifyOnWave: false });
      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.notifyOnWave).toBe(false);
    });

    it('disables meeting notifications', () => {
      insertContact(db, 'c1', 'Alice');
      updateNotificationPrefs(db, 'c1', { notifyOnMeeting: false });
      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.notifyOnMeeting).toBe(false);
    });

    it('updates multiple fields at once', () => {
      insertContact(db, 'c1', 'Alice');
      updateNotificationPrefs(db, 'c1', {
        digestFrequency: 'weekly',
        notifyOnMessage: false,
        notifyOnWave: false,
        notifyChannel: 'telegram',
      });
      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.digestFrequency).toBe('weekly');
      expect(prefs.notifyOnMessage).toBe(false);
      expect(prefs.notifyOnWave).toBe(false);
      expect(prefs.notifyChannel).toBe('telegram');
    });
  });

  describe('deleteNotificationPrefs', () => {
    it('deletes existing prefs', () => {
      insertContact(db, 'c1', 'Alice');
      updateNotificationPrefs(db, 'c1', { digestFrequency: 'weekly' });
      expect(deleteNotificationPrefs(db, 'c1')).toBe(true);

      // Should return defaults now
      const prefs = getNotificationPrefs(db, 'c1');
      expect(prefs.digestFrequency).toBe('realtime');
    });

    it('returns false when no prefs exist', () => {
      expect(deleteNotificationPrefs(db, 'nonexistent')).toBe(false);
    });
  });

  describe('isContactMuted', () => {
    it('returns false when no prefs set', () => {
      insertContact(db, 'c1', 'Alice');
      expect(isContactMuted(db, 'c1')).toBe(false);
    });

    it('returns true when muted until future', () => {
      insertContact(db, 'c1', 'Alice');
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
      updateNotificationPrefs(db, 'c1', { muteUntil: futureDate });
      expect(isContactMuted(db, 'c1')).toBe(true);
    });

    it('returns false when mute has expired', () => {
      insertContact(db, 'c1', 'Alice');
      const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
      updateNotificationPrefs(db, 'c1', { muteUntil: pastDate });
      expect(isContactMuted(db, 'c1')).toBe(false);
    });
  });

  describe('shouldNotify', () => {
    it('returns true by default', () => {
      insertContact(db, 'c1', 'Alice');
      expect(shouldNotify(db, 'c1', 'message')).toBe(true);
      expect(shouldNotify(db, 'c1', 'wave')).toBe(true);
      expect(shouldNotify(db, 'c1', 'meeting')).toBe(true);
    });

    it('returns false when contact is muted', () => {
      insertContact(db, 'c1', 'Alice');
      const futureDate = new Date(Date.now() + 3600000);
      updateNotificationPrefs(db, 'c1', { muteUntil: futureDate });
      expect(shouldNotify(db, 'c1', 'message')).toBe(false);
    });

    it('returns false when digest is off', () => {
      insertContact(db, 'c1', 'Alice');
      updateNotificationPrefs(db, 'c1', { digestFrequency: 'off' });
      expect(shouldNotify(db, 'c1', 'message')).toBe(false);
    });

    it('respects per-event toggles', () => {
      insertContact(db, 'c1', 'Alice');
      updateNotificationPrefs(db, 'c1', {
        notifyOnMessage: false,
        notifyOnWave: true,
        notifyOnMeeting: false,
      });
      expect(shouldNotify(db, 'c1', 'message')).toBe(false);
      expect(shouldNotify(db, 'c1', 'wave')).toBe(true);
      expect(shouldNotify(db, 'c1', 'meeting')).toBe(false);
    });

    it('returns true for non-existent contact (defaults)', () => {
      expect(shouldNotify(db, 'nonexistent', 'message')).toBe(true);
    });
  });

  describe('listCustomNotificationPrefs', () => {
    it('returns empty when no custom prefs', () => {
      expect(listCustomNotificationPrefs(db)).toEqual([]);
    });

    it('returns all contacts with custom prefs', () => {
      insertContact(db, 'c1', 'Alice');
      insertContact(db, 'c2', 'Bob');
      updateNotificationPrefs(db, 'c1', { digestFrequency: 'daily' });
      updateNotificationPrefs(db, 'c2', { notifyOnMessage: false });

      const prefs = listCustomNotificationPrefs(db);
      expect(prefs).toHaveLength(2);
      expect(prefs.map((p) => p.contactId).sort()).toEqual(['c1', 'c2']);
    });
  });
});
