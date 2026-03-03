import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createRelayedMessage,
  getRelayedMessage,
  listRelayedMessages,
  markMessageRead,
  markMessageReplied,
  archiveMessage,
  countUnreadMessages,
  getMessagesByContact,
} from '../../../src/persistence/relayed-messages.js';
import { createContact } from '../../../src/persistence/contacts.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = ['001_initial.sql', '009_contacts.sql', '010_contact_profiles.sql', '011_external_waves.sql'];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('relayed messages', () => {
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

  describe('createRelayedMessage', () => {
    it('creates a message with defaults', () => {
      const msg = createRelayedMessage(db, { contactId, message: 'Hello there' });

      expect(msg.id).toMatch(/^msg_/);
      expect(msg.contactId).toBe(contactId);
      expect(msg.message).toBe('Hello there');
      expect(msg.urgency).toBe('normal');
      expect(msg.status).toBe('unread');
      expect(msg.createdAt).toBeInstanceOf(Date);
    });

    it('creates a message with urgency', () => {
      const msg = createRelayedMessage(db, {
        contactId,
        message: 'Server is down',
        urgency: 'urgent',
      });

      expect(msg.urgency).toBe('urgent');
    });

    it('creates a message with channel info', () => {
      const msg = createRelayedMessage(db, {
        contactId,
        message: 'Call me',
        channelType: 'discord',
        channelId: 'ch123',
      });

      expect(msg.channelType).toBe('discord');
      expect(msg.channelId).toBe('ch123');
    });
  });

  describe('getRelayedMessage', () => {
    it('retrieves a message by ID', () => {
      const created = createRelayedMessage(db, { contactId, message: 'Test' });
      const fetched = getRelayedMessage(db, created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.message).toBe('Test');
    });

    it('returns null for unknown ID', () => {
      expect(getRelayedMessage(db, 'msg_nonexistent')).toBeNull();
    });
  });

  describe('listRelayedMessages', () => {
    it('lists messages most recent first', () => {
      createRelayedMessage(db, { contactId, message: 'First' });
      createRelayedMessage(db, { contactId, message: 'Second' });
      createRelayedMessage(db, { contactId, message: 'Third' });

      const messages = listRelayedMessages(db);
      expect(messages).toHaveLength(3);
      expect(messages[0].message).toBe('Third');
    });

    it('filters by status', () => {
      const msg1 = createRelayedMessage(db, { contactId, message: 'Read me' });
      createRelayedMessage(db, { contactId, message: 'Unread' });
      markMessageRead(db, msg1.id);

      const unread = listRelayedMessages(db, 'unread');
      expect(unread).toHaveLength(1);
      expect(unread[0].message).toBe('Unread');
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        createRelayedMessage(db, { contactId, message: `msg ${i}` });
      }

      const limited = listRelayedMessages(db, undefined, 3);
      expect(limited).toHaveLength(3);
    });
  });

  describe('status transitions', () => {
    it('marks a message as read', () => {
      const msg = createRelayedMessage(db, { contactId, message: 'Read me' });
      markMessageRead(db, msg.id);

      const updated = getRelayedMessage(db, msg.id);
      expect(updated!.status).toBe('read');
      expect(updated!.readAt).toBeInstanceOf(Date);
    });

    it('marks a message as replied', () => {
      const msg = createRelayedMessage(db, { contactId, message: 'Reply to this' });
      markMessageReplied(db, msg.id);

      const updated = getRelayedMessage(db, msg.id);
      expect(updated!.status).toBe('replied');
      expect(updated!.repliedAt).toBeInstanceOf(Date);
    });

    it('archives a message', () => {
      const msg = createRelayedMessage(db, { contactId, message: 'Archive me' });
      archiveMessage(db, msg.id);

      const updated = getRelayedMessage(db, msg.id);
      expect(updated!.status).toBe('archived');
    });
  });

  describe('countUnreadMessages', () => {
    it('returns 0 when no messages', () => {
      expect(countUnreadMessages(db)).toBe(0);
    });

    it('counts unread messages', () => {
      createRelayedMessage(db, { contactId, message: 'msg 1' });
      createRelayedMessage(db, { contactId, message: 'msg 2' });
      const msg3 = createRelayedMessage(db, { contactId, message: 'msg 3' });
      markMessageRead(db, msg3.id);

      expect(countUnreadMessages(db)).toBe(2);
    });
  });

  describe('getMessagesByContact', () => {
    it('returns messages for a specific contact', () => {
      const contact2 = createContact(db, { name: 'Bob' });

      createRelayedMessage(db, { contactId, message: 'From Alice' });
      createRelayedMessage(db, { contactId: contact2.id, message: 'From Bob' });
      createRelayedMessage(db, { contactId, message: 'From Alice again' });

      const aliceMessages = getMessagesByContact(db, contactId);
      expect(aliceMessages).toHaveLength(2);
      expect(aliceMessages.every((m) => m.contactId === contactId)).toBe(true);
    });

    it('returns empty for contact with no messages', () => {
      const contact2 = createContact(db, { name: 'Bob' });
      expect(getMessagesByContact(db, contact2.id)).toEqual([]);
    });
  });
});
