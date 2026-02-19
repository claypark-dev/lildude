/**
 * Unit tests for the advanced quality-aware model router.
 * Tests selectModelWithHistory, routing history DAL, and backward compatibility.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { selectModel, selectModelWithHistory } from '../../../src/providers/router.js';
import {
  recordRoutingDecision,
  recordQualityFeedback,
  getModelQualityStats,
  getRecentRoutingHistory,
} from '../../../src/persistence/routing-history.js';

/** Create an in-memory database with the routing_history schema applied. */
function createTestDb(): BetterSqlite3.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      tier TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'chat',
      quality_score REAL,
      feedback TEXT,
      input_length INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_routing_history_model ON routing_history(model);
    CREATE INDEX IF NOT EXISTS idx_routing_history_task_type ON routing_history(task_type);
  `);

  return db;
}

/** Insert multiple quality-rated entries for a model. */
function seedQualityData(
  db: BetterSqlite3.Database,
  model: string,
  provider: string,
  tier: string,
  scores: number[],
  taskType: string = 'chat',
): void {
  for (let scoreIndex = 0; scoreIndex < scores.length; scoreIndex++) {
    const taskId = `task-${model}-${taskType}-${scoreIndex}`;
    recordRoutingDecision(db, {
      taskId,
      model,
      provider,
      tier,
      taskType,
      inputLength: 100,
      outputTokens: 50,
      costUsd: 0.01,
    });
    recordQualityFeedback(db, taskId, scores[scoreIndex]);
  }
}

describe('selectModelWithHistory', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('falls back to heuristic when no history exists', () => {
    const selection = selectModelWithHistory('small', ['anthropic'], db);
    expect(selection.model).toBe('claude-haiku-4-5-20251001');
    expect(selection.provider).toBe('anthropic');
    expect(selection.tier).toBe('small');
    expect(selection.reasoning).toContain('no sufficient quality data');
  });

  it('boosts high-quality models (score >= 0.8)', () => {
    // Seed gpt-4o-mini with high quality (index 1 in small tier preferences)
    seedQualityData(db, 'gpt-4o-mini', 'openai', 'small', [0.9, 0.85, 0.9, 0.95, 0.88]);

    // With both providers enabled, anthropic would normally be preferred (index 0)
    // But gpt-4o-mini has high quality, so it should be boosted
    const selection = selectModelWithHistory('small', ['anthropic', 'openai'], db);
    expect(selection.model).toBe('gpt-4o-mini');
    expect(selection.provider).toBe('openai');
    expect(selection.reasoning).toContain('quality avg');
  });

  it('penalizes low-quality models (score < 0.4)', () => {
    // Seed claude-haiku (index 0 in small tier) with low quality
    seedQualityData(db, 'claude-haiku-4-5-20251001', 'anthropic', 'small', [0.1, 0.2, 0.3, 0.15, 0.25]);

    // With both providers enabled, anthropic would normally be preferred (index 0)
    // But claude-haiku has low quality, so gpt-4o-mini should be preferred instead
    const selection = selectModelWithHistory('small', ['anthropic', 'openai'], db);
    expect(selection.model).toBe('gpt-4o-mini');
    expect(selection.provider).toBe('openai');
  });

  it('requires minimum sample size (5 ratings) before adjusting', () => {
    // Only 4 high-quality ratings for gpt-4o-mini - not enough to boost
    seedQualityData(db, 'gpt-4o-mini', 'openai', 'small', [0.9, 0.95, 0.88, 0.92]);

    // Should still prefer anthropic (default heuristic order)
    const selection = selectModelWithHistory('small', ['anthropic', 'openai'], db);
    expect(selection.model).toBe('claude-haiku-4-5-20251001');
    expect(selection.provider).toBe('anthropic');
    expect(selection.reasoning).toContain('no sufficient quality data');
  });

  it('task type filtering works', () => {
    // Seed high quality for 'automation' task type only
    seedQualityData(db, 'gpt-4o-mini', 'openai', 'small', [0.9, 0.85, 0.9, 0.95, 0.88], 'automation');

    // For 'chat' task type, there should be no quality data
    const selectionChat = selectModelWithHistory('small', ['anthropic', 'openai'], db, 'chat');
    expect(selectionChat.model).toBe('claude-haiku-4-5-20251001');

    // For 'automation' task type, gpt-4o-mini should be boosted
    const selectionAutomation = selectModelWithHistory('small', ['anthropic', 'openai'], db, 'automation');
    expect(selectionAutomation.model).toBe('gpt-4o-mini');
  });

  it('delegates to selectModel fallback when no available models in tier', () => {
    // Only deepseek enabled, which has no medium models in TIER_PREFERENCES
    expect(() => selectModelWithHistory('medium', ['deepseek'], db)).toThrow(
      /No model available for tier "medium"/,
    );
  });

  it('returns correct estimated cost', () => {
    const selection = selectModelWithHistory('small', ['anthropic'], db);
    expect(selection.estimatedCostUsd).toBeGreaterThan(0);
    expect(typeof selection.estimatedCostUsd).toBe('number');
  });
});

describe('recordRoutingDecision', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('inserts correctly and returns the entry', () => {
    const entry = recordRoutingDecision(db, {
      taskId: 'task-123',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      tier: 'small',
      taskType: 'chat',
      inputLength: 42,
      outputTokens: 100,
      costUsd: 0.005,
    });

    expect(entry.taskId).toBe('task-123');
    expect(entry.model).toBe('claude-haiku-4-5-20251001');
    expect(entry.provider).toBe('anthropic');
    expect(entry.tier).toBe('small');
    expect(entry.taskType).toBe('chat');
    expect(entry.inputLength).toBe(42);
    expect(entry.outputTokens).toBe(100);
    expect(entry.costUsd).toBe(0.005);
    expect(entry.qualityScore).toBeNull();
    expect(entry.feedback).toBeNull();
    expect(entry.id).toBeGreaterThan(0);
  });

  it('uses default values for optional fields', () => {
    const entry = recordRoutingDecision(db, {
      taskId: 'task-456',
      model: 'gpt-4o',
      provider: 'openai',
      tier: 'medium',
    });

    expect(entry.taskType).toBe('chat');
    expect(entry.inputLength).toBe(0);
    expect(entry.outputTokens).toBe(0);
    expect(entry.costUsd).toBe(0);
  });
});

describe('recordQualityFeedback', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('updates quality score correctly', () => {
    recordRoutingDecision(db, {
      taskId: 'task-fb-1',
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      tier: 'small',
    });

    const updated = recordQualityFeedback(db, 'task-fb-1', 0.85, 'Good response');
    expect(updated).toBe(true);

    const history = getRecentRoutingHistory(db, 1);
    expect(history[0].qualityScore).toBe(0.85);
    expect(history[0].feedback).toBe('Good response');
  });

  it('returns false when no matching task exists', () => {
    const updated = recordQualityFeedback(db, 'nonexistent-task', 0.5);
    expect(updated).toBe(false);
  });

  it('updates without feedback text', () => {
    recordRoutingDecision(db, {
      taskId: 'task-fb-2',
      model: 'gpt-4o',
      provider: 'openai',
      tier: 'medium',
    });

    const updated = recordQualityFeedback(db, 'task-fb-2', 0.0);
    expect(updated).toBe(true);

    const history = getRecentRoutingHistory(db, 1);
    expect(history[0].qualityScore).toBe(0.0);
    expect(history[0].feedback).toBeNull();
  });
});

describe('getModelQualityStats', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns correct averages', () => {
    seedQualityData(db, 'claude-haiku-4-5-20251001', 'anthropic', 'small', [0.8, 0.6, 0.7, 0.9, 1.0]);

    const stats = getModelQualityStats(db, 'claude-haiku-4-5-20251001');
    expect(stats.model).toBe('claude-haiku-4-5-20251001');
    expect(stats.ratingCount).toBe(5);
    expect(stats.avgScore).toBeCloseTo(0.8, 1);
  });

  it('returns zero stats for unknown model', () => {
    const stats = getModelQualityStats(db, 'nonexistent-model');
    expect(stats.avgScore).toBe(0);
    expect(stats.ratingCount).toBe(0);
  });

  it('filters by task type when specified', () => {
    seedQualityData(db, 'gpt-4o', 'openai', 'medium', [0.9, 0.8], 'chat');
    seedQualityData(db, 'gpt-4o', 'openai', 'medium', [0.3, 0.2, 0.1], 'automation');

    const chatStats = getModelQualityStats(db, 'gpt-4o', 'chat');
    expect(chatStats.ratingCount).toBe(2);
    expect(chatStats.avgScore).toBeCloseTo(0.85, 1);

    const autoStats = getModelQualityStats(db, 'gpt-4o', 'automation');
    expect(autoStats.ratingCount).toBe(3);
    expect(autoStats.avgScore).toBeCloseTo(0.2, 1);
  });

  it('only counts entries with non-null quality scores', () => {
    // Insert entries without quality scores
    recordRoutingDecision(db, {
      taskId: 'task-no-score-1',
      model: 'gpt-4o-mini',
      provider: 'openai',
      tier: 'small',
    });
    recordRoutingDecision(db, {
      taskId: 'task-no-score-2',
      model: 'gpt-4o-mini',
      provider: 'openai',
      tier: 'small',
    });

    // Only rate one entry
    recordQualityFeedback(db, 'task-no-score-1', 0.7);

    const stats = getModelQualityStats(db, 'gpt-4o-mini');
    expect(stats.ratingCount).toBe(1);
    expect(stats.avgScore).toBeCloseTo(0.7, 1);
  });
});

describe('getRecentRoutingHistory', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('respects limit parameter', () => {
    // Insert 10 entries
    for (let entryIndex = 0; entryIndex < 10; entryIndex++) {
      recordRoutingDecision(db, {
        taskId: `task-limit-${entryIndex}`,
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        tier: 'small',
      });
    }

    const limited = getRecentRoutingHistory(db, 5);
    expect(limited.length).toBe(5);

    const all = getRecentRoutingHistory(db, 100);
    expect(all.length).toBe(10);
  });

  it('returns entries in descending order by creation time', () => {
    for (let entryIndex = 0; entryIndex < 3; entryIndex++) {
      recordRoutingDecision(db, {
        taskId: `task-order-${entryIndex}`,
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        tier: 'small',
      });
    }

    const entries = getRecentRoutingHistory(db, 10);
    expect(entries.length).toBe(3);
    // Most recent first (highest ID)
    expect(entries[0].id).toBeGreaterThan(entries[1].id);
    expect(entries[1].id).toBeGreaterThan(entries[2].id);
  });

  it('returns empty array when no entries exist', () => {
    const entries = getRecentRoutingHistory(db, 10);
    expect(entries).toEqual([]);
  });

  it('uses default limit of 50', () => {
    for (let entryIndex = 0; entryIndex < 60; entryIndex++) {
      recordRoutingDecision(db, {
        taskId: `task-default-${entryIndex}`,
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        tier: 'small',
      });
    }

    const entries = getRecentRoutingHistory(db);
    expect(entries.length).toBe(50);
  });
});

describe('backward compatibility', () => {
  it('selectModel still works unchanged', () => {
    const selection = selectModel('small', ['anthropic']);
    expect(selection.model).toBe('claude-haiku-4-5-20251001');
    expect(selection.provider).toBe('anthropic');
    expect(selection.tier).toBe('small');
    expect(selection.estimatedCostUsd).toBeGreaterThan(0);
    expect(selection.reasoning).toContain('preferred');
  });

  it('selectModel throws when no providers are enabled', () => {
    expect(() => selectModel('small', [])).toThrow(
      /No model available for tier "small"/,
    );
  });

  it('selectModel prefers anthropic over openai', () => {
    const selection = selectModel('medium', ['anthropic', 'openai']);
    expect(selection.provider).toBe('anthropic');
    expect(selection.model).toBe('claude-sonnet-4-5-20250929');
  });
});
