import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { createTask } from '../../../src/persistence/tasks.js';
import {
  recordFeedback,
  getFeedbackByTask,
  getModelFeedbackStats,
  getWaveFeedbackStats,
  getDailyFeedbackCounts,
} from '../../../src/persistence/user-feedback.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('user-feedback DAL', () => {
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

  it('recordFeedback stores positive feedback', () => {
    const feedbackId = recordFeedback(db, {
      taskId,
      rating: 1,
      comment: 'Great response!',
      model: 'claude-3-haiku',
      provider: 'anthropic',
      waveName: 'web-search',
    });

    expect(feedbackId).toBeGreaterThan(0);
  });

  it('recordFeedback stores negative feedback', () => {
    const feedbackId = recordFeedback(db, {
      taskId,
      rating: -1,
    });

    expect(feedbackId).toBeGreaterThan(0);
  });

  it('getFeedbackByTask returns stored feedback', () => {
    recordFeedback(db, {
      taskId,
      rating: 1,
      comment: 'Helpful!',
      model: 'claude-3-haiku',
      provider: 'anthropic',
      waveName: 'reminders',
    });

    const feedback = getFeedbackByTask(db, taskId);
    expect(feedback).not.toBeNull();
    expect(feedback!.taskId).toBe(taskId);
    expect(feedback!.rating).toBe(1);
    expect(feedback!.comment).toBe('Helpful!');
    expect(feedback!.model).toBe('claude-3-haiku');
    expect(feedback!.provider).toBe('anthropic');
    expect(feedback!.waveName).toBe('reminders');
    expect(feedback!.createdAt).toBeDefined();
  });

  it('getFeedbackByTask returns null for unknown task', () => {
    const feedback = getFeedbackByTask(db, 'nonexistent-task');
    expect(feedback).toBeNull();
  });

  it('getFeedbackByTask returns most recent feedback when multiple exist', () => {
    recordFeedback(db, { taskId, rating: -1 });
    recordFeedback(db, { taskId, rating: 1, comment: 'Changed my mind' });

    const feedback = getFeedbackByTask(db, taskId);
    expect(feedback).not.toBeNull();
    // The most recent row (highest ID) should be returned
    expect(feedback!.comment).toBe('Changed my mind');
  });

  it('getModelFeedbackStats aggregates feedback correctly', () => {
    const task2 = createTask(db, { type: 'chat', description: 'Task 2' });
    const task3 = createTask(db, { type: 'chat', description: 'Task 3' });

    recordFeedback(db, { taskId, rating: 1, model: 'claude-3-haiku' });
    recordFeedback(db, { taskId: task2.id, rating: 1, model: 'claude-3-haiku' });
    recordFeedback(db, { taskId: task3.id, rating: -1, model: 'claude-3-haiku' });

    const stats = getModelFeedbackStats(db, 'claude-3-haiku');
    expect(stats.totalCount).toBe(3);
    expect(stats.positiveCount).toBe(2);
    expect(stats.negativeCount).toBe(1);
    expect(stats.positiveRate).toBeCloseTo(2 / 3, 6);
  });

  it('getModelFeedbackStats returns zeros for unknown model', () => {
    const stats = getModelFeedbackStats(db, 'unknown-model');
    expect(stats.totalCount).toBe(0);
    expect(stats.positiveCount).toBe(0);
    expect(stats.negativeCount).toBe(0);
    expect(stats.positiveRate).toBe(0);
  });

  it('getWaveFeedbackStats aggregates by wave name', () => {
    const task2 = createTask(db, { type: 'chat', description: 'Task 2' });

    recordFeedback(db, { taskId, rating: 1, waveName: 'web-search' });
    recordFeedback(db, { taskId: task2.id, rating: -1, waveName: 'web-search' });

    const stats = getWaveFeedbackStats(db, 'web-search');
    expect(stats.totalCount).toBe(2);
    expect(stats.positiveCount).toBe(1);
    expect(stats.negativeCount).toBe(1);
    expect(stats.positiveRate).toBe(0.5);
  });

  it('getDailyFeedbackCounts returns counts for a given date', () => {
    recordFeedback(db, { taskId, rating: 1 });
    recordFeedback(db, {
      taskId: createTask(db, { type: 'chat', description: 'T2' }).id,
      rating: -1,
    });
    recordFeedback(db, {
      taskId: createTask(db, { type: 'chat', description: 'T3' }).id,
      rating: 1,
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const counts = getDailyFeedbackCounts(db, todayStr);
    expect(counts.positiveCount).toBe(2);
    expect(counts.negativeCount).toBe(1);
  });

  it('getDailyFeedbackCounts returns zeros for a day with no feedback', () => {
    const counts = getDailyFeedbackCounts(db, '2000-01-01');
    expect(counts.positiveCount).toBe(0);
    expect(counts.negativeCount).toBe(0);
  });

  it('recordFeedback stores optional fields as null when omitted', () => {
    recordFeedback(db, { taskId, rating: 1 });

    const feedback = getFeedbackByTask(db, taskId);
    expect(feedback).not.toBeNull();
    expect(feedback!.comment).toBeNull();
    expect(feedback!.model).toBeNull();
    expect(feedback!.provider).toBeNull();
    expect(feedback!.waveName).toBeNull();
    expect(feedback!.conversationId).toBeNull();
  });
});
