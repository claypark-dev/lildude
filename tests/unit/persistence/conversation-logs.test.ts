import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { createTask } from '../../../src/persistence/tasks.js';
import { createConversation } from '../../../src/persistence/conversations.js';
import {
  appendConversationLog,
  getConversationLogs,
  getConversationTokenCount,
  deleteOldLogs,
} from '../../../src/persistence/conversation-logs.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('Conversation Logs DAL', () => {
  let dbManager: DatabaseManager;
  let conversationId: string;

  beforeEach(() => {
    dbManager = createTestDb();
    const conversation = createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });
    conversationId = conversation.id;
  });

  afterEach(() => {
    dbManager.close();
  });

  it('appendConversationLog creates a log entry', () => {
    const log = appendConversationLog(dbManager.db, {
      conversationId,
      role: 'user',
      content: 'Hello, assistant!',
      tokenCount: 10,
    });

    expect(log.id).toBeDefined();
    expect(typeof log.id).toBe('number');
    expect(log.conversationId).toBe(conversationId);
    expect(log.role).toBe('user');
    expect(log.content).toBe('Hello, assistant!');
    expect(log.tokenCount).toBe(10);
    expect(log.metadata).toBeNull();
    expect(log.createdAt).toBeInstanceOf(Date);
  });

  it('getConversationLogs returns logs in order', () => {
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'user',
      content: 'First message',
    });
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'assistant',
      content: 'Second message',
    });
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'user',
      content: 'Third message',
    });

    const logs = getConversationLogs(dbManager.db, conversationId);

    expect(logs).toHaveLength(3);
    expect(logs[0].content).toBe('First message');
    expect(logs[1].content).toBe('Second message');
    expect(logs[2].content).toBe('Third message');
    expect(logs[0].role).toBe('user');
    expect(logs[1].role).toBe('assistant');
  });

  it('getConversationLogs respects limit and offset', () => {
    for (let i = 1; i <= 10; i++) {
      appendConversationLog(dbManager.db, {
        conversationId,
        role: 'user',
        content: `Message ${i}`,
      });
    }

    const limited = getConversationLogs(dbManager.db, conversationId, 3);
    expect(limited).toHaveLength(3);
    expect(limited[0].content).toBe('Message 1');
    expect(limited[2].content).toBe('Message 3');

    const paginated = getConversationLogs(dbManager.db, conversationId, 3, 5);
    expect(paginated).toHaveLength(3);
    expect(paginated[0].content).toBe('Message 6');
    expect(paginated[2].content).toBe('Message 8');
  });

  it('getConversationTokenCount sums token counts', () => {
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'user',
      content: 'Hello',
      tokenCount: 50,
    });
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'assistant',
      content: 'Hi there',
      tokenCount: 100,
    });
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'system',
      content: 'System message',
    });

    const totalTokens = getConversationTokenCount(dbManager.db, conversationId);
    expect(totalTokens).toBe(150);
  });

  it('getConversationTokenCount returns 0 for empty conversation', () => {
    const totalTokens = getConversationTokenCount(dbManager.db, conversationId);
    expect(totalTokens).toBe(0);
  });

  it('deleteOldLogs keeps the most recent N logs', () => {
    for (let i = 1; i <= 10; i++) {
      appendConversationLog(dbManager.db, {
        conversationId,
        role: 'user',
        content: `Message ${i}`,
      });
    }

    const deletedCount = deleteOldLogs(dbManager.db, conversationId, 3);
    expect(deletedCount).toBe(7);

    const remaining = getConversationLogs(dbManager.db, conversationId);
    expect(remaining).toHaveLength(3);
    expect(remaining[0].content).toBe('Message 8');
    expect(remaining[1].content).toBe('Message 9');
    expect(remaining[2].content).toBe('Message 10');
  });

  it('deleteOldLogs returns 0 when nothing to delete', () => {
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'user',
      content: 'Only message',
    });

    const deletedCount = deleteOldLogs(dbManager.db, conversationId, 5);
    expect(deletedCount).toBe(0);
  });

  it('metadata is properly stored and retrieved as JSON', () => {
    const metadata = {
      model: 'claude-3',
      latencyMs: 250,
      tags: ['greeting', 'first-contact'],
    };

    const log = appendConversationLog(dbManager.db, {
      conversationId,
      role: 'assistant',
      content: 'Hello!',
      tokenCount: 5,
      metadata,
    });

    expect(log.metadata).toEqual(metadata);

    const logs = getConversationLogs(dbManager.db, conversationId);
    expect(logs[0].metadata).toEqual(metadata);
    expect(logs[0].metadata!.model).toBe('claude-3');
    expect(logs[0].metadata!.latencyMs).toBe(250);
    expect(logs[0].metadata!.tags).toEqual(['greeting', 'first-contact']);
  });

  it('supports all valid roles', () => {
    const roles = ['user', 'assistant', 'system', 'tool_call', 'tool_result'] as const;

    for (const role of roles) {
      const log = appendConversationLog(dbManager.db, {
        conversationId,
        role,
        content: `${role} content`,
      });
      expect(log.role).toBe(role);
    }

    const allLogs = getConversationLogs(dbManager.db, conversationId);
    expect(allLogs).toHaveLength(5);
  });
});
