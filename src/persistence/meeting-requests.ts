/**
 * Meeting requests DAL.
 * Manages meeting requests from external users pending owner approval.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Valid meeting request statuses. */
export type MeetingRequestStatus = 'pending' | 'approved' | 'declined' | 'expired';

/** Application-level meeting request. */
export interface MeetingRequest {
  id: string;
  contactId: string;
  proposedTime: string | null;
  durationMinutes: number;
  subject: string;
  message: string | null;
  status: MeetingRequestStatus;
  ownerResponse: string | null;
  createdAt: Date;
  respondedAt: Date | null;
}

/** Input for creating a meeting request. */
export interface CreateMeetingRequestInput {
  contactId: string;
  proposedTime?: string;
  durationMinutes?: number;
  subject: string;
  message?: string;
}

/** Raw DB row. */
interface MeetingRequestDbRow {
  id: string;
  contact_id: string;
  proposed_time: string | null;
  duration_minutes: number;
  subject: string;
  message: string | null;
  status: string;
  owner_response: string | null;
  created_at: string;
  responded_at: string | null;
}

function mapRow(row: MeetingRequestDbRow): MeetingRequest {
  return {
    id: row.id,
    contactId: row.contact_id,
    proposedTime: row.proposed_time,
    durationMinutes: row.duration_minutes,
    subject: row.subject,
    message: row.message,
    status: row.status as MeetingRequestStatus,
    ownerResponse: row.owner_response,
    createdAt: new Date(row.created_at),
    respondedAt: row.responded_at ? new Date(row.responded_at) : null,
  };
}

/**
 * Create a new meeting request.
 * @param db - Database connection.
 * @param input - Meeting request details.
 * @returns The created request.
 */
export function createMeetingRequest(
  db: BetterSqlite3.Database,
  input: CreateMeetingRequestInput,
): MeetingRequest {
  try {
    const id = `mtg_${nanoid()}`;
    db.prepare(
      `INSERT INTO meeting_requests (id, contact_id, proposed_time, duration_minutes, subject, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.contactId,
      input.proposedTime || null,
      input.durationMinutes || 30,
      input.subject,
      input.message || null,
    );

    persistenceLogger.debug({ requestId: id }, 'Meeting request created');

    const row = db.prepare('SELECT * FROM meeting_requests WHERE id = ?').get(id) as MeetingRequestDbRow;
    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create meeting request: ${message}`);
  }
}

/**
 * Get a meeting request by ID.
 * @param db - Database connection.
 * @param requestId - The request ID.
 * @returns The request, or null if not found.
 */
export function getMeetingRequest(
  db: BetterSqlite3.Database,
  requestId: string,
): MeetingRequest | null {
  try {
    const row = db.prepare('SELECT * FROM meeting_requests WHERE id = ?').get(requestId) as MeetingRequestDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get meeting request: ${message}`);
  }
}

/**
 * List meeting requests with optional status filter.
 * @param db - Database connection.
 * @param status - Optional status filter.
 * @param limit - Maximum results (default 50).
 * @returns Array of requests, most recent first.
 */
export function listMeetingRequests(
  db: BetterSqlite3.Database,
  status?: MeetingRequestStatus,
  limit: number = 50,
): MeetingRequest[] {
  try {
    const rows = status
      ? db.prepare(
          'SELECT * FROM meeting_requests WHERE status = ? ORDER BY created_at DESC LIMIT ?',
        ).all(status, limit) as MeetingRequestDbRow[]
      : db.prepare(
          'SELECT * FROM meeting_requests ORDER BY created_at DESC LIMIT ?',
        ).all(limit) as MeetingRequestDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list meeting requests: ${message}`);
  }
}

/**
 * Approve a meeting request.
 * @param db - Database connection.
 * @param requestId - The request ID.
 * @param ownerResponse - Optional response message.
 */
export function approveMeetingRequest(
  db: BetterSqlite3.Database,
  requestId: string,
  ownerResponse?: string,
): void {
  try {
    db.prepare(
      `UPDATE meeting_requests
       SET status = 'approved', owner_response = ?, responded_at = datetime('now')
       WHERE id = ?`,
    ).run(ownerResponse || null, requestId);

    persistenceLogger.debug({ requestId }, 'Meeting request approved');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to approve meeting request: ${message}`);
  }
}

/**
 * Decline a meeting request.
 * @param db - Database connection.
 * @param requestId - The request ID.
 * @param ownerResponse - Optional response message.
 */
export function declineMeetingRequest(
  db: BetterSqlite3.Database,
  requestId: string,
  ownerResponse?: string,
): void {
  try {
    db.prepare(
      `UPDATE meeting_requests
       SET status = 'declined', owner_response = ?, responded_at = datetime('now')
       WHERE id = ?`,
    ).run(ownerResponse || null, requestId);

    persistenceLogger.debug({ requestId }, 'Meeting request declined');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to decline meeting request: ${message}`);
  }
}

/**
 * Count pending meeting requests.
 * @param db - Database connection.
 * @returns Pending request count.
 */
export function countPendingMeetingRequests(db: BetterSqlite3.Database): number {
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS count FROM meeting_requests WHERE status = 'pending'`,
    ).get() as { count: number };
    return row.count;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to count pending meeting requests: ${message}`);
  }
}

/**
 * Get meeting requests for a specific contact.
 * @param db - Database connection.
 * @param contactId - The contact ID.
 * @param limit - Maximum results (default 50).
 * @returns Array of requests from that contact.
 */
export function getMeetingRequestsByContact(
  db: BetterSqlite3.Database,
  contactId: string,
  limit: number = 50,
): MeetingRequest[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM meeting_requests WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(contactId, limit) as MeetingRequestDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get meeting requests by contact: ${message}`);
  }
}
