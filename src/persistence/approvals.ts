/**
 * Approvals data access layer.
 * Provides CRUD operations for the approval_queue table.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';
import type { ApprovalRequest, ApprovalStatus, RiskLevel } from '../types/index.js';

/** Input for creating a new approval request. */
export interface CreateApprovalInput {
  taskId: string;
  actionType: string;
  actionDetail: string;
  description: string;
  riskLevel: RiskLevel;
  channelType?: string;
  channelId?: string;
  expiresAt: Date;
}

/** Raw row shape from the approval_queue table. */
interface ApprovalDbRow {
  id: string;
  task_id: string;
  action_type: string;
  action_detail: string;
  description: string;
  risk_level: string;
  status: string;
  channel_type: string | null;
  channel_id: string | null;
  requested_at: string;
  responded_at: string | null;
  expires_at: string;
}

/**
 * Map a raw database row to the application-level ApprovalRequest.
 * @param row - Raw SQLite row from the approval_queue table.
 * @returns A typed ApprovalRequest object.
 */
function mapRow(row: ApprovalDbRow): ApprovalRequest {
  return {
    id: row.id,
    taskId: row.task_id,
    actionType: row.action_type,
    actionDetail: row.action_detail,
    description: row.description,
    riskLevel: row.risk_level as RiskLevel,
    status: row.status as ApprovalStatus,
    channelType: row.channel_type ?? undefined,
    channelId: row.channel_id ?? undefined,
    requestedAt: new Date(row.requested_at),
    respondedAt: row.responded_at ? new Date(row.responded_at) : undefined,
    expiresAt: new Date(row.expires_at),
  };
}

/**
 * Create a new approval request.
 * @param db - The better-sqlite3 Database instance.
 * @param input - The approval request creation parameters.
 * @returns The newly created ApprovalRequest.
 * @throws {PersistenceError} If the insert fails.
 */
export function createApproval(
  db: BetterSqlite3.Database,
  input: CreateApprovalInput,
): ApprovalRequest {
  try {
    const id = nanoid();
    db.prepare(
      `INSERT INTO approval_queue (id, task_id, action_type, action_detail, description, risk_level, channel_type, channel_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.taskId,
      input.actionType,
      input.actionDetail,
      input.description,
      input.riskLevel,
      input.channelType ?? null,
      input.channelId ?? null,
      input.expiresAt.toISOString(),
    );

    persistenceLogger.debug({ approvalId: id, taskId: input.taskId }, 'Approval request created');

    const row = db.prepare(
      'SELECT * FROM approval_queue WHERE id = ?',
    ).get(id) as ApprovalDbRow;

    return mapRow(row);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create approval: ${message}`);
  }
}

/**
 * Retrieve an approval request by its ID.
 * @param db - The better-sqlite3 Database instance.
 * @param approvalId - The approval request's unique identifier.
 * @returns The ApprovalRequest, or undefined if not found.
 * @throws {PersistenceError} If the query fails.
 */
export function getApproval(
  db: BetterSqlite3.Database,
  approvalId: string,
): ApprovalRequest | undefined {
  try {
    const row = db.prepare(
      'SELECT * FROM approval_queue WHERE id = ?',
    ).get(approvalId) as ApprovalDbRow | undefined;

    return row ? mapRow(row) : undefined;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get approval: ${message}`);
  }
}

/**
 * Get all pending approval requests.
 * @param db - The better-sqlite3 Database instance.
 * @returns An array of pending ApprovalRequest objects.
 * @throws {PersistenceError} If the query fails.
 */
export function getPendingApprovals(
  db: BetterSqlite3.Database,
): ApprovalRequest[] {
  try {
    const rows = db.prepare(
      `SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY requested_at ASC`,
    ).all() as ApprovalDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get pending approvals: ${message}`);
  }
}

/**
 * Approve a pending approval request.
 * @param db - The better-sqlite3 Database instance.
 * @param approvalId - The approval request's unique identifier.
 * @throws {PersistenceError} If the update fails.
 */
export function approveRequest(
  db: BetterSqlite3.Database,
  approvalId: string,
): void {
  try {
    db.prepare(
      `UPDATE approval_queue SET status = 'approved', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(approvalId);

    persistenceLogger.debug({ approvalId }, 'Approval request approved');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to approve request: ${message}`);
  }
}

/**
 * Deny a pending approval request.
 * @param db - The better-sqlite3 Database instance.
 * @param approvalId - The approval request's unique identifier.
 * @throws {PersistenceError} If the update fails.
 */
export function denyRequest(
  db: BetterSqlite3.Database,
  approvalId: string,
): void {
  try {
    db.prepare(
      `UPDATE approval_queue SET status = 'denied', responded_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(approvalId);

    persistenceLogger.debug({ approvalId }, 'Approval request denied');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to deny request: ${message}`);
  }
}

/**
 * Expire all pending approval requests whose expires_at is in the past.
 * @param db - The better-sqlite3 Database instance.
 * @returns The number of approval requests that were expired.
 * @throws {PersistenceError} If the update fails.
 */
export function expireOldApprovals(
  db: BetterSqlite3.Database,
): number {
  try {
    const result = db.prepare(
      `UPDATE approval_queue SET status = 'expired', responded_at = CURRENT_TIMESTAMP
       WHERE status = 'pending' AND expires_at < datetime('now')`,
    ).run();

    if (result.changes > 0) {
      persistenceLogger.debug({ count: result.changes }, 'Expired old approvals');
    }

    return result.changes;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to expire old approvals: ${message}`);
  }
}

/**
 * Get all approval requests for a specific task.
 * @param db - The better-sqlite3 Database instance.
 * @param taskId - The task ID to query.
 * @returns An array of ApprovalRequest objects for the given task.
 * @throws {PersistenceError} If the query fails.
 */
export function getApprovalsByTask(
  db: BetterSqlite3.Database,
  taskId: string,
): ApprovalRequest[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM approval_queue WHERE task_id = ? ORDER BY requested_at ASC',
    ).all(taskId) as ApprovalDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get approvals by task: ${message}`);
  }
}
