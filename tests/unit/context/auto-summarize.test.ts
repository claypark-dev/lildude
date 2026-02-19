/**
 * Tests for auto-summarization wiring in the agent loop.
 * Verifies that summarization triggers at the right thresholds,
 * that key facts are extracted on task completion, and that
 * budget-exceeded conversations skip summarization.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import { createConversation } from '../../../src/persistence/conversations.js';
import {
  appendConversationLog,
} from '../../../src/persistence/conversation-logs.js';
import { getKnowledgeByCategory } from '../../../src/persistence/knowledge.js';
import { createMockProvider } from '../../mocks/provider.js';
import type { MockProvider } from '../../mocks/provider.js';
import type { ChatResponse, LLMProvider } from '../../../src/types/index.js';
import {
  needsSummarization,
  summarizeConversation,
} from '../../../src/context/summarizer.js';
import {
  triggerSummarizationIfNeeded,
  extractKeyFactsOnTaskCompletion,
} from '../../../src/orchestrator/agent-loop-helpers.js';

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
 * Seed a conversation with enough logged tokens to exceed a given threshold.
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

/**
 * Seed conversation logs that contain FACT: patterns for deterministic extraction.
 */
function seedConversationWithFacts(
  db: DatabaseManager['db'],
  conversationId: string,
): void {
  appendConversationLog(db, {
    conversationId,
    role: 'user',
    content: 'Tell me about my project preferences.',
    tokenCount: 50,
  });
  appendConversationLog(db, {
    conversationId,
    role: 'assistant',
    content: [
      'Here are the details I gathered:',
      'FACT: preferred_language = TypeScript (confidence: 0.95)',
      'FACT: deployment_target = AWS Lambda (confidence: 0.85)',
      'FACT: testing_framework = Vitest (confidence: 0.9)',
    ].join('\n'),
    tokenCount: 100,
  });
}

describe('Auto-Summarization Wiring', () => {
  let dbManager: DatabaseManager;
  let provider: MockProvider;

  beforeEach(() => {
    dbManager = createTestDb();
    provider = createMockProvider();
  });

  afterEach(() => {
    dbManager.close();
  });

  // --- Summarization triggers when conversation exceeds 4000 tokens ---

  describe('summarization triggers at threshold', () => {
    it('triggers summarization when conversation exceeds 4000 tokens', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test-auto',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      // Verify the threshold check detects it
      expect(needsSummarization(dbManager.db, conversation.id)).toBe(true);

      // Set up mock response for the summarization LLM call
      const mockResponse = buildSummaryResponse(
        'The user discussed their project setup.',
        [
          { key: 'project_type', value: 'web app', confidence: 0.9 },
        ],
      );
      provider.setDefault(mockResponse);

      const result = await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
      );

      expect(result.summarized).toBe(true);
      expect(result.summary).toBe('The user discussed their project setup.');
      expect(result.keyFacts).toHaveLength(1);
      expect(provider.getCalls()).toHaveLength(1);
    });

    it('skips summarization when under threshold', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test-auto',
      });

      // Add only a small amount of tokens (well under 4000)
      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'user',
        content: 'Quick question',
        tokenCount: 200,
      });
      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'assistant',
        content: 'Quick answer',
        tokenCount: 200,
      });

      expect(needsSummarization(dbManager.db, conversation.id)).toBe(false);

      const result = await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
      );

      expect(result.summarized).toBe(false);
      expect(result.skipReason).toBe('below_threshold');
      expect(provider.getCalls()).toHaveLength(0);
    });
  });

  // --- triggerSummarizationIfNeeded fires asynchronously ---

  describe('triggerSummarizationIfNeeded', () => {
    it('fires summarization asynchronously when above threshold', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test-trigger',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      const mockResponse = buildSummaryResponse('Async summary result.', []);
      provider.setDefault(mockResponse);

      // This fires and forgets — we need to wait for the internal promise
      triggerSummarizationIfNeeded(
        dbManager.db,
        conversation.id,
        provider,
        0.01,
        0.50,
      );

      // Wait for the background promise to resolve
      await vi.waitFor(() => {
        expect(provider.getCalls().length).toBeGreaterThan(0);
      });
    });

    it('does not fire summarization when under threshold', () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test-trigger-skip',
      });

      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'user',
        content: 'Short chat',
        tokenCount: 100,
      });

      triggerSummarizationIfNeeded(
        dbManager.db,
        conversation.id,
        provider,
        0,
        0.50,
      );

      // Provider should not be called since we're under threshold
      expect(provider.getCalls()).toHaveLength(0);
    });
  });

  // --- Budget-exceeded conversations are NOT summarized ---

  describe('budget-exceeded conversations', () => {
    it('skips summarization when task budget is exceeded', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test-budget',
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
      expect(provider.getCalls()).toHaveLength(0);
    });

    it('skips summarization when budget is exactly zero remaining', async () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test-budget-zero',
      });

      seedConversationOverThreshold(dbManager.db, conversation.id, 5000, 10);

      const result = await summarizeConversation(
        dbManager.db,
        conversation.id,
        provider,
        {
          taskSpentUsd: 0.10,
          taskBudgetUsd: 0.10,
        },
      );

      expect(result.summarized).toBe(false);
      expect(result.skipReason).toBe('budget_exceeded');
    });
  });

  // --- Key facts extracted and stored after task completion ---

  describe('extractKeyFactsOnTaskCompletion', () => {
    it('extracts and stores key facts from conversation logs', () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test-facts',
      });

      seedConversationWithFacts(dbManager.db, conversation.id);

      extractKeyFactsOnTaskCompletion(dbManager.db, conversation.id);

      const facts = getKnowledgeByCategory(dbManager.db, 'task_completion_fact');
      expect(facts).toHaveLength(3);

      const langFact = facts.find((f) => f.key === 'preferred_language');
      expect(langFact).toBeDefined();
      expect(langFact!.value).toBe('TypeScript');
      expect(langFact!.confidence).toBeCloseTo(0.95);
      expect(langFact!.sourceConversationId).toBe(conversation.id);

      const deployFact = facts.find((f) => f.key === 'deployment_target');
      expect(deployFact).toBeDefined();
      expect(deployFact!.value).toBe('AWS Lambda');

      const testFact = facts.find((f) => f.key === 'testing_framework');
      expect(testFact).toBeDefined();
      expect(testFact!.value).toBe('Vitest');
    });

    it('does nothing when conversation has no logs', () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test-empty',
      });

      // Should not throw
      extractKeyFactsOnTaskCompletion(dbManager.db, conversation.id);

      const facts = getKnowledgeByCategory(dbManager.db, 'task_completion_fact');
      expect(facts).toHaveLength(0);
    });

    it('does nothing when conversation logs have no FACT patterns', () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test-no-facts',
      });

      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'user',
        content: 'Just a regular question',
        tokenCount: 50,
      });
      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'assistant',
        content: 'Just a regular answer without any structured facts',
        tokenCount: 80,
      });

      extractKeyFactsOnTaskCompletion(dbManager.db, conversation.id);

      const facts = getKnowledgeByCategory(dbManager.db, 'task_completion_fact');
      expect(facts).toHaveLength(0);
    });

    it('only scans the most recent 10 messages', () => {
      const conversation = createConversation(dbManager.db, {
        channelType: 'cli',
        channelId: 'test-recent-only',
      });

      // Add 12 messages without facts first
      for (let i = 0; i < 12; i++) {
        appendConversationLog(dbManager.db, {
          conversationId: conversation.id,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Old message ${i} with no structured data`,
          tokenCount: 50,
        });
      }

      // Add a fact in message 13 (within last 10)
      appendConversationLog(dbManager.db, {
        conversationId: conversation.id,
        role: 'assistant',
        content: 'FACT: recent_key = recent_value (confidence: 0.88)',
        tokenCount: 50,
      });

      extractKeyFactsOnTaskCompletion(dbManager.db, conversation.id);

      const facts = getKnowledgeByCategory(dbManager.db, 'task_completion_fact');
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('recent_key');
      expect(facts[0].value).toBe('recent_value');
    });

    it('handles errors gracefully without throwing', () => {
      // Pass a non-existent conversation ID — should not throw
      expect(() => {
        extractKeyFactsOnTaskCompletion(dbManager.db, 'non-existent-id');
      }).not.toThrow();
    });
  });
});
