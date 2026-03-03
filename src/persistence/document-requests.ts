/**
 * Document requests DAL.
 * Manages document requests from external contacts pending owner approval.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Valid document request statuses. */
export type DocumentRequestStatus = 'pending' | 'approved' | 'declined';

/** Application-level document request. */
export interface DocumentRequest {
  id: string;
  contactId: string;
  documentName: string;
  reason: string | null;
  status: DocumentRequestStatus;
  createdAt: Date;
  respondedAt: Date | null;
}

/** Input for creating a document request. */
export interface CreateDocumentRequestInput {
  contactId: string;
  documentName: string;
  reason?: string;
}

/** Raw DB row. */
interface DocumentRequestDbRow {
  id: string;
  contact_id: string;
  document_name: string;
  reason: string | null;
  status: string;
  created_at: string;
  responded_at: string | null;
}

/**
 * Map a raw DB row to an application-level DocumentRequest.
 * @param row - The raw database row.
 * @returns The mapped DocumentRequest.
 */
function mapRow(row: DocumentRequestDbRow): DocumentRequest {
  return {
    id: row.id,
    contactId: row.contact_id,
    documentName: row.document_name,
    reason: row.reason,
    status: row.status as DocumentRequestStatus,
    createdAt: new Date(row.created_at),
    respondedAt: row.responded_at ? new Date(row.responded_at) : null,
  };
}

/**
 * Create a new document request.
 * @param db - Database connection.
 * @param input - Document request details.
 * @returns The created document request.
 */
export function createDocumentRequest(
  db: BetterSqlite3.Database,
  input: CreateDocumentRequestInput,
): DocumentRequest {
  try {
    const id = `doc_${nanoid()}`;
    db.prepare(
      `INSERT INTO document_requests (id, contact_id, document_name, reason)
       VALUES (?, ?, ?, ?)`,
    ).run(
      id,
      input.contactId,
      input.documentName,
      input.reason || null,
    );

    persistenceLogger.debug({ requestId: id }, 'Document request created');

    const row = db.prepare('SELECT * FROM document_requests WHERE id = ?').get(id) as DocumentRequestDbRow;
    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create document request: ${message}`);
  }
}

/**
 * Get a document request by ID.
 * @param db - Database connection.
 * @param requestId - The document request ID.
 * @returns The document request, or null if not found.
 */
export function getDocumentRequest(
  db: BetterSqlite3.Database,
  requestId: string,
): DocumentRequest | null {
  try {
    const row = db.prepare('SELECT * FROM document_requests WHERE id = ?').get(requestId) as DocumentRequestDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get document request: ${message}`);
  }
}

/**
 * List document requests with optional status filter.
 * @param db - Database connection.
 * @param status - Optional status filter.
 * @param limit - Maximum results (default 50).
 * @returns Array of document requests, most recent first.
 */
export function listDocumentRequests(
  db: BetterSqlite3.Database,
  status?: DocumentRequestStatus,
  limit: number = 50,
): DocumentRequest[] {
  try {
    const rows = status
      ? db.prepare(
          'SELECT * FROM document_requests WHERE status = ? ORDER BY created_at DESC LIMIT ?',
        ).all(status, limit) as DocumentRequestDbRow[]
      : db.prepare(
          'SELECT * FROM document_requests ORDER BY created_at DESC LIMIT ?',
        ).all(limit) as DocumentRequestDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list document requests: ${message}`);
  }
}

/**
 * Approve a document request (owner action).
 * @param db - Database connection.
 * @param requestId - The document request ID.
 */
export function approveDocumentRequest(
  db: BetterSqlite3.Database,
  requestId: string,
): void {
  try {
    db.prepare(
      `UPDATE document_requests SET status = 'approved', responded_at = datetime('now') WHERE id = ?`,
    ).run(requestId);
    persistenceLogger.debug({ requestId }, 'Document request approved');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to approve document request: ${message}`);
  }
}

/**
 * Decline a document request (owner action).
 * @param db - Database connection.
 * @param requestId - The document request ID.
 */
export function declineDocumentRequest(
  db: BetterSqlite3.Database,
  requestId: string,
): void {
  try {
    db.prepare(
      `UPDATE document_requests SET status = 'declined', responded_at = datetime('now') WHERE id = ?`,
    ).run(requestId);
    persistenceLogger.debug({ requestId }, 'Document request declined');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to decline document request: ${message}`);
  }
}

/**
 * Get document requests from a specific contact.
 * @param db - Database connection.
 * @param contactId - The contact ID.
 * @param limit - Maximum results (default 50).
 * @returns Array of document requests from that contact.
 */
export function getDocumentRequestsByContact(
  db: BetterSqlite3.Database,
  contactId: string,
  limit: number = 50,
): DocumentRequest[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM document_requests WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(contactId, limit) as DocumentRequestDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get document requests by contact: ${message}`);
  }
}

/**
 * Count document requests by status.
 * @param db - Database connection.
 * @param status - Optional status filter.
 * @returns Document request count.
 */
export function countDocumentRequests(
  db: BetterSqlite3.Database,
  status?: DocumentRequestStatus,
): number {
  try {
    const row = status
      ? db.prepare(
          'SELECT COUNT(*) AS count FROM document_requests WHERE status = ?',
        ).get(status) as { count: number }
      : db.prepare(
          'SELECT COUNT(*) AS count FROM document_requests',
        ).get() as { count: number };
    return row.count;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to count document requests: ${message}`);
  }
}
