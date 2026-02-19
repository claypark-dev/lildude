import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { createTask } from '../../../src/persistence/tasks.js';
import {
  createConversation,
  getConversation,
  updateConversationSummary,
  updateConversationKeyFacts,
  incrementMessageCount,
  getConversationsByChannel,
  deleteConversation,
} from '../../../src/persistence/conversations.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type { KeyFact } from '../../../src/types/index.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('Conversations DAL', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    dbManager.close();
  });

  it('createConversation creates with generated id', () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });

    expect(conversation.id).toBeDefined();
    expect(typeof conversation.id).toBe('string');
    expect(conversation.id.length).toBeGreaterThan(0);
    expect(conversation.channelType).toBe('discord');
    expect(conversation.channelId).toBe('channel-123');
    expect(conversation.taskId).toBeNull();
    expect(conversation.summary).toBeNull();
    expect(conversation.keyFacts).toEqual([]);
    expect(conversation.messageCount).toBe(0);
    expect(conversation.totalTokens).toBe(0);
    expect(conversation.createdAt).toBeInstanceOf(Date);
    expect(conversation.updatedAt).toBeInstanceOf(Date);
  });

  it('createConversation associates with a task when taskId provided', () => {
    const task = createTask(dbManager.db, {
      type: 'chat',
      description: 'Test task',
    });

    const conversation = createConversation(dbManager.db, {
      channelType: 'telegram',
      channelId: 'chat-456',
      taskId: task.id,
    });

    expect(conversation.taskId).toBe(task.id);
  });

  it('getConversation retrieves created conversation', () => {
    const created = createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });

    const retrieved = getConversation(dbManager.db, created.id);

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.channelType).toBe('discord');
    expect(retrieved!.channelId).toBe('channel-123');
  });

  it('getConversation returns undefined for missing id', () => {
    const result = getConversation(dbManager.db, 'nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('updateConversationSummary updates the summary', () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });

    updateConversationSummary(
      dbManager.db,
      conversation.id,
      'User asked about weather in NYC',
    );

    const updated = getConversation(dbManager.db, conversation.id);
    expect(updated!.summary).toBe('User asked about weather in NYC');
  });

  it('updateConversationKeyFacts stores and retrieves JSON key_facts', () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });

    const keyFacts: KeyFact[] = [
      { key: 'name', value: 'Alice', category: 'personal', confidence: 0.9 },
      { key: 'location', value: 'NYC', category: 'personal', source: 'user', confidence: 1.0 },
    ];

    updateConversationKeyFacts(dbManager.db, conversation.id, keyFacts);

    const updated = getConversation(dbManager.db, conversation.id);
    expect(updated!.keyFacts).toHaveLength(2);
    expect(updated!.keyFacts[0].key).toBe('name');
    expect(updated!.keyFacts[0].value).toBe('Alice');
    expect(updated!.keyFacts[0].category).toBe('personal');
    expect(updated!.keyFacts[0].confidence).toBe(0.9);
    expect(updated!.keyFacts[1].key).toBe('location');
    expect(updated!.keyFacts[1].source).toBe('user');
  });

  it('incrementMessageCount increments count and total tokens', () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });

    incrementMessageCount(dbManager.db, conversation.id, 150);
    incrementMessageCount(dbManager.db, conversation.id, 200);

    const updated = getConversation(dbManager.db, conversation.id);
    expect(updated!.messageCount).toBe(2);
    expect(updated!.totalTokens).toBe(350);
  });

  it('getConversationsByChannel returns matching conversations', () => {
    createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });
    createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });
    createConversation(dbManager.db, {
      channelType: 'telegram',
      channelId: 'chat-456',
    });

    const discordConvos = getConversationsByChannel(
      dbManager.db,
      'discord',
      'channel-123',
    );
    expect(discordConvos).toHaveLength(2);
    expect(discordConvos.every((c) => c.channelType === 'discord')).toBe(true);

    const telegramConvos = getConversationsByChannel(
      dbManager.db,
      'telegram',
      'chat-456',
    );
    expect(telegramConvos).toHaveLength(1);
  });

  it('getConversationsByChannel respects limit', () => {
    for (let i = 0; i < 5; i++) {
      createConversation(dbManager.db, {
        channelType: 'discord',
        channelId: 'channel-123',
      });
    }

    const limited = getConversationsByChannel(
      dbManager.db,
      'discord',
      'channel-123',
      2,
    );
    expect(limited).toHaveLength(2);
  });

  it('deleteConversation removes the conversation', () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });

    const deleted = deleteConversation(dbManager.db, conversation.id);
    expect(deleted).toBe(true);

    const retrieved = getConversation(dbManager.db, conversation.id);
    expect(retrieved).toBeUndefined();
  });

  it('deleteConversation returns false for nonexistent id', () => {
    const deleted = deleteConversation(dbManager.db, 'nonexistent-id');
    expect(deleted).toBe(false);
  });
});
