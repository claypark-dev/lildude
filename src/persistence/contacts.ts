/**
 * Contact management data access layer.
 * CRUD operations for the contacts table with trust level management.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { Contact, CreateContactInput, UpdateContactInput, TrustLevel } from '../types/index.js';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Raw row shape from the contacts table. */
interface ContactDbRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  trust_level: string;
  is_favorite: number;
  notes: string | null;
  permitted_waves: string;
  channel_ids: string;
  rate_limit_per_hour: number;
  budget_cap_usd: number;
  tags: string;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Map a raw database row to the application-level Contact.
 * @param row - Raw SQLite row from the contacts table.
 * @returns A typed Contact object.
 */
function mapRow(row: ContactDbRow): Contact {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    trustLevel: row.trust_level as TrustLevel,
    isFavorite: row.is_favorite === 1,
    notes: row.notes,
    permittedWaves: JSON.parse(row.permitted_waves) as string[],
    channelIds: JSON.parse(row.channel_ids) as Record<string, string>,
    rateLimitPerHour: row.rate_limit_per_hour,
    budgetCapUsd: row.budget_cap_usd,
    tags: JSON.parse(row.tags) as string[],
    lastContactedAt: row.last_contacted_at ? new Date(row.last_contacted_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Create a new contact.
 * @param db - The better-sqlite3 Database instance.
 * @param input - The contact data to create.
 * @returns The newly created Contact.
 * @throws {PersistenceError} If the insert fails.
 */
export function createContact(
  db: BetterSqlite3.Database,
  input: CreateContactInput,
): Contact {
  try {
    const id = nanoid();
    db.prepare(
      `INSERT INTO contacts (id, name, phone, email, trust_level, is_favorite, notes, permitted_waves, channel_ids, rate_limit_per_hour, budget_cap_usd, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.phone ?? null,
      input.email ?? null,
      input.trustLevel ?? 'unknown',
      input.isFavorite ? 1 : 0,
      input.notes ?? null,
      JSON.stringify(input.permittedWaves ?? []),
      JSON.stringify(input.channelIds ?? {}),
      input.rateLimitPerHour ?? 10,
      input.budgetCapUsd ?? 0.0,
      JSON.stringify(input.tags ?? []),
    );

    persistenceLogger.debug({ id, name: input.name }, 'Contact created');

    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactDbRow;
    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create contact: ${message}`);
  }
}

/**
 * Get a contact by ID.
 * @param db - The better-sqlite3 Database instance.
 * @param id - The contact ID.
 * @returns The Contact or null if not found.
 */
export function getContact(
  db: BetterSqlite3.Database,
  id: string,
): Contact | null {
  try {
    const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get contact: ${message}`);
  }
}

/**
 * Get a contact by phone number.
 * @param db - The better-sqlite3 Database instance.
 * @param phone - The phone number to search for.
 * @returns The Contact or null if not found.
 */
export function getContactByPhone(
  db: BetterSqlite3.Database,
  phone: string,
): Contact | null {
  try {
    const row = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone) as ContactDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get contact by phone: ${message}`);
  }
}

/**
 * Get a contact by email address.
 * @param db - The better-sqlite3 Database instance.
 * @param email - The email address to search for.
 * @returns The Contact or null if not found.
 */
export function getContactByEmail(
  db: BetterSqlite3.Database,
  email: string,
): Contact | null {
  try {
    const row = db.prepare('SELECT * FROM contacts WHERE email = ?').get(email) as ContactDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get contact by email: ${message}`);
  }
}

/**
 * Get a contact by channel-specific user ID.
 * Searches the JSON channel_ids map for a matching channelType + userId pair.
 * @param db - The better-sqlite3 Database instance.
 * @param channelType - The channel type (e.g., 'discord', 'telegram').
 * @param userId - The user ID on that channel.
 * @returns The Contact or null if not found.
 */
export function getContactByChannelId(
  db: BetterSqlite3.Database,
  channelType: string,
  userId: string,
): Contact | null {
  try {
    // Use JSON extract to search inside the channel_ids JSON object
    const row = db.prepare(
      `SELECT * FROM contacts WHERE json_extract(channel_ids, ?) = ?`,
    ).get(`$.${channelType}`, userId) as ContactDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get contact by channel ID: ${message}`);
  }
}

/**
 * Update an existing contact.
 * @param db - The better-sqlite3 Database instance.
 * @param id - The contact ID to update.
 * @param input - The fields to update.
 * @returns The updated Contact or null if not found.
 * @throws {PersistenceError} If the update fails.
 */
export function updateContact(
  db: BetterSqlite3.Database,
  id: string,
  input: UpdateContactInput,
): Contact | null {
  try {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.phone !== undefined) { fields.push('phone = ?'); values.push(input.phone); }
    if (input.email !== undefined) { fields.push('email = ?'); values.push(input.email); }
    if (input.trustLevel !== undefined) { fields.push('trust_level = ?'); values.push(input.trustLevel); }
    if (input.isFavorite !== undefined) { fields.push('is_favorite = ?'); values.push(input.isFavorite ? 1 : 0); }
    if (input.notes !== undefined) { fields.push('notes = ?'); values.push(input.notes); }
    if (input.permittedWaves !== undefined) { fields.push('permitted_waves = ?'); values.push(JSON.stringify(input.permittedWaves)); }
    if (input.channelIds !== undefined) { fields.push('channel_ids = ?'); values.push(JSON.stringify(input.channelIds)); }
    if (input.rateLimitPerHour !== undefined) { fields.push('rate_limit_per_hour = ?'); values.push(input.rateLimitPerHour); }
    if (input.budgetCapUsd !== undefined) { fields.push('budget_cap_usd = ?'); values.push(input.budgetCapUsd); }
    if (input.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(input.tags)); }

    if (fields.length === 0) {
      return getContact(db, id);
    }

    // Always update the timestamp on changes
    fields.push("updated_at = datetime('now')");
    // SAFETY: All field names above are hardcoded strings, never from user input.
    // Values use parameterized queries — no SQL injection risk.
    values.push(id);
    db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    persistenceLogger.debug({ id }, 'Contact updated');
    return getContact(db, id);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update contact: ${message}`);
  }
}

/**
 * Delete a contact by ID.
 * @param db - The better-sqlite3 Database instance.
 * @param id - The contact ID to delete.
 * @returns True if a contact was deleted.
 * @throws {PersistenceError} If the contact is the owner (cannot be deleted).
 */
export function deleteContact(
  db: BetterSqlite3.Database,
  id: string,
): boolean {
  try {
    // Cannot delete the owner contact
    const contact = getContact(db, id);
    if (contact?.trustLevel === 'owner') {
      throw new PersistenceError('Cannot delete the owner contact');
    }

    const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
    if (result.changes > 0) {
      persistenceLogger.debug({ id }, 'Contact deleted');
    }
    return result.changes > 0;
  } catch (error: unknown) {
    if (error instanceof PersistenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete contact: ${message}`);
  }
}

/**
 * List all contacts, optionally filtered by trust level.
 * @param db - The better-sqlite3 Database instance.
 * @param trustLevel - Optional trust level filter.
 * @param limit - Maximum number of contacts to return (default: 100).
 * @param offset - Number of contacts to skip (default: 0).
 * @returns An array of Contact objects ordered by name.
 */
export function listContacts(
  db: BetterSqlite3.Database,
  trustLevel?: TrustLevel,
  limit: number = 100,
  offset: number = 0,
): Contact[] {
  try {
    if (trustLevel) {
      const rows = db.prepare(
        'SELECT * FROM contacts WHERE trust_level = ? ORDER BY name ASC LIMIT ? OFFSET ?',
      ).all(trustLevel, limit, offset) as ContactDbRow[];
      return rows.map(mapRow);
    }
    const rows = db.prepare(
      'SELECT * FROM contacts ORDER BY name ASC LIMIT ? OFFSET ?',
    ).all(limit, offset) as ContactDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list contacts: ${message}`);
  }
}

/**
 * Get contacts filtered by trust level.
 * @param db - The better-sqlite3 Database instance.
 * @param trustLevel - The trust level to filter by.
 * @returns An array of Contact objects matching the trust level.
 */
export function getContactsByTrustLevel(
  db: BetterSqlite3.Database,
  trustLevel: TrustLevel,
): Contact[] {
  return listContacts(db, trustLevel);
}

/**
 * Get all favorite contacts.
 * @param db - The better-sqlite3 Database instance.
 * @returns An array of favorite Contact objects.
 */
export function getFavoriteContacts(
  db: BetterSqlite3.Database,
): Contact[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM contacts WHERE is_favorite = 1 ORDER BY name ASC',
    ).all() as ContactDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get favorite contacts: ${message}`);
  }
}

/**
 * Search contacts by name, phone, or email.
 * @param db - The better-sqlite3 Database instance.
 * @param query - The search query string.
 * @returns An array of matching Contact objects.
 */
export function searchContacts(
  db: BetterSqlite3.Database,
  query: string,
): Contact[] {
  try {
    const pattern = `%${query}%`;
    const rows = db.prepare(
      `SELECT * FROM contacts
       WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?
       ORDER BY name ASC LIMIT 50`,
    ).all(pattern, pattern, pattern) as ContactDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to search contacts: ${message}`);
  }
}

/**
 * Resolve a contact from a channel message.
 * Looks up by channel-specific user ID, then by phone/email.
 * Creates an 'unknown' contact on first encounter.
 * @param db - The better-sqlite3 Database instance.
 * @param channelType - The channel type.
 * @param userId - The user ID on the channel.
 * @param displayName - Optional display name for new contacts.
 * @returns The resolved Contact.
 */
export function resolveContact(
  db: BetterSqlite3.Database,
  channelType: string,
  userId: string,
  displayName?: string,
): Contact {
  try {
    // First try channel-specific lookup
    const byChannel = getContactByChannelId(db, channelType, userId);
    if (byChannel) {
      // Update last_contacted_at
      db.prepare('UPDATE contacts SET last_contacted_at = datetime(\'now\') WHERE id = ?').run(byChannel.id);
      return { ...byChannel, lastContactedAt: new Date() };
    }

    // Create new unknown contact
    const contact = createContact(db, {
      name: displayName ?? `${channelType}:${userId}`,
      trustLevel: 'unknown',
      channelIds: { [channelType]: userId },
    });

    persistenceLogger.info(
      { contactId: contact.id, channelType, userId },
      'New unknown contact created from message',
    );

    return contact;
  } catch (error: unknown) {
    if (error instanceof PersistenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to resolve contact: ${message}`);
  }
}

/**
 * Touch a contact's last_contacted_at timestamp.
 * @param db - The better-sqlite3 Database instance.
 * @param id - The contact ID.
 */
export function touchContact(
  db: BetterSqlite3.Database,
  id: string,
): void {
  try {
    db.prepare('UPDATE contacts SET last_contacted_at = datetime(\'now\') WHERE id = ?').run(id);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to touch contact: ${message}`);
  }
}

/**
 * Count contacts, optionally by trust level.
 * @param db - The better-sqlite3 Database instance.
 * @param trustLevel - Optional trust level filter.
 * @returns The total count.
 */
export function countContacts(
  db: BetterSqlite3.Database,
  trustLevel?: TrustLevel,
): number {
  try {
    if (trustLevel) {
      const row = db.prepare(
        'SELECT COUNT(*) AS count FROM contacts WHERE trust_level = ?',
      ).get(trustLevel) as { count: number };
      return row.count;
    }
    const row = db.prepare('SELECT COUNT(*) AS count FROM contacts').get() as { count: number };
    return row.count;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to count contacts: ${message}`);
  }
}
