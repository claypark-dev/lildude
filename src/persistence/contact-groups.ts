/**
 * Contact group data access layer.
 * CRUD operations for organizing contacts into named groups.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level contact group. */
export interface ContactGroup {
  id: string;
  name: string;
  description: string;
  contactIds: string[];
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a contact group. */
export interface CreateContactGroupInput {
  name: string;
  description?: string;
  contactIds?: string[];
  color?: string;
}

/** Input for updating a contact group. */
export interface UpdateContactGroupInput {
  name?: string;
  description?: string;
  contactIds?: string[];
  color?: string;
}

/** Raw DB row shape. */
interface ContactGroupDbRow {
  id: string;
  name: string;
  description: string;
  contact_ids: string;
  color: string;
  created_at: string;
  updated_at: string;
}

/**
 * Map a raw database row to the application-level ContactGroup.
 * @param row - Raw SQLite row.
 * @returns A typed ContactGroup object.
 */
function mapRow(row: ContactGroupDbRow): ContactGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    contactIds: JSON.parse(row.contact_ids) as string[],
    color: row.color,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Create a new contact group.
 * @param db - The better-sqlite3 Database instance.
 * @param input - The group data to create.
 * @returns The newly created ContactGroup.
 * @throws {PersistenceError} If the insert fails (e.g., duplicate name).
 */
export function createContactGroup(
  db: BetterSqlite3.Database,
  input: CreateContactGroupInput,
): ContactGroup {
  try {
    const id = `grp_${nanoid()}`;
    db.prepare(
      `INSERT INTO contact_groups (id, name, description, contact_ids, color)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.description ?? '',
      JSON.stringify(input.contactIds ?? []),
      input.color ?? '#6366f1',
    );

    persistenceLogger.debug({ id, name: input.name }, 'Contact group created');

    const row = db.prepare('SELECT * FROM contact_groups WHERE id = ?').get(id) as ContactGroupDbRow;
    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create contact group: ${message}`);
  }
}

/**
 * Get a contact group by ID.
 * @param db - The better-sqlite3 Database instance.
 * @param id - The group ID.
 * @returns The ContactGroup or null if not found.
 */
export function getContactGroup(
  db: BetterSqlite3.Database,
  id: string,
): ContactGroup | null {
  try {
    const row = db.prepare('SELECT * FROM contact_groups WHERE id = ?').get(id) as ContactGroupDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get contact group: ${message}`);
  }
}

/**
 * Get a contact group by name.
 * @param db - The better-sqlite3 Database instance.
 * @param name - The group name.
 * @returns The ContactGroup or null if not found.
 */
export function getContactGroupByName(
  db: BetterSqlite3.Database,
  name: string,
): ContactGroup | null {
  try {
    const row = db.prepare('SELECT * FROM contact_groups WHERE name = ?').get(name) as ContactGroupDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get contact group by name: ${message}`);
  }
}

/**
 * List all contact groups.
 * @param db - The better-sqlite3 Database instance.
 * @param limit - Maximum number of groups to return (default: 100).
 * @param offset - Number of groups to skip (default: 0).
 * @returns An array of ContactGroup objects ordered by name.
 */
export function listContactGroups(
  db: BetterSqlite3.Database,
  limit: number = 100,
  offset: number = 0,
): ContactGroup[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM contact_groups ORDER BY name ASC LIMIT ? OFFSET ?',
    ).all(limit, offset) as ContactGroupDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list contact groups: ${message}`);
  }
}

/**
 * Update an existing contact group.
 * @param db - The better-sqlite3 Database instance.
 * @param id - The group ID to update.
 * @param input - The fields to update.
 * @returns The updated ContactGroup or null if not found.
 */
export function updateContactGroup(
  db: BetterSqlite3.Database,
  id: string,
  input: UpdateContactGroupInput,
): ContactGroup | null {
  try {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
    if (input.contactIds !== undefined) { fields.push('contact_ids = ?'); values.push(JSON.stringify(input.contactIds)); }
    if (input.color !== undefined) { fields.push('color = ?'); values.push(input.color); }

    if (fields.length === 0) {
      return getContactGroup(db, id);
    }

    fields.push("updated_at = datetime('now')");
    // SAFETY: All field names above are hardcoded strings, never from user input.
    // Values use parameterized queries — no SQL injection risk.
    values.push(id);
    db.prepare(`UPDATE contact_groups SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    persistenceLogger.debug({ id }, 'Contact group updated');
    return getContactGroup(db, id);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update contact group: ${message}`);
  }
}

/**
 * Delete a contact group by ID.
 * @param db - The better-sqlite3 Database instance.
 * @param id - The group ID to delete.
 * @returns True if a group was deleted.
 */
export function deleteContactGroup(
  db: BetterSqlite3.Database,
  id: string,
): boolean {
  try {
    const result = db.prepare('DELETE FROM contact_groups WHERE id = ?').run(id);
    if (result.changes > 0) {
      persistenceLogger.debug({ id }, 'Contact group deleted');
    }
    return result.changes > 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete contact group: ${message}`);
  }
}

/**
 * Add a contact to a group.
 * @param db - The better-sqlite3 Database instance.
 * @param groupId - The group ID.
 * @param contactId - The contact ID to add.
 * @returns The updated ContactGroup or null if group not found.
 */
export function addContactToGroup(
  db: BetterSqlite3.Database,
  groupId: string,
  contactId: string,
): ContactGroup | null {
  try {
    const group = getContactGroup(db, groupId);
    if (!group) return null;

    if (!group.contactIds.includes(contactId)) {
      const updatedIds = [...group.contactIds, contactId];
      return updateContactGroup(db, groupId, { contactIds: updatedIds });
    }
    return group;
  } catch (error: unknown) {
    if (error instanceof PersistenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to add contact to group: ${message}`);
  }
}

/**
 * Remove a contact from a group.
 * @param db - The better-sqlite3 Database instance.
 * @param groupId - The group ID.
 * @param contactId - The contact ID to remove.
 * @returns The updated ContactGroup or null if group not found.
 */
export function removeContactFromGroup(
  db: BetterSqlite3.Database,
  groupId: string,
  contactId: string,
): ContactGroup | null {
  try {
    const group = getContactGroup(db, groupId);
    if (!group) return null;

    const updatedIds = group.contactIds.filter((cid) => cid !== contactId);
    return updateContactGroup(db, groupId, { contactIds: updatedIds });
  } catch (error: unknown) {
    if (error instanceof PersistenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to remove contact from group: ${message}`);
  }
}

/**
 * Get all groups that a contact belongs to.
 * @param db - The better-sqlite3 Database instance.
 * @param contactId - The contact ID.
 * @returns An array of ContactGroup objects containing this contact.
 */
export function getGroupsForContact(
  db: BetterSqlite3.Database,
  contactId: string,
): ContactGroup[] {
  try {
    // Use JSON_EACH to search inside the contact_ids JSON array
    const rows = db.prepare(
      `SELECT cg.* FROM contact_groups cg
       WHERE EXISTS (
         SELECT 1 FROM json_each(cg.contact_ids) je
         WHERE je.value = ?
       )
       ORDER BY cg.name ASC`,
    ).all(contactId) as ContactGroupDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get groups for contact: ${message}`);
  }
}

/**
 * Count total contact groups.
 * @param db - The better-sqlite3 Database instance.
 * @returns The total count.
 */
export function countContactGroups(
  db: BetterSqlite3.Database,
): number {
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM contact_groups').get() as { count: number };
    return row.count;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to count contact groups: ${message}`);
  }
}
