import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import { createConversation } from '../../../src/persistence/conversations.js';
import { getConversation } from '../../../src/persistence/conversations.js';
import {
  appendConversationLog,
  getConversationLogs,
} from '../../../src/persistence/conversation-logs.js';
import { getKnowledgeByCategory } from '../../../src/persistence/knowledge.js';
import { createMockProvider } from '../../mocks/provider.js';
import type { MockProvider } from '../../mocks/provider.js';
import type { ChatResponse } from '../../../src/types/index.js';
import {
  needsSummarization,
  summarizeConversation,
  extractKeyFacts,
} from '../../../src/context/summarizer.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

/**
 * Build a mock ChatResponse that mimics the structured summarization output.
 */
function buildSummaryResponse(
  summary: string,
  facts: Array<{ key: string; value: string; confidence: number }>,
): ChatResponse {
  const factLines = facts
    .map((f) => `FACT: ${f.key} = ${f.value} (confidence: ${f.confidence})`)
    .join('\n');

  const text = `SUMMARY:\n${summary}\n\nKEY_FACTS:\n${factLines}`;

  return {
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens: 500, outputTokens: 200 },
    stopReason: 'end_turn',
  };
}

/**
 * Create a conversation with enough logged tokens to exceed a given threshold.
 * Each log entry is given an explicit tokenCount so the DB sum crosses the limit.
 */
function seedConversationOverThreshold(
  db: DatabaseManager['db'],
  conversationId: string,
  targetTokens: number,
  messageCount: number,
): void {
  const tokensPerMessage = Math.ceil(targetTokens / messageCount);

  for (let i = 0; i < messageCount; i++) {
    appendConversationLog(db, {
      conversationId,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: ${'word '.repeat(40)}`,
      tokenCount: tokensPerMessage,
    });
  }
}

describe('Conversation Summarizer', () => {
  let dbManager: DatabaseManager;
  let provider: MockProvider;

  beforeEach(() => {
    dbManager = createTestDb();
    provider = createMockProvider();
  });

  afterEach(() => {
    dbManager.close();
  });

  // --- needsSummarization ---

  describe('needsSummarization', () => {
    it('returns false when conversation tokens are below threshold', () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      // Add a few small log entries
      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'user',
        content: 'Hello',
        tokenCount: 100,
      });
      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'assistant',
        content: 'Hi there!',
        tokenCount: 100,
      });

      expect(needsSummarization(dbManager.db, conversation.id)).toBe(false);
    });

    it('returns true when conversation tokens exceed threshold', () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      expect(needsSummarization(dbManager.db, conversation.id)).toBe(true);
    });

    it('respects custom threshold parameter', () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'user',
        content: 'Short message',
        tokenCount: 500,
      });

      // Default threshold (4000) should not trigger
      expect(needsSummarization(dbManager.db, conversation.id)).toBe(false);

      // Custom lower threshold should trigger
      expect(needsSummarization(dbManager.db, conversation.id, 100)).toBe(true);
    });
  });

  // --- summarizeConversation ---

  describe('summarizeConversation', () => {
    it('skips summarization when conversation is under threshold', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'user',
        content: 'Short conversation',
        tokenCount: 100,
      });

      const result = await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
      );

      expect(result.summarized).toBe(false);
      expect(result.skipReason).toBe('below_threshold');
      expect(result.keyFacts).toEqual([]);
      expect(provider.getCalls()).toHaveLength(0);
    });

    it('triggers summarization when conversation exceeds threshold', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      const mockResponse = buildSummaryResponse(
        'The user discussed project planning and deadlines.',
        [
          { key: 'project_name', value: 'Lil Dude', confidence: 0.95 },
          { key: 'deadline', value: '2026-03-01', confidence: 0.9 },
        ],
      );
      provider.setDefault(mockResponse);

      const result = await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
      );

      expect(result.summarized).toBe(true);
      expect(result.summary).toBe(
        'The user discussed project planning and deadlines.',
      );
      expect(result.keyFacts).toHaveLength(2);
      expect(result.keyFacts[0].key).toBe('project_name');
      expect(result.keyFacts[0].value).toBe('Lil Dude');
      expect(result.keyFacts[1].key).toBe('deadline');

      // Verify the provider was called exactly once
      expect(provider.getCalls()).toHaveLength(1);
    });

    it('stores summary in conversations table', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      const mockResponse = buildSummaryResponse(
        'User asked about weather and travel plans.',
        [],
      );
      provider.setDefault(mockResponse);

      await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
      );

      const updated = getConversation(dbManager.db, conversation.id);
      expect(updated).toBeDefined();
      expect(updated!.summary).toBe('User asked about weather and travel plans.');
    });

    it('stores key facts in knowledge table', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      const mockResponse = buildSummaryResponse(
        'Discussion about personal preferences.',
        [
          { key: 'favorite_color', value: 'blue', confidence: 0.85 },
          { key: 'user_name', value: 'Alice', confidence: 0.95 },
        ],
      );
      provider.setDefault(mockResponse);

      await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
      );

      const knowledgeEntries = getKnowledgeByCategory(dbManager.db, 'conversation_fact');
      expect(knowledgeEntries).toHaveLength(2);

      const colorFact = knowledgeEntries.find((entry) => entry.key === 'favorite_color');
      expect(colorFact).toBeDefined();
      expect(colorFact!.value).toBe('blue');
      expect(colorFact!.sourceConversationId).toBe(conversation.id);
      expect(colorFact!.confidence).toBeCloseTo(0.85);

      const nameFact = knowledgeEntries.find((entry) => entry.key === 'user_name');
      expect(nameFact).toBeDefined();
      expect(nameFact!.value).toBe('Alice');
    });

    it('preserves full raw logs in conversation_logs after summarization', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      // Add specific logs we can verify later
      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'user',
        content: 'First message content',
        tokenCount: 2500,
      });
      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'assistant',
        content: 'First response content',
        tokenCount: 2500,
      });

      const mockResponse = buildSummaryResponse('Summary of first exchange.', []);
      provider.setDefault(mockResponse);

      await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
      );

      // Verify all raw logs are still intact
      const logs = getConversationLogs(dbManager.db, conversation.id);
      expect(logs).toHaveLength(2);
      expect(logs[0].content).toBe('First message content');
      expect(logs[0].role).toBe('user');
      expect(logs[1].content).toBe('First response content');
      expect(logs[1].role).toBe('assistant');
    });

    it('skips summarization when budget is exceeded', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      const result = await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
        {
          taskSpentUsd: 0.099,
          taskBudgetUsd: 0.10,
        },
      );

      expect(result.summarized).toBe(false);
      expect(result.skipReason).toBe('budget_exceeded');
      expect(result.keyFacts).toEqual([]);

      // Verify the provider was NOT called
      expect(provider.getCalls()).toHaveLength(0);

      // Verify no summary was stored
      const convo = getConversation(dbManager.db, conversation.id);
      expect(convo!.summary).toBeNull();
    });

    it('uses custom model when provided in options', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      const mockResponse = buildSummaryResponse('Summary text.', []);
      provider.setDefault(mockResponse);

      await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
        { model: 'gpt-4o-mini' },
      );

      const calls = provider.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].options.model).toBe('gpt-4o-mini');
    });

    it('uses small model by default for cost efficiency', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      const mockResponse = buildSummaryResponse('Summary.', []);
      provider.setDefault(mockResponse);

      await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
      );

      const calls = provider.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].options.model).toBe('claude-haiku-4-5-20251001');
    });

    it('handles empty LLM response gracefully', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      const emptyResponse: ChatResponse = {
        content: [{ type: 'text', text: '' }],
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 100, outputTokens: 0 },
        stopReason: 'end_turn',
      };
      provider.setDefault(emptyResponse);

      const result = await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
      );

      expect(result.summarized).toBe(false);
      expect(result.skipReason).toBe('empty_response');
    });
  });

  // --- extractKeyFacts ---

  describe('extractKeyFacts', () => {
    it('extracts facts from well-formatted text', () => {
      const text = `SUMMARY:
Some summary text.

KEY_FACTS:
FACT: user_name = Alice (confidence: 0.95)
FACT: location = New York (confidence: 0.8)
FACT: meeting_date = 2026-03-15 (confidence: 0.9)`;

      const facts = extractKeyFacts(text);

      expect(facts).toHaveLength(3);
      expect(facts[0].key).toBe('user_name');
      expect(facts[0].value).toBe('Alice');
      expect(facts[0].confidence).toBeCloseTo(0.95);
      expect(facts[0].category).toBe('conversation_fact');
      expect(facts[0].source).toBe('summarizer');

      expect(facts[1].key).toBe('location');
      expect(facts[1].value).toBe('New York');
      expect(facts[1].confidence).toBeCloseTo(0.8);

      expect(facts[2].key).toBe('meeting_date');
      expect(facts[2].value).toBe('2026-03-15');
    });

    it('returns empty array when no facts are present', () => {
      const text = `SUMMARY:
Just a summary with no facts section.`;

      const facts = extractKeyFacts(text);
      expect(facts).toEqual([]);
    });

    it('defaults confidence to 0.8 when not specified', () => {
      const text = `KEY_FACTS:
FACT: color = red`;

      const facts = extractKeyFacts(text);

      expect(facts).toHaveLength(1);
      expect(facts[0].confidence).toBeCloseTo(0.8);
    });

    it('clamps confidence values to valid range', () => {
      const text = `KEY_FACTS:
FACT: high = value (confidence: 1.5)
FACT: low = value (confidence: -0.3)`;

      const facts = extractKeyFacts(text);

      expect(facts).toHaveLength(2);
      expect(facts[0].confidence).toBe(1.0);
      expect(facts[1].confidence).toBe(0);
    });

    it('handles facts with extra whitespace', () => {
      const text = `KEY_FACTS:
FACT:   spaced_key   =   spaced value   (confidence: 0.7)`;

      const facts = extractKeyFacts(text);

      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('spaced_key');
      expect(facts[0].value).toBe('spaced value');
    });
  });
});
