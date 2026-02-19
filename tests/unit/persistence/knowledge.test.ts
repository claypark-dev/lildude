import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import {
  upsertKnowledge,
  getKnowledge,
  searchKnowledge,
  getKnowledgeByCategory,
  deleteKnowledge,
} from '../../../src/persistence/knowledge.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('Knowledge DAL', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    dbManager.close();
  });

  it('upsertKnowledge creates a knowledge entry', () => {
    const entry = upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'name',
      value: 'Alice',
    });

    expect(entry.id).toBeDefined();
    expect(typeof entry.id).toBe('number');
    expect(entry.category).toBe('personal');
    expect(entry.key).toBe('name');
    expect(entry.value).toBe('Alice');
    expect(entry.sourceConversationId).toBeNull();
    expect(entry.sourceTaskId).toBeNull();
    expect(entry.confidence).toBe(1.0);
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry.updatedAt).toBeInstanceOf(Date);
  });

  it('upsertKnowledge stores optional fields', () => {
    const entry = upsertKnowledge(dbManager.db, {
      category: 'preferences',
      key: 'theme',
      value: 'dark',
      sourceConversationId: 'conv-123',
      sourceTaskId: 'task-456',
      confidence: 0.85,
    });

    expect(entry.sourceConversationId).toBe('conv-123');
    expect(entry.sourceTaskId).toBe('task-456');
    expect(entry.confidence).toBe(0.85);
  });

  it('getKnowledge retrieves by category and key', () => {
    upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'name',
      value: 'Alice',
    });
    upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'location',
      value: 'NYC',
    });

    const results = getKnowledge(dbManager.db, 'personal', 'name');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('Alice');
  });

  it('getKnowledge returns empty array for nonexistent key', () => {
    const results = getKnowledge(dbManager.db, 'personal', 'nonexistent');
    expect(results).toEqual([]);
  });

  it('searchKnowledge finds entries by term (case-insensitive)', () => {
    upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'name',
      value: 'Alice Smith',
    });
    upsertKnowledge(dbManager.db, {
      category: 'work',
      key: 'company',
      value: 'Acme Corp',
    });

    const byKey = searchKnowledge(dbManager.db, 'NAME');
    expect(byKey).toHaveLength(1);
    expect(byKey[0].key).toBe('name');

    const byValue = searchKnowledge(dbManager.db, 'alice');
    expect(byValue).toHaveLength(1);
    expect(byValue[0].value).toBe('Alice Smith');

    const byPartial = searchKnowledge(dbManager.db, 'corp');
    expect(byPartial).toHaveLength(1);
    expect(byPartial[0].value).toBe('Acme Corp');
  });

  it('searchKnowledge filters by category', () => {
    upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'favorite_color',
      value: 'blue',
    });
    upsertKnowledge(dbManager.db, {
      category: 'work',
      key: 'favorite_tool',
      value: 'blue pen',
    });

    const allResults = searchKnowledge(dbManager.db, 'blue');
    expect(allResults).toHaveLength(2);

    const filteredResults = searchKnowledge(dbManager.db, 'blue', 'personal');
    expect(filteredResults).toHaveLength(1);
    expect(filteredResults[0].category).toBe('personal');
  });

  it('getKnowledgeByCategory returns all entries for category', () => {
    upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'name',
      value: 'Alice',
    });
    upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'location',
      value: 'NYC',
    });
    upsertKnowledge(dbManager.db, {
      category: 'work',
      key: 'company',
      value: 'Acme',
    });

    const personalEntries = getKnowledgeByCategory(dbManager.db, 'personal');
    expect(personalEntries).toHaveLength(2);
    expect(personalEntries.every((e) => e.category === 'personal')).toBe(true);

    const workEntries = getKnowledgeByCategory(dbManager.db, 'work');
    expect(workEntries).toHaveLength(1);
    expect(workEntries[0].key).toBe('company');
  });

  it('deleteKnowledge removes the entry', () => {
    const entry = upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'name',
      value: 'Alice',
    });

    const deleted = deleteKnowledge(dbManager.db, entry.id);
    expect(deleted).toBe(true);

    const results = getKnowledge(dbManager.db, 'personal', 'name');
    expect(results).toEqual([]);
  });

  it('deleteKnowledge returns false for nonexistent id', () => {
    const deleted = deleteKnowledge(dbManager.db, 99999);
    expect(deleted).toBe(false);
  });

  it('multiple entries allowed per category+key', () => {
    upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'name',
      value: 'Alice',
      confidence: 0.8,
    });
    upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'name',
      value: 'Alice Smith',
      confidence: 0.95,
    });

    const results = getKnowledge(dbManager.db, 'personal', 'name');
    expect(results).toHaveLength(2);

    const values = results.map((r) => r.value);
    expect(values).toContain('Alice');
    expect(values).toContain('Alice Smith');
  });
});
