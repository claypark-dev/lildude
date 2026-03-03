import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createContactGroup,
  getContactGroup,
  getContactGroupByName,
  listContactGroups,
  updateContactGroup,
  deleteContactGroup,
  addContactToGroup,
  removeContactFromGroup,
  getGroupsForContact,
  countContactGroups,
} from '../../../src/persistence/contact-groups.js';

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

describe('contact-groups persistence', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createContactGroup', () => {
    it('creates a group with default values', () => {
      const group = createContactGroup(db, { name: 'Family' });
      expect(group.id).toMatch(/^grp_/);
      expect(group.name).toBe('Family');
      expect(group.description).toBe('');
      expect(group.contactIds).toEqual([]);
      expect(group.color).toBe('#6366f1');
      expect(group.createdAt).toBeInstanceOf(Date);
    });

    it('creates a group with all fields', () => {
      const group = createContactGroup(db, {
        name: 'Work',
        description: 'Work colleagues',
        contactIds: ['c1', 'c2'],
        color: '#ff0000',
      });
      expect(group.name).toBe('Work');
      expect(group.description).toBe('Work colleagues');
      expect(group.contactIds).toEqual(['c1', 'c2']);
      expect(group.color).toBe('#ff0000');
    });

    it('rejects duplicate names', () => {
      createContactGroup(db, { name: 'Unique' });
      expect(() => createContactGroup(db, { name: 'Unique' })).toThrow('Failed to create contact group');
    });
  });

  describe('getContactGroup', () => {
    it('returns a group by ID', () => {
      const created = createContactGroup(db, { name: 'Friends' });
      const fetched = getContactGroup(db, created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('Friends');
    });

    it('returns null for non-existent ID', () => {
      expect(getContactGroup(db, 'nonexistent')).toBeNull();
    });
  });

  describe('getContactGroupByName', () => {
    it('returns a group by name', () => {
      createContactGroup(db, { name: 'VIPs' });
      const group = getContactGroupByName(db, 'VIPs');
      expect(group).not.toBeNull();
      expect(group!.name).toBe('VIPs');
    });

    it('returns null for non-existent name', () => {
      expect(getContactGroupByName(db, 'Missing')).toBeNull();
    });
  });

  describe('listContactGroups', () => {
    it('returns all groups ordered by name', () => {
      createContactGroup(db, { name: 'Zebra' });
      createContactGroup(db, { name: 'Alpha' });
      createContactGroup(db, { name: 'Middle' });

      const groups = listContactGroups(db);
      expect(groups).toHaveLength(3);
      expect(groups[0].name).toBe('Alpha');
      expect(groups[1].name).toBe('Middle');
      expect(groups[2].name).toBe('Zebra');
    });

    it('respects limit and offset', () => {
      createContactGroup(db, { name: 'A' });
      createContactGroup(db, { name: 'B' });
      createContactGroup(db, { name: 'C' });

      const page = listContactGroups(db, 2, 1);
      expect(page).toHaveLength(2);
      expect(page[0].name).toBe('B');
      expect(page[1].name).toBe('C');
    });

    it('returns empty array when no groups exist', () => {
      expect(listContactGroups(db)).toEqual([]);
    });
  });

  describe('updateContactGroup', () => {
    it('updates name', () => {
      const group = createContactGroup(db, { name: 'Old Name' });
      const updated = updateContactGroup(db, group.id, { name: 'New Name' });
      expect(updated!.name).toBe('New Name');
    });

    it('updates contactIds', () => {
      const group = createContactGroup(db, { name: 'Test' });
      const updated = updateContactGroup(db, group.id, { contactIds: ['a', 'b', 'c'] });
      expect(updated!.contactIds).toEqual(['a', 'b', 'c']);
    });

    it('updates color', () => {
      const group = createContactGroup(db, { name: 'Colorful' });
      const updated = updateContactGroup(db, group.id, { color: '#00ff00' });
      expect(updated!.color).toBe('#00ff00');
    });

    it('returns null for non-existent group', () => {
      expect(updateContactGroup(db, 'nope', { name: 'X' })).toBeNull();
    });

    it('returns unchanged group when no fields provided', () => {
      const group = createContactGroup(db, { name: 'Stable' });
      const unchanged = updateContactGroup(db, group.id, {});
      expect(unchanged!.name).toBe('Stable');
    });
  });

  describe('deleteContactGroup', () => {
    it('deletes an existing group', () => {
      const group = createContactGroup(db, { name: 'ToDelete' });
      expect(deleteContactGroup(db, group.id)).toBe(true);
      expect(getContactGroup(db, group.id)).toBeNull();
    });

    it('returns false for non-existent group', () => {
      expect(deleteContactGroup(db, 'nope')).toBe(false);
    });
  });

  describe('addContactToGroup', () => {
    it('adds a contact to a group', () => {
      insertContact(db, 'c1', 'Alice');
      const group = createContactGroup(db, { name: 'Team' });
      const updated = addContactToGroup(db, group.id, 'c1');
      expect(updated!.contactIds).toContain('c1');
    });

    it('does not duplicate contact IDs', () => {
      insertContact(db, 'c1', 'Alice');
      const group = createContactGroup(db, { name: 'Team', contactIds: ['c1'] });
      const updated = addContactToGroup(db, group.id, 'c1');
      expect(updated!.contactIds).toEqual(['c1']);
    });

    it('returns null for non-existent group', () => {
      expect(addContactToGroup(db, 'nope', 'c1')).toBeNull();
    });
  });

  describe('removeContactFromGroup', () => {
    it('removes a contact from a group', () => {
      insertContact(db, 'c1', 'Alice');
      insertContact(db, 'c2', 'Bob');
      const group = createContactGroup(db, { name: 'Team', contactIds: ['c1', 'c2'] });
      const updated = removeContactFromGroup(db, group.id, 'c1');
      expect(updated!.contactIds).toEqual(['c2']);
    });

    it('handles removing non-existent contact gracefully', () => {
      const group = createContactGroup(db, { name: 'Team', contactIds: ['c1'] });
      const updated = removeContactFromGroup(db, group.id, 'c99');
      expect(updated!.contactIds).toEqual(['c1']);
    });

    it('returns null for non-existent group', () => {
      expect(removeContactFromGroup(db, 'nope', 'c1')).toBeNull();
    });
  });

  describe('getGroupsForContact', () => {
    it('returns all groups a contact belongs to', () => {
      insertContact(db, 'c1', 'Alice');
      createContactGroup(db, { name: 'Family', contactIds: ['c1'] });
      createContactGroup(db, { name: 'Work', contactIds: ['c1', 'c2'] });
      createContactGroup(db, { name: 'Empty' });

      const groups = getGroupsForContact(db, 'c1');
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.name).sort()).toEqual(['Family', 'Work']);
    });

    it('returns empty array when contact is in no groups', () => {
      insertContact(db, 'c1', 'Alice');
      createContactGroup(db, { name: 'Other', contactIds: ['c2'] });
      expect(getGroupsForContact(db, 'c1')).toEqual([]);
    });
  });

  describe('countContactGroups', () => {
    it('returns zero when empty', () => {
      expect(countContactGroups(db)).toBe(0);
    });

    it('returns correct count', () => {
      createContactGroup(db, { name: 'A' });
      createContactGroup(db, { name: 'B' });
      createContactGroup(db, { name: 'C' });
      expect(countContactGroups(db)).toBe(3);
    });
  });
});
