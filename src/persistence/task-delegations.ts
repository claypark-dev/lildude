/**
 * Task delegations DAL.
 * Manages tasks delegated by external contacts for owner review.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Valid task delegation priority levels. */
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/** Valid task delegation statuses. */
export type TaskDelegationStatus = 'pending' | 'accepted' | 'declined' | 'completed';

/** Application-level task delegation. */
export interface TaskDelegation {
  id: string;
  contactId: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskDelegationStatus;
  createdAt: Date;
  respondedAt: Date | null;
}

/** Input for creating a task delegation. */
export interface CreateTaskDelegationInput {
  contactId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
}

/** Raw DB row. */
interface TaskDelegationDbRow {
  id: string;
  contact_id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  created_at: string;
  responded_at: string | null;
}

/**
 * Map a raw DB row to an application-level TaskDelegation.
 * @param row - The raw database row.
 * @returns The mapped TaskDelegation.
 */
function mapRow(row: TaskDelegationDbRow): TaskDelegation {
  return {
    id: row.id,
    contactId: row.contact_id,
    title: row.title,
    description: row.description,
    priority: row.priority as TaskPriority,
    status: row.status as TaskDelegationStatus,
    createdAt: new Date(row.created_at),
    respondedAt: row.responded_at ? new Date(row.responded_at) : null,
  };
}

/**
 * Create a new task delegation.
 * @param db - Database connection.
 * @param input - Task delegation details.
 * @returns The created task delegation.
 */
export function createTaskDelegation(
  db: BetterSqlite3.Database,
  input: CreateTaskDelegationInput,
): TaskDelegation {
  try {
    const id = `task_${nanoid()}`;
    db.prepare(
      `INSERT INTO task_delegations (id, contact_id, title, description, priority)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.contactId,
      input.title,
      input.description || null,
      input.priority || 'normal',
    );

    persistenceLogger.debug({ taskId: id }, 'Task delegation created');

    const row = db.prepare('SELECT * FROM task_delegations WHERE id = ?').get(id) as TaskDelegationDbRow;
    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create task delegation: ${message}`);
  }
}

/**
 * Get a task delegation by ID.
 * @param db - Database connection.
 * @param taskId - The task delegation ID.
 * @returns The task delegation, or null if not found.
 */
export function getTaskDelegation(
  db: BetterSqlite3.Database,
  taskId: string,
): TaskDelegation | null {
  try {
    const row = db.prepare('SELECT * FROM task_delegations WHERE id = ?').get(taskId) as TaskDelegationDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get task delegation: ${message}`);
  }
}

/**
 * List task delegations with optional status filter.
 * @param db - Database connection.
 * @param status - Optional status filter.
 * @param limit - Maximum results (default 50).
 * @returns Array of task delegations, most recent first.
 */
export function listTaskDelegations(
  db: BetterSqlite3.Database,
  status?: TaskDelegationStatus,
  limit: number = 50,
): TaskDelegation[] {
  try {
    const rows = status
      ? db.prepare(
          'SELECT * FROM task_delegations WHERE status = ? ORDER BY created_at DESC LIMIT ?',
        ).all(status, limit) as TaskDelegationDbRow[]
      : db.prepare(
          'SELECT * FROM task_delegations ORDER BY created_at DESC LIMIT ?',
        ).all(limit) as TaskDelegationDbRow[];

    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list task delegations: ${message}`);
  }
}

/**
 * Accept a task delegation (owner action).
 * @param db - Database connection.
 * @param taskId - The task delegation ID.
 */
export function acceptTaskDelegation(
  db: BetterSqlite3.Database,
  taskId: string,
): void {
  try {
    db.prepare(
      `UPDATE task_delegations SET status = 'accepted', responded_at = datetime('now') WHERE id = ?`,
    ).run(taskId);
    persistenceLogger.debug({ taskId }, 'Task delegation accepted');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to accept task delegation: ${message}`);
  }
}

/**
 * Decline a task delegation (owner action).
 * @param db - Database connection.
 * @param taskId - The task delegation ID.
 */
export function declineTaskDelegation(
  db: BetterSqlite3.Database,
  taskId: string,
): void {
  try {
    db.prepare(
      `UPDATE task_delegations SET status = 'declined', responded_at = datetime('now') WHERE id = ?`,
    ).run(taskId);
    persistenceLogger.debug({ taskId }, 'Task delegation declined');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to decline task delegation: ${message}`);
  }
}

/**
 * Mark a task delegation as completed.
 * @param db - Database connection.
 * @param taskId - The task delegation ID.
 */
export function completeTaskDelegation(
  db: BetterSqlite3.Database,
  taskId: string,
): void {
  try {
    db.prepare(
      `UPDATE task_delegations SET status = 'completed', responded_at = datetime('now') WHERE id = ?`,
    ).run(taskId);
    persistenceLogger.debug({ taskId }, 'Task delegation completed');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to complete task delegation: ${message}`);
  }
}

/**
 * Count task delegations by status.
 * @param db - Database connection.
 * @param status - Optional status filter.
 * @returns Task delegation count.
 */
export function countTaskDelegations(
  db: BetterSqlite3.Database,
  status?: TaskDelegationStatus,
): number {
  try {
    const row = status
      ? db.prepare(
          'SELECT COUNT(*) AS count FROM task_delegations WHERE status = ?',
        ).get(status) as { count: number }
      : db.prepare(
          'SELECT COUNT(*) AS count FROM task_delegations',
        ).get() as { count: number };
    return row.count;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to count task delegations: ${message}`);
  }
}

/**
 * Get task delegations from a specific contact.
 * @param db - Database connection.
 * @param contactId - The contact ID.
 * @param limit - Maximum results (default 50).
 * @returns Array of task delegations from that contact.
 */
export function getTaskDelegationsByContact(
  db: BetterSqlite3.Database,
  contactId: string,
  limit: number = 50,
): TaskDelegation[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM task_delegations WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(contactId, limit) as TaskDelegationDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get task delegations by contact: ${message}`);
  }
}
