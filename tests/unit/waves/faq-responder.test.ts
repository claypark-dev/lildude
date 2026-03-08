import { describe, it, expect, vi } from 'vitest';
import { plan, execute, validate } from '../../../waves/bundled/faq-responder/index.js';

// ── Mock DB helpers ─────────────────────────────────────────────────────────

interface FaqRow {
  id: number;
  question: string;
  answer: string;
  category: string;
  enabled: number;
  access_count: number;
}

function createMockDb(rows: FaqRow[] = []) {
  const updateFn = vi.fn();
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT')) {
        return {
          all: vi.fn(() => rows.filter((r) => r.enabled === 1)),
        };
      }
      if (sql.includes('UPDATE')) {
        return {
          run: updateFn,
        };
      }
      return { all: vi.fn(() => []), run: vi.fn() };
    }),
    _updateFn: updateFn,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('faq-responder wave', () => {
  describe('plan()', () => {
    it('strips "question about" prefix from query', async () => {
      const result = await plan('question about business hours', {});

      expect(result.extractedParams.query).toBe('business hours');
    });

    it('strips "who is" prefix from query', async () => {
      const result = await plan('who is the CEO', {});

      expect(result.extractedParams.query).toBe('the CEO');
    });

    it('strips "what is" prefix from query', async () => {
      const result = await plan('what is the refund policy', {});

      expect(result.extractedParams.query).toBe('the refund policy');
    });

    it('strips "how do i" prefix from query', async () => {
      const result = await plan('how do i reset my password', {});

      expect(result.extractedParams.query).toBe('reset my password');
    });

    it('strips "faq" prefix from query', async () => {
      const result = await plan('faq shipping policy', {});

      expect(result.extractedParams.query).toBe('shipping policy');
    });

    it('preserves query when no trigger phrase found', async () => {
      const result = await plan('do you accept credit cards', {});

      expect(result.extractedParams.query).toBe('do you accept credit cards');
    });

    it('returns a deterministic plan', async () => {
      const result = await plan('question about refunds', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].type).toBe('api_call');
    });

    it('truncates query to 500 characters', async () => {
      const longInput = 'question about ' + 'x'.repeat(600);
      const result = await plan(longInput, {});

      expect(result.extractedParams.query.length).toBeLessThanOrEqual(500);
    });
  });

  describe('execute()', () => {
    it('returns matching FAQ from database', async () => {
      const mockDb = createMockDb([
        {
          id: 1,
          question: 'What are your business hours?',
          answer: 'We are open Monday to Friday, 9am to 5pm.',
          category: 'general',
          enabled: 1,
          access_count: 0,
        },
        {
          id: 2,
          question: 'What is the return policy?',
          answer: '30-day return policy for all items.',
          category: 'shopping',
          enabled: 1,
          access_count: 0,
        },
      ]);

      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Search FAQ', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          query: 'business hours',
          _deps: { db: mockDb },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('business hours');
      expect(result.output).toContain('Monday to Friday');
      expect(result.metadata.matchCount).toBeGreaterThan(0);
    });

    it('increments access_count for top match', async () => {
      const mockDb = createMockDb([
        {
          id: 42,
          question: 'How do I contact support?',
          answer: 'Email support@example.com',
          category: 'support',
          enabled: 1,
          access_count: 5,
        },
      ]);

      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Search FAQ', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          query: 'contact support',
          _deps: { db: mockDb },
        },
      };

      await execute(wavePlan);

      expect(mockDb._updateFn).toHaveBeenCalledWith(42);
    });

    it('returns "no entries matched" when no keyword overlap', async () => {
      const mockDb = createMockDb([
        {
          id: 1,
          question: 'What are your business hours?',
          answer: 'We are open 9-5.',
          category: 'general',
          enabled: 1,
          access_count: 0,
        },
      ]);

      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Search FAQ', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          query: 'refund cryptocurrency payment',
          _deps: { db: mockDb },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No FAQ entries matched');
      expect(result.metadata.matchCount).toBe(0);
    });

    it('returns "No FAQ entries configured" when table is empty', async () => {
      const mockDb = createMockDb([]);

      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Search FAQ', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          query: 'anything',
          _deps: { db: mockDb },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No FAQ entries');
      expect(result.metadata.matchCount).toBe(0);
    });

    it('returns fallback message when no DB available', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Search FAQ', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          query: 'anything',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No FAQ entries are currently configured');
    });

    it('returns error for empty query', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Search FAQ', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          query: '',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('question');
    });

    it('returns error for whitespace-only query', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Search FAQ', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          query: '   ',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
    });

    it('shows count of additional matches when multiple FAQs match', async () => {
      const mockDb = createMockDb([
        {
          id: 1,
          question: 'How do I return an item?',
          answer: 'Go to returns page.',
          category: 'shopping',
          enabled: 1,
          access_count: 0,
        },
        {
          id: 2,
          question: 'What is the return deadline?',
          answer: '30 days from purchase.',
          category: 'shopping',
          enabled: 1,
          access_count: 0,
        },
      ]);

      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Search FAQ', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          query: 'return item',
          _deps: { db: mockDb },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('more related FAQ');
      expect(result.metadata.matchCount).toBe(2);
    });

    it('ignores disabled FAQ entries', async () => {
      const mockDb = createMockDb([
        {
          id: 1,
          question: 'How do I contact you?',
          answer: 'Call us at 555-1234.',
          category: 'general',
          enabled: 0, // disabled
          access_count: 0,
        },
      ]);

      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Search FAQ', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          query: 'contact',
          _deps: { db: mockDb },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No FAQ entries');
    });
  });

  describe('validate()', () => {
    it('returns valid for successful result', async () => {
      const result = await validate({
        success: true,
        output: 'Here is the answer.',
      });

      expect(result.valid).toBe(true);
    });

    it('returns invalid for failed result', async () => {
      const result = await validate({
        success: false,
        output: '',
        error: 'FAQ search failed',
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('FAQ search failed');
    });
  });
});
