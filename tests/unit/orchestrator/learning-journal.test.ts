import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { createTask, updateTaskStatus } from '../../../src/persistence/tasks.js';
import { recordTokenUsage } from '../../../src/persistence/token-usage.js';
import { recordFeedback } from '../../../src/persistence/user-feedback.js';
import {
  generateDailyJournal,
  getJournalEntry,
  getRecentJournals,
} from '../../../src/orchestrator/learning-journal.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('learning-journal', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;
  let todayStr: string;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
    todayStr = new Date().toISOString().slice(0, 10);
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  it('generateDailyJournal creates an entry with correct task stats', () => {
    // Create tasks for today
    const task1 = createTask(db, { type: 'chat', description: 'Task 1' });
    const task2 = createTask(db, { type: 'chat', description: 'Task 2' });
    const task3 = createTask(db, { type: 'chat', description: 'Task 3' });

    updateTaskStatus(db, task1.id, 'completed');
    updateTaskStatus(db, task2.id, 'completed');
    updateTaskStatus(db, task3.id, 'failed');

    const entry = generateDailyJournal(db, todayStr);

    expect(entry.date).toBe(todayStr);
    expect(entry.totalTasks).toBe(3);
    expect(entry.completedTasks).toBe(2);
    expect(entry.failedTasks).toBe(1);
  });

  it('generateDailyJournal includes cost data', () => {
    const task = createTask(db, { type: 'chat', description: 'Cost task' });

    recordTokenUsage(db, {
      taskId: task.id,
      provider: 'anthropic',
      model: 'claude-3-haiku',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.005,
    });
    recordTokenUsage(db, {
      taskId: task.id,
      provider: 'anthropic',
      model: 'claude-3-haiku',
      inputTokens: 200,
      outputTokens: 100,
      costUsd: 0.010,
    });

    const entry = generateDailyJournal(db, todayStr);
    expect(entry.totalCostUsd).toBeCloseTo(0.015, 6);
  });

  it('generateDailyJournal includes feedback counts', () => {
    const task1 = createTask(db, { type: 'chat', description: 'T1' });
    const task2 = createTask(db, { type: 'chat', description: 'T2' });
    const task3 = createTask(db, { type: 'chat', description: 'T3' });

    recordFeedback(db, { taskId: task1.id, rating: 1 });
    recordFeedback(db, { taskId: task2.id, rating: 1 });
    recordFeedback(db, { taskId: task3.id, rating: -1 });

    const entry = generateDailyJournal(db, todayStr);
    expect(entry.positiveFeedbackCount).toBe(2);
    expect(entry.negativeFeedbackCount).toBe(1);
  });

  it('generateDailyJournal skips if entry already exists', () => {
    createTask(db, { type: 'chat', description: 'Task' });

    const first = generateDailyJournal(db, todayStr);
    const second = generateDailyJournal(db, todayStr);

    // Same entry returned (not a new one)
    expect(second.id).toBe(first.id);
  });

  it('generateDailyJournal defaults to yesterday when no date given', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const entry = generateDailyJournal(db);
    expect(entry.date).toBe(yesterdayStr);
  });

  it('generateDailyJournal returns zero counts for a day with no data', () => {
    const entry = generateDailyJournal(db, '2025-01-01');
    expect(entry.totalTasks).toBe(0);
    expect(entry.completedTasks).toBe(0);
    expect(entry.failedTasks).toBe(0);
    expect(entry.totalCostUsd).toBe(0);
    expect(entry.positiveFeedbackCount).toBe(0);
    expect(entry.negativeFeedbackCount).toBe(0);
  });

  it('getJournalEntry retrieves a stored entry', () => {
    generateDailyJournal(db, todayStr);

    const entry = getJournalEntry(db, todayStr);
    expect(entry).not.toBeNull();
    expect(entry!.date).toBe(todayStr);
  });

  it('getJournalEntry returns null for nonexistent date', () => {
    const entry = getJournalEntry(db, '1999-12-31');
    expect(entry).toBeNull();
  });

  it('getRecentJournals returns entries ordered by date descending', () => {
    generateDailyJournal(db, '2025-01-01');
    generateDailyJournal(db, '2025-01-02');
    generateDailyJournal(db, '2025-01-03');

    const entries = getRecentJournals(db, 10);
    expect(entries).toHaveLength(3);
    expect(entries[0].date).toBe('2025-01-03');
    expect(entries[1].date).toBe('2025-01-02');
    expect(entries[2].date).toBe('2025-01-01');
  });

  it('getRecentJournals respects limit', () => {
    for (let day = 1; day <= 10; day++) {
      const dayStr = `2025-01-${String(day).padStart(2, '0')}`;
      generateDailyJournal(db, dayStr);
    }

    const entries = getRecentJournals(db, 3);
    expect(entries).toHaveLength(3);
  });

  it('journal entry topWaves and topFailureTypes are arrays', () => {
    const entry = generateDailyJournal(db, todayStr);
    expect(Array.isArray(entry.topWaves)).toBe(true);
    expect(Array.isArray(entry.topFailureTypes)).toBe(true);
  });

  it('journal entry has null summary by default', () => {
    const entry = generateDailyJournal(db, todayStr);
    expect(entry.summary).toBeNull();
  });
});
