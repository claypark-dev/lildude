import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { createTask } from '../../../src/persistence/tasks.js';
import {
  recordTokenUsage,
  getUsageByTask,
  getUsageByModel,
  getDailyTotalCost,
  getMonthlyTotalCost,
  getTaskTotalCost,
} from '../../../src/persistence/token-usage.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('token-usage DAL', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;
  let taskId: string;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
    const task = createTask(db, { type: 'chat', description: 'Test task' });
    taskId = task.id;
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  it('recordTokenUsage creates a usage record', () => {
    const record = recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-haiku',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });

    expect(record.id).toBeDefined();
    expect(record.taskId).toBe(taskId);
    expect(record.provider).toBe('anthropic');
    expect(record.model).toBe('claude-3-haiku');
    expect(record.inputTokens).toBe(100);
    expect(record.outputTokens).toBe(50);
    expect(record.cachedTokens).toBe(0);
    expect(record.costUsd).toBe(0.001);
    expect(record.roundTripNumber).toBe(1);
    expect(record.createdAt).toBeInstanceOf(Date);
  });

  it('recordTokenUsage stores cachedTokens and roundTripNumber', () => {
    const record = recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      inputTokens: 200,
      outputTokens: 100,
      cachedTokens: 50,
      costUsd: 0.005,
      roundTripNumber: 3,
    });

    expect(record.cachedTokens).toBe(50);
    expect(record.roundTripNumber).toBe(3);
  });

  it('getUsageByTask returns records for task', () => {
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-haiku',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.005,
    });

    const records = getUsageByTask(db, taskId);
    expect(records).toHaveLength(2);
    expect(records[0].model).toBe('claude-3-haiku');
    expect(records[1].model).toBe('claude-3-sonnet');
  });

  it('getUsageByTask returns empty array for unknown task', () => {
    const records = getUsageByTask(db, 'nonexistent-task');
    expect(records).toHaveLength(0);
  });

  it('getUsageByModel returns records for model', () => {
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-haiku',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.005,
    });
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-haiku',
      inputTokens: 150,
      outputTokens: 75,
      costUsd: 0.002,
    });

    const haikuRecords = getUsageByModel(db, 'claude-3-haiku');
    expect(haikuRecords).toHaveLength(2);

    const sonnetRecords = getUsageByModel(db, 'claude-3-sonnet');
    expect(sonnetRecords).toHaveLength(1);
  });

  it('getUsageByModel respects limit', () => {
    for (let idx = 0; idx < 5; idx++) {
      recordTokenUsage(db, {
        taskId,
        provider: 'anthropic',
        model: 'claude-3-haiku',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
      });
    }

    const records = getUsageByModel(db, 'claude-3-haiku', 3);
    expect(records).toHaveLength(3);
  });

  it('getDailyTotalCost returns sum for today', () => {
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-haiku',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.005,
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const total = getDailyTotalCost(db, todayStr);
    expect(total).toBeCloseTo(0.006, 6);
  });

  it('getDailyTotalCost returns 0 for a day with no usage', () => {
    const total = getDailyTotalCost(db, '2000-01-01');
    expect(total).toBe(0);
  });

  it('getMonthlyTotalCost returns sum for current month', () => {
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-haiku',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
    });
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.02,
    });

    const currentMonth = new Date().toISOString().slice(0, 7);
    const total = getMonthlyTotalCost(db, currentMonth);
    expect(total).toBeCloseTo(0.03, 6);
  });

  it('getMonthlyTotalCost returns 0 for a month with no usage', () => {
    const total = getMonthlyTotalCost(db, '2000-01');
    expect(total).toBe(0);
  });

  it('getTaskTotalCost returns total cost for task', () => {
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-haiku',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });
    recordTokenUsage(db, {
      taskId,
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.005,
    });

    const total = getTaskTotalCost(db, taskId);
    expect(total).toBeCloseTo(0.006, 6);
  });

  it('getTaskTotalCost returns 0 for a task with no usage', () => {
    const total = getTaskTotalCost(db, 'nonexistent-task');
    expect(total).toBe(0);
  });

  it('multiple records accumulate correctly', () => {
    for (let idx = 0; idx < 10; idx++) {
      recordTokenUsage(db, {
        taskId,
        provider: 'anthropic',
        model: 'claude-3-haiku',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
        roundTripNumber: idx + 1,
      });
    }

    const records = getUsageByTask(db, taskId);
    expect(records).toHaveLength(10);

    const taskTotal = getTaskTotalCost(db, taskId);
    expect(taskTotal).toBeCloseTo(0.1, 6);
  });
});
