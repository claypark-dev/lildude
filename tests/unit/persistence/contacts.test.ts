import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createContact,
  getContact,
  getContactByPhone,
  getContactByEmail,
  getContactByChannelId,
  updateContact,
  deleteContact,
  listContacts,
  getContactsByTrustLevel,
  getFavoriteContacts,
  searchContacts,
  resolveContact,
  touchContact,
  countContacts,
} from '../../../src/persistence/contacts.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '009_contacts.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('contacts DAL', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createContact', () => {
    it('creates a contact with minimal input', () => {
      const contact = createContact(db, { name: 'Alice' });

      expect(contact.id).toBeDefined();
      expect(contact.name).toBe('Alice');
      expect(contact.trustLevel).toBe('unknown');
      expect(contact.isFavorite).toBe(false);
      expect(contact.permittedWaves).toEqual([]);
      expect(contact.channelIds).toEqual({});
      expect(contact.rateLimitPerHour).toBe(10);
      expect(contact.budgetCapUsd).toBe(0);
      expect(contact.tags).toEqual([]);
    });

    it('creates a contact with all fields', () => {
      const contact = createContact(db, {
        name: 'Bob',
        phone: '+1234567890',
        email: 'bob@example.com',
        trustLevel: 'trusted',
        isFavorite: true,
        notes: 'My best friend',
        permittedWaves: ['google-calendar', 'reminders'],
        channelIds: { discord: 'bob#1234', telegram: 'bob_tg' },
        rateLimitPerHour: 50,
        budgetCapUsd: 5.0,
        tags: ['friend', 'vip'],
      });

      expect(contact.name).toBe('Bob');
      expect(contact.phone).toBe('+1234567890');
      expect(contact.email).toBe('bob@example.com');
      expect(contact.trustLevel).toBe('trusted');
      expect(contact.isFavorite).toBe(true);
      expect(contact.notes).toBe('My best friend');
      expect(contact.permittedWaves).toEqual(['google-calendar', 'reminders']);
      expect(contact.channelIds).toEqual({ discord: 'bob#1234', telegram: 'bob_tg' });
      expect(contact.rateLimitPerHour).toBe(50);
      expect(contact.budgetCapUsd).toBe(5);
      expect(contact.tags).toEqual(['friend', 'vip']);
    });

    it('generates unique IDs', () => {
      const c1 = createContact(db, { name: 'A' });
      const c2 = createContact(db, { name: 'B' });
      expect(c1.id).not.toBe(c2.id);
    });
  });

  describe('getContact', () => {
    it('returns a contact by ID', () => {
      const created = createContact(db, { name: 'Alice' });
      const found = getContact(db, created.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
    });

    it('returns null for unknown ID', () => {
      const found = getContact(db, 'nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('getContactByPhone', () => {
    it('returns a contact by phone number', () => {
      createContact(db, { name: 'Alice', phone: '+1111111111' });

      const found = getContactByPhone(db, '+1111111111');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
    });

    it('returns null when phone not found', () => {
      expect(getContactByPhone(db, '+0000000000')).toBeNull();
    });
  });

  describe('getContactByEmail', () => {
    it('returns a contact by email', () => {
      createContact(db, { name: 'Alice', email: 'alice@test.com' });

      const found = getContactByEmail(db, 'alice@test.com');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
    });

    it('returns null when email not found', () => {
      expect(getContactByEmail(db, 'nobody@test.com')).toBeNull();
    });
  });

  describe('getContactByChannelId', () => {
    it('returns a contact by channel-specific user ID', () => {
      createContact(db, {
        name: 'Alice',
        channelIds: { discord: 'alice#1234', telegram: 'alice_tg' },
      });

      const found = getContactByChannelId(db, 'discord', 'alice#1234');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
    });

    it('finds by different channel type', () => {
      createContact(db, {
        name: 'Bob',
        channelIds: { telegram: 'bob_tg' },
      });

      const found = getContactByChannelId(db, 'telegram', 'bob_tg');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Bob');
    });

    it('returns null when channel ID not found', () => {
      expect(getContactByChannelId(db, 'discord', 'nobody')).toBeNull();
    });
  });

  describe('updateContact', () => {
    it('updates a single field', () => {
      const created = createContact(db, { name: 'Alice' });
      const updated = updateContact(db, created.id, { name: 'Alice Updated' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Alice Updated');
    });

    it('updates trust level', () => {
      const created = createContact(db, { name: 'Alice' });
      const updated = updateContact(db, created.id, { trustLevel: 'trusted' });

      expect(updated!.trustLevel).toBe('trusted');
    });

    it('updates JSON fields correctly', () => {
      const created = createContact(db, { name: 'Alice' });
      const updated = updateContact(db, created.id, {
        permittedWaves: ['wave-a', 'wave-b'],
        tags: ['tag1'],
        channelIds: { slack: 'alice_slack' },
      });

      expect(updated!.permittedWaves).toEqual(['wave-a', 'wave-b']);
      expect(updated!.tags).toEqual(['tag1']);
      expect(updated!.channelIds).toEqual({ slack: 'alice_slack' });
    });

    it('returns null for unknown ID', () => {
      const result = updateContact(db, 'nonexistent', { name: 'Test' });
      expect(result).toBeNull();
    });

    it('returns contact unchanged when no fields provided', () => {
      const created = createContact(db, { name: 'Alice' });
      const unchanged = updateContact(db, created.id, {});

      expect(unchanged!.name).toBe('Alice');
    });

    it('can set nullable fields to null', () => {
      const created = createContact(db, { name: 'Alice', phone: '+111', notes: 'Some note' });
      const updated = updateContact(db, created.id, { phone: null, notes: null });

      expect(updated!.phone).toBeNull();
      expect(updated!.notes).toBeNull();
    });
  });

  describe('deleteContact', () => {
    it('deletes a contact', () => {
      const created = createContact(db, { name: 'Alice' });
      const deleted = deleteContact(db, created.id);

      expect(deleted).toBe(true);
      expect(getContact(db, created.id)).toBeNull();
    });

    it('returns false for unknown ID', () => {
      expect(deleteContact(db, 'nonexistent')).toBe(false);
    });

    it('throws when trying to delete an owner contact', () => {
      const owner = createContact(db, { name: 'Owner', trustLevel: 'owner' });

      expect(() => deleteContact(db, owner.id)).toThrow('Cannot delete the owner contact');
    });
  });

  describe('listContacts', () => {
    it('returns all contacts sorted by name', () => {
      createContact(db, { name: 'Zara' });
      createContact(db, { name: 'Alice' });
      createContact(db, { name: 'Bob' });

      const contacts = listContacts(db);
      expect(contacts).toHaveLength(3);
      expect(contacts[0].name).toBe('Alice');
      expect(contacts[1].name).toBe('Bob');
      expect(contacts[2].name).toBe('Zara');
    });

    it('filters by trust level', () => {
      createContact(db, { name: 'A', trustLevel: 'trusted' });
      createContact(db, { name: 'B', trustLevel: 'known' });
      createContact(db, { name: 'C', trustLevel: 'trusted' });

      const trusted = listContacts(db, 'trusted');
      expect(trusted).toHaveLength(2);
      expect(trusted.every(c => c.trustLevel === 'trusted')).toBe(true);
    });

    it('supports pagination', () => {
      for (let i = 0; i < 5; i++) {
        createContact(db, { name: `Contact ${i}` });
      }

      const page1 = listContacts(db, undefined, 2, 0);
      const page2 = listContacts(db, undefined, 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('getContactsByTrustLevel', () => {
    it('returns contacts with specific trust level', () => {
      createContact(db, { name: 'Owner', trustLevel: 'owner' });
      createContact(db, { name: 'Known1', trustLevel: 'known' });
      createContact(db, { name: 'Known2', trustLevel: 'known' });

      const knownContacts = getContactsByTrustLevel(db, 'known');
      expect(knownContacts).toHaveLength(2);
    });
  });

  describe('getFavoriteContacts', () => {
    it('returns only favorite contacts', () => {
      createContact(db, { name: 'Fav', isFavorite: true });
      createContact(db, { name: 'NotFav', isFavorite: false });
      createContact(db, { name: 'Fav2', isFavorite: true });

      const favorites = getFavoriteContacts(db);
      expect(favorites).toHaveLength(2);
      expect(favorites.every(c => c.isFavorite)).toBe(true);
    });
  });

  describe('searchContacts', () => {
    beforeEach(() => {
      createContact(db, { name: 'Alice Smith', phone: '+1111111111', email: 'alice@test.com' });
      createContact(db, { name: 'Bob Jones', phone: '+2222222222', email: 'bob@test.com' });
      createContact(db, { name: 'Charlie Smith', email: 'charlie@work.com' });
    });

    it('searches by name', () => {
      const results = searchContacts(db, 'Smith');
      expect(results).toHaveLength(2);
    });

    it('searches by phone', () => {
      const results = searchContacts(db, '1111');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice Smith');
    });

    it('searches by email', () => {
      const results = searchContacts(db, 'work.com');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Charlie Smith');
    });

    it('returns empty for no matches', () => {
      const results = searchContacts(db, 'zzzzz');
      expect(results).toHaveLength(0);
    });
  });

  describe('resolveContact', () => {
    it('creates a new unknown contact for unrecognized channel user', () => {
      const contact = resolveContact(db, 'discord', 'user123', 'New User');

      expect(contact.name).toBe('New User');
      expect(contact.trustLevel).toBe('unknown');
      expect(contact.channelIds).toEqual({ discord: 'user123' });
    });

    it('returns existing contact for known channel user', () => {
      createContact(db, {
        name: 'Alice',
        trustLevel: 'trusted',
        channelIds: { discord: 'alice#1234' },
      });

      const resolved = resolveContact(db, 'discord', 'alice#1234');

      expect(resolved.name).toBe('Alice');
      expect(resolved.trustLevel).toBe('trusted');
    });

    it('uses channel:userId as default name', () => {
      const contact = resolveContact(db, 'telegram', 'user456');

      expect(contact.name).toBe('telegram:user456');
    });

    it('updates last_contacted_at on resolve', () => {
      createContact(db, {
        name: 'Alice',
        channelIds: { discord: 'alice#1234' },
      });

      const resolved = resolveContact(db, 'discord', 'alice#1234');
      expect(resolved.lastContactedAt).not.toBeNull();
    });
  });

  describe('touchContact', () => {
    it('updates last_contacted_at', () => {
      const contact = createContact(db, { name: 'Alice' });
      expect(contact.lastContactedAt).toBeNull();

      touchContact(db, contact.id);

      const updated = getContact(db, contact.id);
      expect(updated!.lastContactedAt).not.toBeNull();
    });
  });

  describe('countContacts', () => {
    it('counts all contacts', () => {
      createContact(db, { name: 'A' });
      createContact(db, { name: 'B' });
      createContact(db, { name: 'C' });

      expect(countContacts(db)).toBe(3);
    });

    it('counts by trust level', () => {
      createContact(db, { name: 'A', trustLevel: 'trusted' });
      createContact(db, { name: 'B', trustLevel: 'known' });
      createContact(db, { name: 'C', trustLevel: 'trusted' });

      expect(countContacts(db, 'trusted')).toBe(2);
      expect(countContacts(db, 'known')).toBe(1);
      expect(countContacts(db, 'unknown')).toBe(0);
    });
  });
});
