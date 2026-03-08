import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import { analyzeBehavioralPatterns } from '../../../src/memory/behavioral-analyzer.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

/** Insert a conversation and return its ID. */
function createConversation(db: ReturnType<typeof createDatabase>['db'], id: string): string {
  db.prepare(
    `INSERT INTO conversations (id, channel_type, channel_id) VALUES (?, 'web', 'test')`,
  ).run(id);
  return id;
}

/** Insert a user message with a specific hour and content. */
function insertUserMessage(
  db: ReturnType<typeof createDatabase>['db'],
  conversationId: string,
  content: string,
  daysAgo = 0,
  hour = 10,
): void {
  db.prepare(`
    INSERT INTO conversation_logs (conversation_id, role, content, created_at)
    VALUES (?, 'user', ?, datetime('now', '-' || ? || ' days', '+' || ? || ' hours'))
  `).run(conversationId, content, daysAgo, hour);
}

describe('behavioral-analyzer', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    dbManager.close();
  });

  it('returns zero inferences with no conversation history', () => {
    const result = analyzeBehavioralPatterns(dbManager.db);
    expect(result.inferred).toBe(0);
    expect(result.keys).toEqual([]);
  });

  it('infers active hours from sufficient message volume', () => {
    const convId = createConversation(dbManager.db, 'conv-1');

    // Insert 5 messages at morning hours
    for (let i = 0; i < 5; i++) {
      insertUserMessage(dbManager.db, convId, `morning message ${i}`, i, 9);
    }

    const result = analyzeBehavioralPatterns(dbManager.db);
    expect(result.keys).toContain('active_hours');
  });

  it('infers peak usage day from sufficient message volume', () => {
    const convId = createConversation(dbManager.db, 'conv-1');

    // Insert 6 messages on the same day
    for (let i = 0; i < 6; i++) {
      insertUserMessage(dbManager.db, convId, `daily message ${i}`, 0, 10 + i);
    }

    const result = analyzeBehavioralPatterns(dbManager.db);
    expect(result.keys).toContain('peak_usage_day');
  });

  it('infers concise response preference from "shorter" signals', () => {
    const convId = createConversation(dbManager.db, 'conv-1');

    // Insert 3+ messages with "shorter" signals
    insertUserMessage(dbManager.db, convId, 'that was too long, make it shorter', 1);
    insertUserMessage(dbManager.db, convId, 'please be more concise', 2);
    insertUserMessage(dbManager.db, convId, 'can you give me the shorter version', 3);

    const result = analyzeBehavioralPatterns(dbManager.db);
    expect(result.keys).toContain('response_length');
  });

  it('infers detailed response preference from "more detail" signals', () => {
    const convId = createConversation(dbManager.db, 'conv-1');

    insertUserMessage(dbManager.db, convId, 'can you give me more detail on that', 1);
    insertUserMessage(dbManager.db, convId, 'please elaborate on this topic', 2);
    insertUserMessage(dbManager.db, convId, 'explain more about how it works', 3);

    const result = analyzeBehavioralPatterns(dbManager.db);
    expect(result.keys).toContain('response_length');
  });

  it('infers recurring topics from sufficient message history', () => {
    const convId = createConversation(dbManager.db, 'conv-1');

    // Insert 15 messages mentioning "weather" repeatedly
    for (let i = 0; i < 15; i++) {
      insertUserMessage(
        dbManager.db,
        convId,
        i % 3 === 0
          ? 'what is the weather forecast today'
          : i % 3 === 1
            ? 'check the weather in Seattle please'
            : `help me with task number ${i}`,
        i,
      );
    }

    const result = analyzeBehavioralPatterns(dbManager.db);
    expect(result.keys).toContain('recurring_topics');
  });

  it('does not infer topics with fewer than 10 messages', () => {
    const convId = createConversation(dbManager.db, 'conv-1');

    for (let i = 0; i < 5; i++) {
      insertUserMessage(dbManager.db, convId, 'weather check', i);
    }

    const result = analyzeBehavioralPatterns(dbManager.db);
    expect(result.keys).not.toContain('recurring_topics');
  });

  it('stores inferred preferences in the knowledge table', () => {
    const convId = createConversation(dbManager.db, 'conv-1');

    for (let i = 0; i < 6; i++) {
      insertUserMessage(dbManager.db, convId, `message at work ${i}`, 0, 10 + i);
    }

    analyzeBehavioralPatterns(dbManager.db);

    // Check that at least one knowledge entry was created with low confidence
    const entries = dbManager.db.prepare(
      "SELECT * FROM knowledge WHERE category IN ('user_preference', 'learned_automation') AND confidence = 0.4",
    ).all();
    expect(entries.length).toBeGreaterThan(0);
  });
});
