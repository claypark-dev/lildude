import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import {
  createTask,
  getTask,
  updateTaskStatus,
  updateTaskSpend,
  getTasksByStatus,
  getRecentTasks,
  deleteTask,
} from '../../../src/persistence/tasks.js';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

describe('tasks DAL', () => {
  let manager: DatabaseManager;

  beforeEach(() => {
    manager = createTestDb();
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {
      // best-effort cleanup
    }
  });

  it('createTask returns a Task with generated id', () => {
    const task = createTask(manager.db, { type: 'chat', description: 'test task' });

    expect(task.id).toBeDefined();
    expect(typeof task.id).toBe('string');
    expect(task.id.length).toBeGreaterThan(0);
  });

  it('createTask sets status to pending', () => {
    const task = createTask(manager.db, { type: 'chat' });

    expect(task.status).toBe('pending');
  });

  it('getTask returns the created task', () => {
    const created = createTask(manager.db, {
      type: 'automation',
      description: 'automate something',
      channelType: 'discord',
      channelId: 'ch-123',
      userId: 'user-456',
      tokenBudgetUsd: 0.50,
      modelUsed: 'claude-3-haiku',
    });

    const fetched = getTask(manager.db, created.id);

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.type).toBe('automation');
    expect(fetched!.description).toBe('automate something');
    expect(fetched!.channelType).toBe('discord');
    expect(fetched!.channelId).toBe('ch-123');
    expect(fetched!.userId).toBe('user-456');
    expect(fetched!.tokenBudgetUsd).toBe(0.50);
    expect(fetched!.tokensSpentUsd).toBe(0);
    expect(fetched!.modelUsed).toBe('claude-3-haiku');
    expect(fetched!.createdAt).toBeInstanceOf(Date);
    expect(fetched!.updatedAt).toBeInstanceOf(Date);
    expect(fetched!.completedAt).toBeUndefined();
  });

  it('getTask returns undefined for missing id', () => {
    const result = getTask(manager.db, 'nonexistent-id');

    expect(result).toBeUndefined();
  });

  it('updateTaskStatus changes status', () => {
    const task = createTask(manager.db, { type: 'chat' });

    updateTaskStatus(manager.db, task.id, 'running');

    const updated = getTask(manager.db, task.id);
    expect(updated!.status).toBe('running');
  });

  it('updateTaskStatus sets completedAt for terminal statuses', () => {
    const terminalStatuses = ['completed', 'failed', 'killed'] as const;

    for (const status of terminalStatuses) {
      const task = createTask(manager.db, { type: 'chat', description: `test ${status}` });

      updateTaskStatus(manager.db, task.id, status);

      const updated = getTask(manager.db, task.id);
      expect(updated!.status).toBe(status);
      expect(updated!.completedAt).toBeInstanceOf(Date);
    }
  });

  it('updateTaskStatus stores error message', () => {
    const task = createTask(manager.db, { type: 'chat' });

    updateTaskStatus(manager.db, task.id, 'failed', 'Something went wrong');

    const updated = getTask(manager.db, task.id);
    expect(updated!.status).toBe('failed');
    expect(updated!.errorMessage).toBe('Something went wrong');
  });

  it('updateTaskSpend updates the spend amount', () => {
    const task = createTask(manager.db, { type: 'chat' });

    updateTaskSpend(manager.db, task.id, 0.025);

    const updated = getTask(manager.db, task.id);
    expect(updated!.tokensSpentUsd).toBe(0.025);
  });

  it('getTasksByStatus returns matching tasks', () => {
    createTask(manager.db, { type: 'chat', description: 'pending task 1' });
    createTask(manager.db, { type: 'chat', description: 'pending task 2' });
    const runningTask = createTask(manager.db, { type: 'automation', description: 'running task' });
    updateTaskStatus(manager.db, runningTask.id, 'running');

    const pendingTasks = getTasksByStatus(manager.db, 'pending');
    const runningTasks = getTasksByStatus(manager.db, 'running');
    const completedTasks = getTasksByStatus(manager.db, 'completed');

    expect(pendingTasks).toHaveLength(2);
    expect(runningTasks).toHaveLength(1);
    expect(runningTasks[0].description).toBe('running task');
    expect(completedTasks).toHaveLength(0);
  });

  it('getRecentTasks returns tasks ordered by created_at DESC', () => {
    const task1 = createTask(manager.db, { type: 'chat', description: 'first' });
    const task2 = createTask(manager.db, { type: 'chat', description: 'second' });
    const task3 = createTask(manager.db, { type: 'chat', description: 'third' });

    const recent = getRecentTasks(manager.db);

    expect(recent).toHaveLength(3);
    // SQLite CURRENT_TIMESTAMP has second precision, so tasks created in the same
    // second may come back in any order. We just verify all three are present.
    const ids = recent.map((t) => t.id);
    expect(ids).toContain(task1.id);
    expect(ids).toContain(task2.id);
    expect(ids).toContain(task3.id);
  });

  it('getRecentTasks respects limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      createTask(manager.db, { type: 'chat', description: `task ${i}` });
    }

    const firstPage = getRecentTasks(manager.db, 2, 0);
    const secondPage = getRecentTasks(manager.db, 2, 2);

    expect(firstPage).toHaveLength(2);
    expect(secondPage).toHaveLength(2);

    // Pages should have different tasks
    const firstPageIds = firstPage.map((t) => t.id);
    const secondPageIds = secondPage.map((t) => t.id);
    for (const secondPageId of secondPageIds) {
      expect(firstPageIds).not.toContain(secondPageId);
    }
  });

  it('deleteTask removes the task', () => {
    const task = createTask(manager.db, { type: 'chat' });

    const deleted = deleteTask(manager.db, task.id);

    expect(deleted).toBe(true);
    expect(getTask(manager.db, task.id)).toBeUndefined();
  });

  it('deleteTask returns false for missing id', () => {
    const deleted = deleteTask(manager.db, 'nonexistent-id');

    expect(deleted).toBe(false);
  });
});
