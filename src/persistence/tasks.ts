/**
 * Tasks DAL (Data Access Layer).
 * Provides CRUD operations for the tasks table.
 * All functions accept a better-sqlite3 Database instance for dependency injection.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { Task, TaskStatus, TaskType } from '../types/index.js';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Terminal statuses that trigger setting completed_at. */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'killed']);

/** Default number of tasks returned by getRecentTasks. */
const DEFAULT_LIMIT = 50;

/** Default offset for getRecentTasks pagination. */
const DEFAULT_OFFSET = 0;

/** Shape of a raw task row from the database (snake_case columns). */
interface TaskDbRow {
  id: string;
  status: string;
  type: string;
  description: string | null;
  channel_type: string | null;
  channel_id: string | null;
  user_id: string | null;
  token_budget_usd: number | null;
  tokens_spent_usd: number;
  model_used: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Input for creating a new task. */
export interface CreateTaskInput {
  type: TaskType;
  description?: string;
  channelType?: string;
  channelId?: string;
  userId?: string;
  tokenBudgetUsd?: number;
  modelUsed?: string;
}

/**
 * Map a raw database row (snake_case) to a Task object (camelCase).
 * Converts date strings to Date objects and nulls to undefined.
 * @param row - The raw database row.
 * @returns A properly typed Task object.
 */
function rowToTask(row: TaskDbRow): Task {
  return {
    id: row.id,
    status: row.status as TaskStatus,
    type: row.type as TaskType,
    description: row.description ?? undefined,
    channelType: row.channel_type ?? undefined,
    channelId: row.channel_id ?? undefined,
    userId: row.user_id ?? undefined,
    tokenBudgetUsd: row.token_budget_usd ?? undefined,
    tokensSpentUsd: row.tokens_spent_usd,
    modelUsed: row.model_used ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

/**
 * Create a new task.
 * Generates a unique ID using nanoid and inserts the task with status 'pending'.
 * @param db - The better-sqlite3 Database instance.
 * @param input - The task creation parameters.
 * @returns The created Task with generated id and timestamps.
 * @throws {PersistenceError} If the database operation fails.
 */
export function createTask(db: BetterSqlite3.Database, input: CreateTaskInput): Task {
  const taskId = nanoid();

  try {
    db.prepare(
      `INSERT INTO tasks (id, status, type, description, channel_type, channel_id, user_id, token_budget_usd, tokens_spent_usd, model_used)
       VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      taskId,
      input.type,
      input.description ?? null,
      input.channelType ?? null,
      input.channelId ?? null,
      input.userId ?? null,
      input.tokenBudgetUsd ?? null,
      input.modelUsed ?? null,
    );

    const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as TaskDbRow;

    persistenceLogger.debug({ taskId, type: input.type }, 'Task created');

    return rowToTask(row);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create task: ${message}`);
  }
}

/**
 * Get a task by ID.
 * @param db - The better-sqlite3 Database instance.
 * @param taskId - The task ID to look up.
 * @returns The Task object, or undefined if not found.
 * @throws {PersistenceError} If the database operation fails.
 */
export function getTask(db: BetterSqlite3.Database, taskId: string): Task | undefined {
  try {
    const row = db.prepare(
      `SELECT * FROM tasks WHERE id = ?`,
    ).get(taskId) as TaskDbRow | undefined;

    return row ? rowToTask(row) : undefined;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get task "${taskId}": ${message}`);
  }
}

/**
 * Update a task's status.
 * Also updates the updated_at timestamp. When the new status is a terminal
 * status ('completed', 'failed', or 'killed'), sets completed_at as well.
 * @param db - The better-sqlite3 Database instance.
 * @param taskId - The task ID to update.
 * @param status - The new task status.
 * @param errorMessage - Optional error message (typically set when status is 'failed').
 * @throws {PersistenceError} If the database operation fails.
 */
export function updateTaskStatus(
  db: BetterSqlite3.Database,
  taskId: string,
  status: TaskStatus,
  errorMessage?: string,
): void {
  try {
    const isTerminal = TERMINAL_STATUSES.has(status);

    if (isTerminal) {
      db.prepare(
        `UPDATE tasks SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(status, errorMessage ?? null, taskId);
    } else {
      db.prepare(
        `UPDATE tasks SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(status, errorMessage ?? null, taskId);
    }

    persistenceLogger.debug({ taskId, status }, 'Task status updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update task status for "${taskId}": ${message}`);
  }
}

/**
 * Update the token spend amount for a task.
 * Also updates the updated_at timestamp.
 * @param db - The better-sqlite3 Database instance.
 * @param taskId - The task ID to update.
 * @param tokensSpentUsd - The new total tokens spent in USD.
 * @throws {PersistenceError} If the database operation fails.
 */
export function updateTaskSpend(
  db: BetterSqlite3.Database,
  taskId: string,
  tokensSpentUsd: number,
): void {
  try {
    db.prepare(
      `UPDATE tasks SET tokens_spent_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(tokensSpentUsd, taskId);

    persistenceLogger.debug({ taskId, tokensSpentUsd }, 'Task spend updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update task spend for "${taskId}": ${message}`);
  }
}

/**
 * Get all tasks matching a given status.
 * @param db - The better-sqlite3 Database instance.
 * @param status - The task status to filter by.
 * @returns An array of Task objects with the specified status.
 * @throws {PersistenceError} If the database operation fails.
 */
export function getTasksByStatus(db: BetterSqlite3.Database, status: TaskStatus): Task[] {
  try {
    const rows = db.prepare(
      `SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC`,
    ).all(status) as TaskDbRow[];

    return rows.map(rowToTask);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get tasks by status "${status}": ${message}`);
  }
}

/**
 * Get recent tasks with pagination.
 * Returns tasks ordered by created_at descending (most recent first).
 * @param db - The better-sqlite3 Database instance.
 * @param limit - Maximum number of tasks to return. Defaults to 50.
 * @param offset - Number of tasks to skip. Defaults to 0.
 * @returns An array of Task objects.
 * @throws {PersistenceError} If the database operation fails.
 */
export function getRecentTasks(
  db: BetterSqlite3.Database,
  limit: number = DEFAULT_LIMIT,
  offset: number = DEFAULT_OFFSET,
): Task[] {
  try {
    const rows = db.prepare(
      `SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).all(limit, offset) as TaskDbRow[];

    return rows.map(rowToTask);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get recent tasks: ${message}`);
  }
}

/**
 * Delete a task by ID.
 * @param db - The better-sqlite3 Database instance.
 * @param taskId - The task ID to delete.
 * @returns True if a task was deleted, false if the task ID did not exist.
 * @throws {PersistenceError} If the database operation fails.
 */
export function deleteTask(db: BetterSqlite3.Database, taskId: string): boolean {
  try {
    const result = db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);

    const deleted = result.changes > 0;

    if (deleted) {
      persistenceLogger.debug({ taskId }, 'Task deleted');
    }

    return deleted;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete task "${taskId}": ${message}`);
  }
}
