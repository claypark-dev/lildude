/**
 * Event RSVPs DAL.
 * Manages RSVP responses from external users to owner's shared events.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Valid RSVP statuses. */
export type RsvpStatus = 'pending' | 'attending' | 'declined' | 'maybe';

/** Application-level event RSVP. */
export interface EventRsvp {
  id: string;
  contactId: string;
  eventName: string;
  eventDate: string | null;
  rsvpStatus: RsvpStatus;
  message: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating an event RSVP. */
export interface CreateEventRsvpInput {
  contactId: string;
  eventName: string;
  eventDate?: string;
  rsvpStatus?: RsvpStatus;
  message?: string;
}

/** Raw DB row. */
interface EventRsvpDbRow {
  id: string;
  contact_id: string;
  event_name: string;
  event_date: string | null;
  rsvp_status: string;
  message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Map a raw DB row to an application-level EventRsvp.
 * @param row - The raw database row.
 * @returns The mapped EventRsvp.
 */
function mapRow(row: EventRsvpDbRow): EventRsvp {
  return {
    id: row.id,
    contactId: row.contact_id,
    eventName: row.event_name,
    eventDate: row.event_date,
    rsvpStatus: row.rsvp_status as RsvpStatus,
    message: row.message,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Create a new event RSVP.
 * @param db - Database connection.
 * @param input - RSVP details.
 * @returns The created RSVP.
 */
export function createEventRsvp(
  db: BetterSqlite3.Database,
  input: CreateEventRsvpInput,
): EventRsvp {
  try {
    const id = `rsvp_${nanoid()}`;
    db.prepare(
      `INSERT INTO event_rsvps (id, contact_id, event_name, event_date, rsvp_status, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.contactId,
      input.eventName,
      input.eventDate || null,
      input.rsvpStatus || 'pending',
      input.message || null,
    );

    persistenceLogger.debug({ rsvpId: id }, 'Event RSVP created');

    const row = db.prepare('SELECT * FROM event_rsvps WHERE id = ?').get(id) as EventRsvpDbRow;
    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create event RSVP: ${message}`);
  }
}

/**
 * Get an event RSVP by ID.
 * @param db - Database connection.
 * @param rsvpId - The RSVP ID.
 * @returns The RSVP, or null if not found.
 */
export function getEventRsvp(
  db: BetterSqlite3.Database,
  rsvpId: string,
): EventRsvp | null {
  try {
    const row = db.prepare('SELECT * FROM event_rsvps WHERE id = ?').get(rsvpId) as EventRsvpDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get event RSVP: ${message}`);
  }
}

/**
 * List event RSVPs with optional event name filter.
 * @param db - Database connection.
 * @param eventName - Optional event name filter.
 * @param limit - Maximum results (default 50).
 * @returns Array of RSVPs, most recent first.
 */
export function listEventRsvps(
  db: BetterSqlite3.Database,
  eventName?: string,
  limit: number = 50,
): EventRsvp[] {
  try {
    const rows = eventName
      ? db.prepare(
          'SELECT * FROM event_rsvps WHERE event_name = ? ORDER BY created_at DESC LIMIT ?',
        ).all(eventName, limit) as EventRsvpDbRow[]
      : db.prepare(
          'SELECT * FROM event_rsvps ORDER BY created_at DESC LIMIT ?',
        ).all(limit) as EventRsvpDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list event RSVPs: ${message}`);
  }
}

/**
 * Update an RSVP's status.
 * @param db - Database connection.
 * @param rsvpId - The RSVP ID.
 * @param rsvpStatus - The new RSVP status.
 */
export function updateRsvpStatus(
  db: BetterSqlite3.Database,
  rsvpId: string,
  rsvpStatus: RsvpStatus,
): void {
  try {
    db.prepare(
      `UPDATE event_rsvps SET rsvp_status = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(rsvpStatus, rsvpId);
    persistenceLogger.debug({ rsvpId, rsvpStatus }, 'Event RSVP status updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update RSVP status: ${message}`);
  }
}

/**
 * Get RSVPs from a specific contact.
 * @param db - Database connection.
 * @param contactId - The contact ID.
 * @param limit - Maximum results (default 50).
 * @returns Array of RSVPs from that contact.
 */
export function getRsvpsByContact(
  db: BetterSqlite3.Database,
  contactId: string,
  limit: number = 50,
): EventRsvp[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM event_rsvps WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(contactId, limit) as EventRsvpDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get RSVPs by contact: ${message}`);
  }
}

/**
 * Count RSVPs for an event grouped by status.
 * @param db - Database connection.
 * @param eventName - The event name.
 * @returns Object with counts per RSVP status.
 */
export function countRsvpsByEvent(
  db: BetterSqlite3.Database,
  eventName: string,
): Record<RsvpStatus, number> {
  try {
    const rows = db.prepare(
      `SELECT rsvp_status, COUNT(*) AS count FROM event_rsvps
       WHERE event_name = ? GROUP BY rsvp_status`,
    ).all(eventName) as Array<{ rsvp_status: string; count: number }>;

    const counts: Record<RsvpStatus, number> = {
      pending: 0,
      attending: 0,
      declined: 0,
      maybe: 0,
    };

    for (const row of rows) {
      counts[row.rsvp_status as RsvpStatus] = row.count;
    }

    return counts;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to count RSVPs by event: ${message}`);
  }
}
