/**
 * Sprint 27: Context Window Non-Bloat on Reconnect
 *
 * Tests the persistence functions and schema validation that underpin the
 * chat.history feature.  When a webchat client reconnects, the server queries
 * the most recent webchat conversation, fetches its logs, and sends them back
 * so the frontend can repopulate state without duplicating messages.
 *
 * Covers:
 *  - IncomingMessageSchema validation for chat.history
 *  - getConversationsByChannel filtering for webchat
 *  - getConversationLogs retrieval, ordering, and limiting
 *  - History response shape expected by the frontend
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createDatabase } from '../../../src/persistence/db.js';
import { createConversation, getConversationsByChannel } from '../../../src/persistence/conversations.js';
import {
  appendConversationLog,
  getConversationLogs,
} from '../../../src/persistence/conversation-logs.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type { ConversationLogRow } from '../../../src/persistence/conversation-logs.js';

// ── Helpers ──────────────────────────────────────────────────────────

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

/**
 * Manually set a conversation's created_at to a specific datetime string
 * so we can deterministically control ordering in tests.
 * CURRENT_TIMESTAMP only has second-level precision, which causes
 * rows inserted within the same second to have identical timestamps.
 */
function setConversationCreatedAt(
  db: import('better-sqlite3').Database,
  conversationId: string,
  datetime: string,
): void {
  db.prepare('UPDATE conversations SET created_at = ? WHERE id = ?').run(datetime, conversationId);
}

/**
 * Recreate the IncomingMessageSchema locally so we can test its enum
 * without importing internal gateway wiring.  The enum values must stay
 * in sync with src/gateway/ws.ts.
 */
const IncomingMessageSchema = z.object({
  type: z.enum(['subscribe', 'chat.send', 'chat.history', 'approval.respond', 'task.kill']),
  payload: z.unknown(),
  timestamp: z.string().optional(),
});

/**
 * Build a history response payload in the shape the frontend expects.
 * This mirrors the structure built by the index.ts handler.
 */
function buildHistoryResponse(
  logs: ConversationLogRow[],
  conversationId: string | null,
): { messages: Array<{ id: string; text: string; role: string; timestamp: number }>; conversationId: string | null } {
  return {
    messages: logs.map((log) => ({
      id: String(log.id),
      text: log.content,
      role: log.role,
      timestamp: log.createdAt.getTime(),
    })),
    conversationId,
  };
}

// ── Schema Validation ────────────────────────────────────────────────

describe('IncomingMessageSchema — chat.history', () => {
  it('accepts a valid chat.history message with payload', () => {
    const result = IncomingMessageSchema.safeParse({
      type: 'chat.history',
      payload: { limit: 50 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('chat.history');
      expect(result.data.payload).toEqual({ limit: 50 });
    }
  });

  it('accepts chat.history with an empty payload', () => {
    const result = IncomingMessageSchema.safeParse({
      type: 'chat.history',
      payload: {},
    });

    expect(result.success).toBe(true);
  });

  it('accepts chat.history with no payload field', () => {
    const result = IncomingMessageSchema.safeParse({
      type: 'chat.history',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload).toBeUndefined();
    }
  });

  it('accepts chat.history with an optional timestamp', () => {
    const result = IncomingMessageSchema.safeParse({
      type: 'chat.history',
      payload: {},
      timestamp: '2026-03-04T12:00:00.000Z',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timestamp).toBe('2026-03-04T12:00:00.000Z');
    }
  });

  it('rejects an unknown message type', () => {
    const result = IncomingMessageSchema.safeParse({
      type: 'chat.unknown',
      payload: {},
    });

    expect(result.success).toBe(false);
  });

  it('rejects a message missing the type field', () => {
    const result = IncomingMessageSchema.safeParse({
      payload: {},
    });

    expect(result.success).toBe(false);
  });
});

// ── Webchat Conversation Retrieval ───────────────────────────────────

describe('getConversationsByChannel — webchat history', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    dbManager.close();
  });

  it('returns webchat conversations ordered by created_at DESC', () => {
    createConversation(dbManager.db, {
      id: 'conv-oldest',
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    setConversationCreatedAt(dbManager.db, 'conv-oldest', '2026-03-01T10:00:00');

    createConversation(dbManager.db, {
      id: 'conv-newest',
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    setConversationCreatedAt(dbManager.db, 'conv-newest', '2026-03-01T11:00:00');

    const conversations = getConversationsByChannel(dbManager.db, 'webchat', 'session-abc');

    expect(conversations).toHaveLength(2);
    // Most recent first (DESC)
    expect(conversations[0].id).toBe('conv-newest');
    expect(conversations[1].id).toBe('conv-oldest');
  });

  it('returns only webchat conversations, not other channel types', () => {
    createConversation(dbManager.db, {
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });
    createConversation(dbManager.db, {
      channelType: 'telegram',
      channelId: 'chat-456',
    });

    const webchatConvos = getConversationsByChannel(dbManager.db, 'webchat', 'session-abc');

    expect(webchatConvos).toHaveLength(1);
    expect(webchatConvos[0].channelType).toBe('webchat');
  });

  it('returns an empty array when no webchat conversations exist', () => {
    createConversation(dbManager.db, {
      channelType: 'discord',
      channelId: 'channel-123',
    });

    const webchatConvos = getConversationsByChannel(dbManager.db, 'webchat', 'session-abc');

    expect(webchatConvos).toHaveLength(0);
  });

  it('respects the limit parameter for webchat conversations', () => {
    for (let i = 0; i < 5; i++) {
      createConversation(dbManager.db, {
        channelType: 'webchat',
        channelId: 'session-abc',
      });
    }

    const limited = getConversationsByChannel(dbManager.db, 'webchat', 'session-abc', 2);

    expect(limited).toHaveLength(2);
  });

  it('most recent webchat conversation is first in the result', () => {
    createConversation(dbManager.db, {
      id: 'conv-a',
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    setConversationCreatedAt(dbManager.db, 'conv-a', '2026-03-01T08:00:00');

    createConversation(dbManager.db, {
      id: 'conv-b',
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    setConversationCreatedAt(dbManager.db, 'conv-b', '2026-03-01T09:00:00');

    createConversation(dbManager.db, {
      id: 'conv-c',
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    setConversationCreatedAt(dbManager.db, 'conv-c', '2026-03-01T10:00:00');

    const conversations = getConversationsByChannel(dbManager.db, 'webchat', 'session-abc', 1);

    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe('conv-c');
  });
});

// ── Conversation Log Retrieval for History ───────────────────────────

describe('getConversationLogs — history building', () => {
  let dbManager: DatabaseManager;
  let conversationId: string;

  beforeEach(() => {
    dbManager = createTestDb();
    const conversation = createConversation(dbManager.db, {
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    conversationId = conversation.id;
  });

  afterEach(() => {
    dbManager.close();
  });

  it('returns logs in chronological order (ASC by id)', () => {
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'user',
      content: 'Hello',
    });
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'assistant',
      content: 'Hi there!',
    });
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'user',
      content: 'How are you?',
    });

    const logs = getConversationLogs(dbManager.db, conversationId);

    expect(logs).toHaveLength(3);
    expect(logs[0].content).toBe('Hello');
    expect(logs[1].content).toBe('Hi there!');
    expect(logs[2].content).toBe('How are you?');
  });

  it('preserves user and assistant roles', () => {
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'user',
      content: 'Question',
    });
    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'assistant',
      content: 'Answer',
    });

    const logs = getConversationLogs(dbManager.db, conversationId);

    expect(logs[0].role).toBe('user');
    expect(logs[1].role).toBe('assistant');
  });

  it('returns an empty array for a conversation with no logs', () => {
    const logs = getConversationLogs(dbManager.db, conversationId);

    expect(logs).toHaveLength(0);
    expect(logs).toEqual([]);
  });

  it('respects the limit parameter', () => {
    for (let i = 1; i <= 20; i++) {
      appendConversationLog(dbManager.db, {
        conversationId,
        role: i % 2 === 1 ? 'user' : 'assistant',
        content: `Message ${i}`,
      });
    }

    const limited = getConversationLogs(dbManager.db, conversationId, 5);

    expect(limited).toHaveLength(5);
    expect(limited[0].content).toBe('Message 1');
    expect(limited[4].content).toBe('Message 5');
  });

  it('each log row has id, content, role, and createdAt', () => {
    const log = appendConversationLog(dbManager.db, {
      conversationId,
      role: 'user',
      content: 'Test message',
    });

    expect(typeof log.id).toBe('number');
    expect(log.content).toBe('Test message');
    expect(log.role).toBe('user');
    expect(log.createdAt).toBeInstanceOf(Date);
    expect(log.conversationId).toBe(conversationId);
  });

  it('returns logs only for the specified conversation', () => {
    const otherConvo = createConversation(dbManager.db, {
      channelType: 'webchat',
      channelId: 'session-abc',
    });

    appendConversationLog(dbManager.db, {
      conversationId,
      role: 'user',
      content: 'In first conversation',
    });
    appendConversationLog(dbManager.db, {
      conversationId: otherConvo.id,
      role: 'user',
      content: 'In second conversation',
    });

    const logs = getConversationLogs(dbManager.db, conversationId);

    expect(logs).toHaveLength(1);
    expect(logs[0].content).toBe('In first conversation');
  });
});

// ── History Response Format ──────────────────────────────────────────

describe('History response format', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    dbManager.close();
  });

  it('builds a response with messages array and conversationId', () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'webchat',
      channelId: 'session-abc',
    });

    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'user',
      content: 'Hello',
    });
    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Hi!',
    });

    const logs = getConversationLogs(dbManager.db, conversation.id);
    const response = buildHistoryResponse(logs, conversation.id);

    expect(response.conversationId).toBe(conversation.id);
    expect(response.messages).toHaveLength(2);
  });

  it('each history message has id, text, role, and timestamp fields', () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'webchat',
      channelId: 'session-abc',
    });

    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'user',
      content: 'What time is it?',
    });

    const logs = getConversationLogs(dbManager.db, conversation.id);
    const response = buildHistoryResponse(logs, conversation.id);
    const message = response.messages[0];

    expect(message).toHaveProperty('id');
    expect(message).toHaveProperty('text');
    expect(message).toHaveProperty('role');
    expect(message).toHaveProperty('timestamp');

    expect(typeof message.id).toBe('string');
    expect(typeof message.text).toBe('string');
    expect(typeof message.role).toBe('string');
    expect(typeof message.timestamp).toBe('number');
  });

  it('maps log content to message text correctly', () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'webchat',
      channelId: 'session-abc',
    });

    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'The answer is 42.',
    });

    const logs = getConversationLogs(dbManager.db, conversation.id);
    const response = buildHistoryResponse(logs, conversation.id);

    expect(response.messages[0].text).toBe('The answer is 42.');
    expect(response.messages[0].role).toBe('assistant');
  });

  it('returns null conversationId when no conversation exists', () => {
    const response = buildHistoryResponse([], null);

    expect(response.conversationId).toBeNull();
    expect(response.messages).toEqual([]);
  });

  it('timestamp is a numeric epoch value', () => {
    const conversation = createConversation(dbManager.db, {
      channelType: 'webchat',
      channelId: 'session-abc',
    });

    appendConversationLog(dbManager.db, {
      conversationId: conversation.id,
      role: 'user',
      content: 'Ping',
    });

    const logs = getConversationLogs(dbManager.db, conversation.id);
    const response = buildHistoryResponse(logs, conversation.id);

    const timestamp = response.messages[0].timestamp;
    expect(Number.isFinite(timestamp)).toBe(true);
    expect(timestamp).toBeGreaterThan(0);
    // Should be a reasonable epoch (after 2020-01-01)
    expect(timestamp).toBeGreaterThan(new Date('2020-01-01').getTime());
  });
});

// ── End-to-End History Flow (persistence layer) ──────────────────────

describe('End-to-end webchat history retrieval', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    dbManager.close();
  });

  it('retrieves history from the most recent webchat conversation', () => {
    // Create an older conversation with messages
    const oldConvo = createConversation(dbManager.db, {
      id: 'conv-old',
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    setConversationCreatedAt(dbManager.db, 'conv-old', '2026-03-01T08:00:00');
    appendConversationLog(dbManager.db, {
      conversationId: oldConvo.id,
      role: 'user',
      content: 'Old message',
    });

    // Create a newer conversation with messages
    const newConvo = createConversation(dbManager.db, {
      id: 'conv-new',
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    setConversationCreatedAt(dbManager.db, 'conv-new', '2026-03-01T12:00:00');
    appendConversationLog(dbManager.db, {
      conversationId: newConvo.id,
      role: 'user',
      content: 'New message 1',
    });
    appendConversationLog(dbManager.db, {
      conversationId: newConvo.id,
      role: 'assistant',
      content: 'New reply 1',
    });

    // Simulate the history handler: get most recent webchat convo, then its logs
    const conversations = getConversationsByChannel(dbManager.db, 'webchat', 'session-abc', 1);
    expect(conversations).toHaveLength(1);

    const mostRecent = conversations[0];
    expect(mostRecent.id).toBe('conv-new');

    const logs = getConversationLogs(dbManager.db, mostRecent.id);
    const response = buildHistoryResponse(logs, mostRecent.id);

    expect(response.conversationId).toBe('conv-new');
    expect(response.messages).toHaveLength(2);
    expect(response.messages[0].text).toBe('New message 1');
    expect(response.messages[0].role).toBe('user');
    expect(response.messages[1].text).toBe('New reply 1');
    expect(response.messages[1].role).toBe('assistant');
  });

  it('returns empty history when there are no webchat conversations', () => {
    const conversations = getConversationsByChannel(dbManager.db, 'webchat', 'session-abc', 1);
    expect(conversations).toHaveLength(0);

    const response = buildHistoryResponse([], null);

    expect(response.conversationId).toBeNull();
    expect(response.messages).toEqual([]);
  });

  it('limits large history to the requested number of messages', () => {
    const convo = createConversation(dbManager.db, {
      channelType: 'webchat',
      channelId: 'session-abc',
    });

    // Insert 50 messages
    for (let i = 1; i <= 50; i++) {
      appendConversationLog(dbManager.db, {
        conversationId: convo.id,
        role: i % 2 === 1 ? 'user' : 'assistant',
        content: `Message ${i}`,
      });
    }

    // Simulate a limited history request (e.g. last 10 messages)
    const logs = getConversationLogs(dbManager.db, convo.id, 10);
    const response = buildHistoryResponse(logs, convo.id);

    expect(response.messages).toHaveLength(10);
    // Logs are ordered ASC by id, so with limit=10 we get the first 10
    expect(response.messages[0].text).toBe('Message 1');
    expect(response.messages[9].text).toBe('Message 10');
  });

  it('does not mix logs from different conversations in history', () => {
    const convoA = createConversation(dbManager.db, {
      id: 'conv-a',
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    setConversationCreatedAt(dbManager.db, 'conv-a', '2026-03-01T08:00:00');

    const convoB = createConversation(dbManager.db, {
      id: 'conv-b',
      channelType: 'webchat',
      channelId: 'session-abc',
    });
    setConversationCreatedAt(dbManager.db, 'conv-b', '2026-03-01T12:00:00');

    appendConversationLog(dbManager.db, {
      conversationId: convoA.id,
      role: 'user',
      content: 'From conversation A',
    });
    appendConversationLog(dbManager.db, {
      conversationId: convoB.id,
      role: 'user',
      content: 'From conversation B',
    });

    // Get most recent conversation (conv-b has later created_at)
    const conversations = getConversationsByChannel(dbManager.db, 'webchat', 'session-abc', 1);
    const mostRecent = conversations[0];
    expect(mostRecent.id).toBe('conv-b');

    const logs = getConversationLogs(dbManager.db, mostRecent.id);
    const response = buildHistoryResponse(logs, mostRecent.id);

    expect(response.messages).toHaveLength(1);
    expect(response.messages[0].text).toBe('From conversation B');
  });

  it('history preserves all five valid log roles', () => {
    const convo = createConversation(dbManager.db, {
      channelType: 'webchat',
      channelId: 'session-abc',
    });

    const roles = ['user', 'assistant', 'system', 'tool_call', 'tool_result'] as const;
    for (const role of roles) {
      appendConversationLog(dbManager.db, {
        conversationId: convo.id,
        role,
        content: `${role} content`,
      });
    }

    const logs = getConversationLogs(dbManager.db, convo.id);
    const response = buildHistoryResponse(logs, convo.id);

    expect(response.messages).toHaveLength(5);
    const responseRoles = response.messages.map((m) => m.role);
    expect(responseRoles).toEqual(['user', 'assistant', 'system', 'tool_call', 'tool_result']);
  });
});
