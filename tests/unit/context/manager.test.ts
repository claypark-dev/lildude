import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import { createConversation, updateConversationSummary } from '../../../src/persistence/conversations.js';
import { appendConversationLog } from '../../../src/persistence/conversation-logs.js';
import { upsertKnowledge } from '../../../src/persistence/knowledge.js';
import { buildContext } from '../../../src/context/manager.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('buildContext', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    dbManager.close();
  });

  it('returns a valid ContextPayload with all required fields', async () => {
    const result = await buildContext(
      dbManager.db,
      'nonexistent-convo',
      'Hello there',
    );

    expect(result).toHaveProperty('systemPrompt');
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('totalTokens');
    expect(result).toHaveProperty('knowledgeIncluded');
    expect(typeof result.systemPrompt).toBe('string');
    expect(Array.isArray(result.messages)).toBe(true);
    expect(typeof result.totalTokens).toBe('number');
    expect(Array.isArray(result.knowledgeIncluded)).toBe(true);
  });

  it('total tokens stays within the default budget', async () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'cli',
      channelId: 'test',
    });

    // Add some conversation logs
    for (let i = 0; i < 10; i++) {
      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message number ${i} with some content to take up tokens.`,
      });
    }

    const result = await buildContext(
      dbManager.db,
      conversation.id,
      'What did we discuss?',
    );

    // Default budget is 8000; totalTokens should not exceed it
    expect(result.totalTokens).toBeLessThanOrEqual(8000);
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('total tokens stays within a custom budget', async () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'cli',
      channelId: 'test',
    });

    for (let i = 0; i < 20; i++) {
      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `This is message ${i}. It contains multiple words to consume tokens appropriately.`,
      });
    }

    const customBudget = 4000;
    const result = await buildContext(
      dbManager.db,
      conversation.id,
      'Summarize our conversation',
      { targetTokenBudget: customBudget },
    );

    expect(result.totalTokens).toBeLessThanOrEqual(customBudget);
  });

  it('includes knowledge entries matching the user message', async () => {
    upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'favorite_color',
      value: 'blue',
      confidence: 0.9,
    });

    upsertKnowledge(dbManager.db, {
      category: 'personal',
      key: 'favorite_food',
      value: 'pizza',
      confidence: 0.8,
    });

    upsertKnowledge(dbManager.db, {
      category: 'work',
      key: 'company',
      value: 'Acme Corp',
      confidence: 1.0,
    });

    const result = await buildContext(
      dbManager.db,
      'new-convo',
      'What is my favorite color?',
    );

    // The search should match "favorite" and "color" in knowledge
    expect(result.knowledgeIncluded.length).toBeGreaterThan(0);
    expect(result.knowledgeIncluded).toContain('favorite_color');

    // Knowledge should appear as a system message in the context
    const systemMessages = result.messages.filter((msg) => msg.role === 'system');
    const knowledgeMessage = systemMessages.find(
      (msg) => typeof msg.content === 'string' && msg.content.includes('Known Facts'),
    );
    expect(knowledgeMessage).toBeDefined();
  });

  it('handles new conversation (no existing data) gracefully', async () => {
    const result = await buildContext(
      dbManager.db,
      'brand-new-conversation-id',
      'Hi, I am a new user!',
      { userName: 'TestUser', securityLevel: 2 },
    );

    // Should still produce a valid payload
    expect(result.systemPrompt).toContain('TestUser');
    expect(result.systemPrompt).toContain('Security Level: 2 (Careful)');

    // The user message should be the last message
    const lastMessage = result.messages[result.messages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content).toBe('Hi, I am a new user!');

    // Total tokens should be reasonable
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('includes conversation summary when available', async () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'cli',
      channelId: 'test',
    });

    updateConversationSummary(
      dbManager.db,
      conversation.id,
      'User discussed their weekend plans and asked about weather.',
    );

    const result = await buildContext(
      dbManager.db,
      conversation.id,
      'Continue our discussion',
    );

    const summaryMessage = result.messages.find(
      (msg) =>
        msg.role === 'system'
        && typeof msg.content === 'string'
        && msg.content.includes('Previous conversation summary'),
    );
    expect(summaryMessage).toBeDefined();
    expect(
      typeof summaryMessage?.content === 'string'
        && summaryMessage.content.includes('weekend plans'),
    ).toBe(true);
  });

  it('includes recent conversation logs as messages', async () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'cli',
      channelId: 'test',
    });

    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'user',
      content: 'What time is it?',
    });

    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'It is 3:00 PM.',
    });

    const result = await buildContext(
      dbManager.db,
      conversation.id,
      'And what about the weather?',
    );

    // Should include the historical user and assistant messages
    const userMessages = result.messages.filter(
      (msg) => msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes('What time'),
    );
    expect(userMessages.length).toBe(1);

    const assistantMessages = result.messages.filter(
      (msg) => msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.includes('3:00 PM'),
    );
    expect(assistantMessages.length).toBe(1);

    // The current user message should be last
    const lastMessage = result.messages[result.messages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content).toBe('And what about the weather?');
  });

  it('uses default options when none provided', async () => {
    const result = await buildContext(
      dbManager.db,
      'some-convo',
      'Test message',
    );

    // Default userName is 'User'
    expect(result.systemPrompt).toContain('for User.');
    // Default securityLevel is 3
    expect(result.systemPrompt).toContain('Security Level: 3 (Balanced)');
    // Default activeSkills is empty
    expect(result.systemPrompt).toContain('No skills currently active.');
  });

  it('passes active skills through to the system prompt', async () => {
    const result = await buildContext(
      dbManager.db,
      'some-convo',
      'Do something',
      { activeSkills: ['web-search', 'email-sender'] },
    );

    expect(result.systemPrompt).toContain('- web-search');
    expect(result.systemPrompt).toContain('- email-sender');
  });

  it('excludes tool_call and tool_result log roles from messages', async () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'cli',
      channelId: 'test',
    });

    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'user',
      content: 'Search for something',
    });

    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'tool_call',
      content: '{"name": "search", "input": {}}',
    });

    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'tool_result',
      content: '{"result": "found it"}',
    });

    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'I found the result.',
    });

    const result = await buildContext(
      dbManager.db,
      conversation.id,
      'What did you find?',
    );

    // tool_call and tool_result should not appear as messages
    const toolMessages = result.messages.filter(
      (msg) => msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system',
    );
    expect(toolMessages.length).toBe(0);
  });
});
