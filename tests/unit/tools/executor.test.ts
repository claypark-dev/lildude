import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { createToolExecutor } from '../../../src/tools/executor.js';
import { getKnowledge } from '../../../src/persistence/knowledge.js';
import { getCronJob } from '../../../src/persistence/cron-jobs.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type { ContentBlock } from '../../../src/types/index.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

/** Helper to build a tool_use ContentBlock for tests. */
function toolUseBlock(name: string, input: Record<string, unknown>, id?: string): ContentBlock {
  return {
    type: 'tool_use',
    id: id ?? `toolu_test_${name}`,
    name,
    input,
  };
}

describe('tool executor', () => {
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

  describe('routing', () => {
    it('routes knowledge_store to the knowledge store handler', async () => {
      const executor = createToolExecutor(db, 3);
      const block = toolUseBlock('knowledge_store', {
        category: 'test',
        key: 'greeting',
        value: 'hello',
      });

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      expect(result.toolUseId).toBe('toolu_test_knowledge_store');
      expect(result.isError).toBe(false);
      expect(result.content).toContain('Stored knowledge');

      // Verify data was actually persisted
      const entries = getKnowledge(db, 'test', 'greeting');
      expect(entries).toHaveLength(1);
      expect(entries[0].value).toBe('hello');
    });

    it('routes knowledge_recall to the knowledge recall handler', async () => {
      // First store some knowledge
      const executor = createToolExecutor(db, 3);
      await executor.execute(toolUseBlock('knowledge_store', {
        category: 'personal',
        key: 'name',
        value: 'Alice',
      }));

      // Now recall it
      const result = await executor.execute(toolUseBlock('knowledge_recall', {
        query: 'Alice',
      }));

      expect(result.type).toBe('tool_result');
      expect(result.isError).toBe(false);
      expect(result.content).toContain('Alice');
    });

    it('routes schedule_task to the scheduler handler', async () => {
      const executor = createToolExecutor(db, 3);
      const block = toolUseBlock('schedule_task', {
        schedule: '0 9 * * 1-5',
        description: 'Morning standup',
      });

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      expect(result.isError).toBe(false);
      expect(result.content).toContain('Scheduled task created');
    });

    it('routes shell_execute to the shell handler', async () => {
      const executor = createToolExecutor(db, 3);
      const block = toolUseBlock('shell_execute', {
        command: 'echo hello',
      });

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      expect(result.isError).toBe(false);
      expect(result.content).toContain('hello');
    });

    it('routes list_directory to the filesystem handler', async () => {
      const executor = createToolExecutor(db, 3);
      const block = toolUseBlock('list_directory', {
        path: '/tmp',
      });

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      // /tmp should be listable at security level 3
      // The exact result depends on permissions config; just verify it returned
      expect(result.toolUseId).toBe('toolu_test_list_directory');
    });

    it('preserves the tool_use id in the tool_result', async () => {
      const executor = createToolExecutor(db, 3);
      const customId = 'toolu_custom_id_12345';
      const block = toolUseBlock('knowledge_store', {
        category: 'test',
        key: 'k',
        value: 'v',
      }, customId);

      const result = await executor.execute(block);

      expect(result.toolUseId).toBe(customId);
    });
  });

  describe('unknown tool handling', () => {
    it('returns error for unknown tool name', async () => {
      const executor = createToolExecutor(db, 3);
      const block = toolUseBlock('nonexistent_tool', { foo: 'bar' });

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Unknown tool');
      expect(result.content).toContain('nonexistent_tool');
    });

    it('lists available tools in unknown tool error message', async () => {
      const executor = createToolExecutor(db, 3);
      const block = toolUseBlock('bad_tool', {});

      const result = await executor.execute(block);

      expect(result.content).toContain('shell_execute');
      expect(result.content).toContain('knowledge_store');
      expect(result.content).toContain('schedule_task');
    });

    it('does not crash on empty tool name', async () => {
      const executor = createToolExecutor(db, 3);
      const block: ContentBlock = {
        type: 'tool_use',
        id: 'toolu_empty',
        name: '',
        input: {},
      };

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      expect(result.isError).toBe(true);
    });
  });

  describe('execution error handling', () => {
    it('handles invalid cron expression gracefully', async () => {
      const executor = createToolExecutor(db, 3);
      const block = toolUseBlock('schedule_task', {
        schedule: 'not a cron',
        description: 'Should fail validation',
      });

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Invalid cron expression');
    });

    it('handles missing required input fields gracefully', async () => {
      const executor = createToolExecutor(db, 3);
      // knowledge_store expects category, key, value but we pass empty
      const block = toolUseBlock('shell_execute', {});

      const result = await executor.execute(block);

      // The shell tool should handle the empty command internally
      expect(result.type).toBe('tool_result');
      // Not crashing is the key test here
    });

    it('handles denied shell commands without crashing', async () => {
      const executor = createToolExecutor(db, 1); // Most restrictive
      const block = toolUseBlock('shell_execute', {
        command: 'rm -rf /',
      });

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      expect(result.isError).toBe(true);
      expect(result.content).toContain('denied');
    });
  });

  describe('timeout', () => {
    it('times out a long-running tool execution', async () => {
      // Use a very short timeout (1ms) to trigger the timeout path.
      // Use security level 5 (most permissive) so 'sleep' is allowed to execute.
      const executor = createToolExecutor(db, 5, undefined, 1);

      const block = toolUseBlock('shell_execute', {
        command: 'sleep 10',
      });

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      expect(result.isError).toBe(true);
      expect(result.content).toContain('timed out');
    });
  });

  describe('task ID propagation', () => {
    it('passes task ID through to tool handlers', async () => {
      const executor = createToolExecutor(db, 3, 'task-propagation-test');
      const block = toolUseBlock('knowledge_store', {
        category: 'test',
        key: 'prop',
        value: 'check',
      });

      await executor.execute(block);

      // The knowledge store should have stored with the task ID
      const entries = getKnowledge(db, 'test', 'prop');
      expect(entries).toHaveLength(1);
      expect(entries[0].sourceTaskId).toBe('task-propagation-test');
    });
  });

  describe('content block structure', () => {
    it('returns correct type for successful execution', async () => {
      const executor = createToolExecutor(db, 3);
      const block = toolUseBlock('knowledge_store', {
        category: 'test',
        key: 'success',
        value: 'yes',
      });

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      expect(result.toolUseId).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.isError).toBe(false);
    });

    it('returns correct type for failed execution', async () => {
      const executor = createToolExecutor(db, 3);
      const block = toolUseBlock('nonexistent', {});

      const result = await executor.execute(block);

      expect(result.type).toBe('tool_result');
      expect(result.toolUseId).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.isError).toBe(true);
    });
  });
});
