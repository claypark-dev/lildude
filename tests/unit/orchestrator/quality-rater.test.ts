import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';
import type { LLMProvider, ChatResponse, Message, ChatOptions, StreamChunk, ModelTier } from '../../../src/types/index.js';
import { createQualityRater } from '../../../src/orchestrator/quality-rater.js';
import { runPostTaskQualityCheck } from '../../../src/orchestrator/quality-checker.js';
import {
  buildRatingPrompt,
  parseRatingResponse,
  RETRY_THRESHOLD,
  MAX_RETRIES,
  RATING_MAX_TOKENS,
} from '../../../src/orchestrator/quality-rater-helpers.js';
import type {
  QualityRaterDeps,
  RateInput,
} from '../../../src/orchestrator/quality-rater-helpers.js';
import { createTask } from '../../../src/persistence/tasks.js';
import { recordRoutingDecision, recordQualityFeedback } from '../../../src/persistence/routing-history.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

function createMockProvider(responseText: string, model: string = 'claude-sonnet-4-5-20250929'): LLMProvider {
  return {
    name: 'mock',
    async chat(_messages: Message[], _options: ChatOptions): Promise<ChatResponse> {
      return {
        content: [{ type: 'text', text: responseText }],
        model,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
        stopReason: 'end_turn',
      };
    },
    async *chatStream(_messages: Message[], _options: ChatOptions): AsyncGenerator<StreamChunk> {
      yield { type: 'text_delta', text: responseText };
      yield { type: 'message_stop' };
    },
    countTokens(text: string): number {
      return Math.ceil(text.length / 4);
    },
  };
}

describe('Quality Rater Helpers', () => {
  describe('buildRatingPrompt', () => {
    it('formats the prompt with user message and assistant response', () => {
      const prompt = buildRatingPrompt('What is 2+2?', 'The answer is 4.');
      expect(prompt).toContain('User asked: What is 2+2?');
      expect(prompt).toContain('Assistant replied: The answer is 4.');
      expect(prompt).toContain('Rate this AI assistant');
      expect(prompt).toContain('Reply with JSON');
    });

    it('handles empty inputs gracefully', () => {
      const prompt = buildRatingPrompt('', '');
      expect(prompt).toContain('User asked: ');
      expect(prompt).toContain('Assistant replied: ');
    });
  });

  describe('parseRatingResponse', () => {
    it('parses valid JSON with score and feedback', () => {
      const result = parseRatingResponse('{"score": 0.85, "feedback": "Good response"}');
      expect(result.score).toBe(0.85);
      expect(result.feedback).toBe('Good response');
    });

    it('extracts JSON from surrounding text', () => {
      const result = parseRatingResponse('Here is my rating: {"score": 0.7, "feedback": "Decent"} end.');
      expect(result.score).toBe(0.7);
      expect(result.feedback).toBe('Decent');
    });

    it('clamps score above 1 to 1', () => {
      const result = parseRatingResponse('{"score": 1.5, "feedback": "Over max"}');
      expect(result.score).toBe(1);
    });

    it('clamps score below 0 to 0', () => {
      const result = parseRatingResponse('{"score": -0.3, "feedback": "Under min"}');
      expect(result.score).toBe(0);
    });

    it('defaults to 0.5 for completely invalid JSON', () => {
      const result = parseRatingResponse('This is not JSON at all');
      expect(result.score).toBe(0.5);
      expect(result.feedback).toBe('Malformed rating response');
    });

    it('defaults to 0.5 when JSON has no score field', () => {
      const result = parseRatingResponse('{"rating": 0.8, "feedback": "Good"}');
      expect(result.score).toBe(0.5);
      expect(result.feedback).toContain('Could not parse');
    });

    it('provides default feedback when feedback field is missing', () => {
      const result = parseRatingResponse('{"score": 0.6}');
      expect(result.score).toBe(0.6);
      expect(result.feedback).toBe('No feedback provided');
    });
  });

  describe('constants', () => {
    it('RETRY_THRESHOLD is 0.4', () => {
      expect(RETRY_THRESHOLD).toBe(0.4);
    });

    it('MAX_RETRIES is 1', () => {
      expect(MAX_RETRIES).toBe(1);
    });

    it('RATING_MAX_TOKENS is 256', () => {
      expect(RATING_MAX_TOKENS).toBe(256);
    });
  });
});

describe('Quality Rater', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;
  let taskId: string;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
    const task = createTask(db, { type: 'chat', description: 'test task' });
    taskId = task.id;
    // Record a routing decision so recordQualityFeedback can update it
    recordRoutingDecision(db, {
      taskId,
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      tier: 'small',
      taskType: 'chat',
    });
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  describe('shouldRate', () => {
    it('returns true for small tier', () => {
      const provider = createMockProvider('{"score": 0.8, "feedback": "Good"}');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });
      expect(rater.shouldRate('small', 'claude-haiku-4-5-20251001')).toBe(true);
    });

    it('returns false for medium tier', () => {
      const provider = createMockProvider('{"score": 0.8, "feedback": "Good"}');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });
      expect(rater.shouldRate('medium', 'claude-sonnet-4-5-20250929')).toBe(false);
    });

    it('returns false for large tier', () => {
      const provider = createMockProvider('{"score": 0.8, "feedback": "Good"}');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });
      expect(rater.shouldRate('large', 'claude-opus-4-6')).toBe(false);
    });
  });

  describe('rateOutput', () => {
    it('returns a valid rating for a successful call', async () => {
      const provider = createMockProvider('{"score": 0.85, "feedback": "Well structured response"}');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });

      const result = await rater.rateOutput({
        taskId,
        userMessage: 'What is TypeScript?',
        assistantResponse: 'TypeScript is a typed superset of JavaScript.',
        model: 'claude-haiku-4-5-20251001',
        tier: 'small',
      });

      expect(result.score).toBe(0.85);
      expect(result.feedback).toBe('Well structured response');
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.costUsd).toBeGreaterThanOrEqual(0);
    });

    it('defaults to score 0.5 when LLM returns malformed JSON', async () => {
      const provider = createMockProvider('I cannot rate this properly, sorry!');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });

      const result = await rater.rateOutput({
        taskId,
        userMessage: 'Hello',
        assistantResponse: 'Hi there!',
        model: 'claude-haiku-4-5-20251001',
        tier: 'small',
      });

      expect(result.score).toBe(0.5);
      expect(result.feedback).toBe('Malformed rating response');
    });

    it('skips rating when budget is too tight', async () => {
      const provider = createMockProvider('{"score": 0.9, "feedback": "Great"}');
      // Set budget to essentially zero
      const rater = createQualityRater({ db, provider, costBudgetUsd: 0.0 });

      const result = await rater.rateOutput({
        taskId,
        userMessage: 'Test',
        assistantResponse: 'Response',
        model: 'claude-haiku-4-5-20251001',
        tier: 'small',
      });

      expect(result.score).toBe(0.5);
      expect(result.feedback).toContain('budget');
      expect(result.ratingModel).toBe('none');
      expect(result.costUsd).toBe(0);
    });

    it('handles provider errors gracefully', async () => {
      const errorProvider: LLMProvider = {
        name: 'error-mock',
        async chat(): Promise<ChatResponse> {
          throw new Error('Provider is down');
        },
        async *chatStream(): AsyncGenerator<StreamChunk> {
          throw new Error('Provider is down');
        },
        countTokens(): number {
          return 10;
        },
      };
      const rater = createQualityRater({ db, provider: errorProvider, costBudgetUsd: 1.0 });

      const result = await rater.rateOutput({
        taskId,
        userMessage: 'Test',
        assistantResponse: 'Response',
        model: 'claude-haiku-4-5-20251001',
        tier: 'small',
      });

      expect(result.score).toBe(0.5);
      expect(result.feedback).toContain('Rating failed');
      expect(result.ratingModel).toBe('none');
    });

    it('stores quality feedback in routing history after rating', async () => {
      const provider = createMockProvider('{"score": 0.75, "feedback": "Acceptable quality"}');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });

      await rater.rateOutput({
        taskId,
        userMessage: 'Test question',
        assistantResponse: 'Test answer',
        model: 'claude-haiku-4-5-20251001',
        tier: 'small',
      });

      // Verify the quality feedback was stored
      const row = db.prepare(
        'SELECT quality_score, feedback FROM routing_history WHERE task_id = ?',
      ).get(taskId) as { quality_score: number | null; feedback: string | null } | undefined;

      expect(row).toBeDefined();
      expect(row!.quality_score).toBe(0.75);
      expect(row!.feedback).toBe('Acceptable quality');
    });
  });

  describe('shouldRetry', () => {
    it('returns true when score < 0.4 and retryCount < 1', () => {
      const provider = createMockProvider('{}');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });

      const shouldRetry = rater.shouldRetry({
        score: 0.2,
        feedback: 'Poor quality',
        ratingModel: 'test',
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      }, 0);

      expect(shouldRetry).toBe(true);
    });

    it('returns false when score >= 0.4', () => {
      const provider = createMockProvider('{}');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });

      const shouldRetry = rater.shouldRetry({
        score: 0.4,
        feedback: 'Acceptable',
        ratingModel: 'test',
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      }, 0);

      expect(shouldRetry).toBe(false);
    });

    it('returns false when score is exactly at threshold', () => {
      const provider = createMockProvider('{}');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });

      const shouldRetry = rater.shouldRetry({
        score: RETRY_THRESHOLD,
        feedback: 'At threshold',
        ratingModel: 'test',
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      }, 0);

      expect(shouldRetry).toBe(false);
    });

    it('returns false when retryCount >= 1', () => {
      const provider = createMockProvider('{}');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });

      const shouldRetry = rater.shouldRetry({
        score: 0.1,
        feedback: 'Very poor but already retried',
        ratingModel: 'test',
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      }, 1);

      expect(shouldRetry).toBe(false);
    });

    it('returns false when retryCount exceeds MAX_RETRIES', () => {
      const provider = createMockProvider('{}');
      const rater = createQualityRater({ db, provider, costBudgetUsd: 1.0 });

      const shouldRetry = rater.shouldRetry({
        score: 0.0,
        feedback: 'Terrible',
        ratingModel: 'test',
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      }, 5);

      expect(shouldRetry).toBe(false);
    });
  });
});

describe('Quality Checker (runPostTaskQualityCheck)', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;
  let taskId: string;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
    const task = createTask(db, { type: 'chat', description: 'test task' });
    taskId = task.id;
    recordRoutingDecision(db, {
      taskId,
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      tier: 'small',
      taskType: 'chat',
    });
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  it('skips rating for medium-tier models', async () => {
    const provider = createMockProvider('{"score": 0.9, "feedback": "Great"}');
    const result = await runPostTaskQualityCheck(
      db, taskId, 'test', 'response',
      { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', tier: 'medium', estimatedCostUsd: 0, reasoning: '' },
      provider, 0.01, 0.50,
    );

    expect(result.rated).toBe(false);
    expect(result.shouldRetry).toBe(false);
  });

  it('skips rating for large-tier models', async () => {
    const provider = createMockProvider('{"score": 0.9, "feedback": "Great"}');
    const result = await runPostTaskQualityCheck(
      db, taskId, 'test', 'response',
      { provider: 'anthropic', model: 'claude-opus-4-6', tier: 'large', estimatedCostUsd: 0, reasoning: '' },
      provider, 0.01, 0.50,
    );

    expect(result.rated).toBe(false);
    expect(result.shouldRetry).toBe(false);
  });

  it('rates small-tier model outputs', async () => {
    const provider = createMockProvider('{"score": 0.8, "feedback": "Good response"}');
    const result = await runPostTaskQualityCheck(
      db, taskId, 'What is 2+2?', 'The answer is 4.',
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', tier: 'small', estimatedCostUsd: 0, reasoning: '' },
      provider, 0.01, 0.50,
    );

    expect(result.rated).toBe(true);
    expect(result.score).toBe(0.8);
    expect(result.feedback).toBe('Good response');
    expect(result.shouldRetry).toBe(false);
  });

  it('indicates retry needed when quality is low', async () => {
    const provider = createMockProvider('{"score": 0.2, "feedback": "Poor response"}');
    const result = await runPostTaskQualityCheck(
      db, taskId, 'Explain quantum physics', 'idk',
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', tier: 'small', estimatedCostUsd: 0, reasoning: '' },
      provider, 0.01, 0.50,
    );

    expect(result.rated).toBe(true);
    expect(result.score).toBe(0.2);
    expect(result.shouldRetry).toBe(true);
  });

  it('skips when no remaining budget', async () => {
    const provider = createMockProvider('{"score": 0.9, "feedback": "Great"}');
    const result = await runPostTaskQualityCheck(
      db, taskId, 'test', 'response',
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', tier: 'small', estimatedCostUsd: 0, reasoning: '' },
      provider, 0.50, 0.50, // spent === budget
    );

    expect(result.rated).toBe(false);
    expect(result.shouldRetry).toBe(false);
  });
});
