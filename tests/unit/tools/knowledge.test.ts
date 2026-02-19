import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { knowledgeStore, knowledgeRecall } from '../../../src/tools/knowledge.js';
import { getRecentSecurityLogs } from '../../../src/persistence/security-log.js';
import { getKnowledge } from '../../../src/persistence/knowledge.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('knowledge tools', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  describe('knowledgeStore', () => {
    it('stores knowledge and returns success', async () => {
      const result = await knowledgeStore(db, 'personal', 'name', 'Alice');

      expect(result.success).toBe(true);
      expect(result.output).toContain('personal');
      expect(result.output).toContain('name');
      expect(result.output).toContain('Alice');
      expect(result.metadata?.knowledgeId).toBeDefined();
      expect(result.metadata?.category).toBe('personal');
      expect(result.metadata?.key).toBe('name');
    });

    it('persists knowledge to the database', async () => {
      await knowledgeStore(db, 'work', 'company', 'Acme Corp');

      const entries = getKnowledge(db, 'work', 'company');
      expect(entries).toHaveLength(1);
      expect(entries[0].value).toBe('Acme Corp');
    });

    it('stores knowledge with optional parameters', async () => {
      const result = await knowledgeStore(db, 'preferences', 'theme', 'dark', {
        sourceConversationId: 'conv-abc',
        sourceTaskId: 'task-xyz',
        confidence: 0.9,
      });

      expect(result.success).toBe(true);
      expect(result.metadata?.confidence).toBe(0.9);

      const entries = getKnowledge(db, 'preferences', 'theme');
      expect(entries).toHaveLength(1);
      expect(entries[0].sourceConversationId).toBe('conv-abc');
      expect(entries[0].sourceTaskId).toBe('task-xyz');
      expect(entries[0].confidence).toBe(0.9);
    });

    it('logs the store action to the security log', async () => {
      await knowledgeStore(db, 'personal', 'email', 'alice@example.com', {
        securityLevel: 3,
        sourceTaskId: 'task-100',
      });

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].actionType).toBe('knowledge_store');
      expect(logs[0].actionDetail).toBe('personal/email');
      expect(logs[0].allowed).toBe(true);
      expect(logs[0].securityLevel).toBe(3);
      expect(logs[0].taskId).toBe('task-100');
    });

    it('handles multiple stores to the same category/key', async () => {
      await knowledgeStore(db, 'personal', 'name', 'Alice');
      await knowledgeStore(db, 'personal', 'name', 'Alice Smith');

      const entries = getKnowledge(db, 'personal', 'name');
      expect(entries).toHaveLength(2);
      const values = entries.map((entry) => entry.value);
      expect(values).toContain('Alice');
      expect(values).toContain('Alice Smith');
    });
  });

  describe('knowledgeRecall', () => {
    it('retrieves matching knowledge entries', async () => {
      await knowledgeStore(db, 'personal', 'name', 'Alice');
      await knowledgeStore(db, 'work', 'company', 'Acme Corp');

      const result = await knowledgeRecall(db, 'Alice');

      expect(result.success).toBe(true);
      expect(result.output).toContain('personal');
      expect(result.output).toContain('name');
      expect(result.output).toContain('Alice');
      expect(result.metadata?.resultCount).toBe(1);
    });

    it('returns no results message when nothing matches', async () => {
      const result = await knowledgeRecall(db, 'nonexistent');

      expect(result.success).toBe(true);
      expect(result.output).toContain('No knowledge entries found');
      expect(result.metadata?.resultCount).toBe(0);
    });

    it('filters results by category when specified', async () => {
      await knowledgeStore(db, 'personal', 'favorite_color', 'blue');
      await knowledgeStore(db, 'work', 'brand_color', 'blue');

      const allResults = await knowledgeRecall(db, 'blue');
      expect(allResults.metadata?.resultCount).toBe(2);

      const filteredResults = await knowledgeRecall(db, 'blue', 'personal');
      expect(filteredResults.metadata?.resultCount).toBe(1);
      expect(filteredResults.output).toContain('personal');
    });

    it('performs case-insensitive search', async () => {
      await knowledgeStore(db, 'personal', 'name', 'Alice Smith');

      const result = await knowledgeRecall(db, 'alice');

      expect(result.success).toBe(true);
      expect(result.metadata?.resultCount).toBe(1);
      expect(result.output).toContain('Alice Smith');
    });

    it('logs the recall action to the security log', async () => {
      await knowledgeStore(db, 'personal', 'name', 'Alice');
      await knowledgeRecall(db, 'Alice', undefined, {
        securityLevel: 4,
        taskId: 'task-200',
      });

      const logs = getRecentSecurityLogs(db, 5);
      const recallLog = logs.find((log) => log.actionType === 'knowledge_recall');
      expect(recallLog).toBeDefined();
      expect(recallLog?.actionDetail).toBe('Alice');
      expect(recallLog?.allowed).toBe(true);
      expect(recallLog?.securityLevel).toBe(4);
      expect(recallLog?.taskId).toBe('task-200');
    });

    it('includes category in security log when filtering', async () => {
      await knowledgeStore(db, 'work', 'project', 'Lil Dude');
      await knowledgeRecall(db, 'Lil', 'work');

      const logs = getRecentSecurityLogs(db, 5);
      const recallLog = logs.find((log) => log.actionType === 'knowledge_recall');
      expect(recallLog?.actionDetail).toBe('work:Lil');
    });

    it('formats multiple results with confidence scores', async () => {
      await knowledgeStore(db, 'personal', 'name', 'Alice', { confidence: 0.9 });
      await knowledgeStore(db, 'personal', 'nickname', 'Al', { confidence: 0.7 });

      const result = await knowledgeRecall(db, 'al');

      expect(result.success).toBe(true);
      expect(result.metadata?.resultCount).toBe(2);
      expect(result.output).toContain('confidence: 0.9');
      expect(result.output).toContain('confidence: 0.7');
    });

    it('returns unique categories in metadata', async () => {
      await knowledgeStore(db, 'personal', 'name', 'test');
      await knowledgeStore(db, 'work', 'title', 'test');

      const result = await knowledgeRecall(db, 'test');

      expect(result.metadata?.categories).toBeDefined();
      const categories = result.metadata?.categories as string[];
      expect(categories).toContain('personal');
      expect(categories).toContain('work');
    });
  });
});
