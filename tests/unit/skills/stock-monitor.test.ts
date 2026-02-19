import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SkillPlan, ToolResult } from '../../../src/types/index.js';

// ── Type definitions for the skill module ───────────────────────────────────

interface StockMonitorModule {
  plan: (userInput: string, context: Record<string, unknown>) => Promise<SkillPlan>;
  execute: (plan: SkillPlan) => Promise<ToolResult>;
  validate: (result: ToolResult) => Promise<{ valid: boolean; feedback?: string }>;
}

// ── Yahoo Finance mock response builders ────────────────────────────────────

interface MockQuoteOptions {
  symbol: string;
  regularMarketPrice: number;
  chartPreviousClose: number;
  currency?: string;
  marketState?: string;
}

function buildYahooChartResponse(options: MockQuoteOptions): Record<string, unknown> {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol: options.symbol,
            regularMarketPrice: options.regularMarketPrice,
            chartPreviousClose: options.chartPreviousClose,
            currency: options.currency ?? 'USD',
            marketState: options.marketState ?? 'REGULAR',
          },
          timestamp: [1700000000],
          indicators: {
            quote: [
              {
                close: [options.regularMarketPrice],
                open: [options.chartPreviousClose],
                high: [options.regularMarketPrice + 1],
                low: [options.chartPreviousClose - 1],
                volume: [50000000],
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

function buildYahooErrorResponse(symbol: string): Record<string, unknown> {
  return {
    chart: {
      result: null,
      error: {
        code: 'Not Found',
        description: `No data found for ${symbol}`,
      },
    },
  };
}

function buildYahooEmptyResponse(): Record<string, unknown> {
  return {
    chart: {
      result: [],
      error: null,
    },
  };
}

// ── Mock fetch helper ───────────────────────────────────────────────────────

type FetchHandler = (url: string) => Promise<Response>;

function createMockFetch(handler: FetchHandler): typeof fetch {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(url);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('stock-monitor skill', () => {
  let stockMonitor: StockMonitorModule;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    // Dynamically import the skill module fresh
    const modulePath = new URL(
      '../../../skills/bundled/stock-monitor/index.js',
      import.meta.url,
    ).href;
    // Use a cache-busting query param to get a fresh module each test
    stockMonitor = await import(`${modulePath}?t=${Date.now()}`) as StockMonitorModule;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── plan() tests ────────────────────────────────────────────────────────

  describe('plan()', () => {
    it('extracts a single stock symbol from user input', async () => {
      const result = await stockMonitor.plan('Check AAPL', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.extractedParams.symbol).toBe('AAPL');
    });

    it('detects alert intent with below condition', async () => {
      const result = await stockMonitor.plan(
        'Alert me if TSLA drops below $200',
        {},
      );

      expect(result.extractedParams.condition).toBe('below');
      expect(result.extractedParams.price).toBe(200);
    });

    it('detects alert intent with above condition', async () => {
      const result = await stockMonitor.plan(
        'Notify me if AAPL goes above $300',
        {},
      );

      expect(result.extractedParams.condition).toBe('above');
      expect(result.extractedParams.price).toBe(300);
    });

    it('returns at least one step', async () => {
      const result = await stockMonitor.plan('Check AAPL', {});

      expect(result.steps.length).toBeGreaterThanOrEqual(1);
      expect(result.steps[0].type).toBe('api_call');
    });
  });

  // ── execute() — check_stock ─────────────────────────────────────────────

  describe('execute() — check_stock', () => {
    it('returns formatted price with arrow for a positive change', async () => {
      vi.stubGlobal(
        'fetch',
        createMockFetch(async () =>
          jsonResponse(
            buildYahooChartResponse({
              symbol: 'AAPL',
              regularMarketPrice: 245.30,
              chartPreviousClose: 242.30,
            }),
          ),
        ),
      );

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'AAPL' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('AAPL');
      expect(result.output).toContain('$245.30');
      expect(result.output).toContain('\u25B2'); // up arrow
      expect(result.output).toContain('+3.00');
      expect(result.output).toContain('+1.24%');
    });

    it('returns formatted price with down arrow for a negative change', async () => {
      vi.stubGlobal(
        'fetch',
        createMockFetch(async () =>
          jsonResponse(
            buildYahooChartResponse({
              symbol: 'TSLA',
              regularMarketPrice: 195.50,
              chartPreviousClose: 200.00,
            }),
          ),
        ),
      );

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'TSLA' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('TSLA');
      expect(result.output).toContain('$195.50');
      expect(result.output).toContain('\u25BC'); // down arrow
      expect(result.output).toContain('-4.50');
      expect(result.output).toContain('-2.25%');
    });

    it('handles multiple symbols', async () => {
      vi.stubGlobal(
        'fetch',
        createMockFetch(async (url) => {
          if (url.includes('AAPL')) {
            return jsonResponse(
              buildYahooChartResponse({
                symbol: 'AAPL',
                regularMarketPrice: 245.30,
                chartPreviousClose: 242.30,
              }),
            );
          }
          if (url.includes('MSFT')) {
            return jsonResponse(
              buildYahooChartResponse({
                symbol: 'MSFT',
                regularMarketPrice: 410.20,
                chartPreviousClose: 405.00,
              }),
            );
          }
          return jsonResponse(buildYahooEmptyResponse(), 200);
        }),
      );

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stocks', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'AAPL,MSFT' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('AAPL');
      expect(result.output).toContain('$245.30');
      expect(result.output).toContain('MSFT');
      expect(result.output).toContain('$410.20');
    });

    it('returns error for missing symbol', async () => {
      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {},
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('No valid stock symbol');
    });

    it('handles network failure gracefully', async () => {
      vi.stubGlobal(
        'fetch',
        createMockFetch(async () => {
          throw new Error('Network request failed');
        }),
      );

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'AAPL' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Failed to fetch stock data');
      expect(result.output).toContain('Network request failed');
    });

    it('handles HTTP error status from Yahoo Finance', async () => {
      vi.stubGlobal(
        'fetch',
        createMockFetch(async () => jsonResponse({}, 404)),
      );

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'INVALID' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('404');
    });

    it('handles invalid symbol with empty result array', async () => {
      vi.stubGlobal(
        'fetch',
        createMockFetch(async () =>
          jsonResponse(buildYahooEmptyResponse()),
        ),
      );

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'ZZZZZ' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('No data found');
    });

    it('does NOT use LLM for formatting — purely template strings', async () => {
      const mockFetch = createMockFetch(async () =>
        jsonResponse(
          buildYahooChartResponse({
            symbol: 'AAPL',
            regularMarketPrice: 150.00,
            chartPreviousClose: 148.00,
          }),
        ),
      );
      vi.stubGlobal('fetch', mockFetch);

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'AAPL' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(true);
      // Verify fetch was called exactly once (Yahoo Finance), no LLM calls
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('query1.finance.yahoo.com');
      expect(calledUrl).not.toContain('anthropic');
      expect(calledUrl).not.toContain('openai');
    });

    it('includes metadata with quote details on success', async () => {
      vi.stubGlobal(
        'fetch',
        createMockFetch(async () =>
          jsonResponse(
            buildYahooChartResponse({
              symbol: 'AAPL',
              regularMarketPrice: 150.00,
              chartPreviousClose: 148.00,
            }),
          ),
        ),
      );

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'AAPL' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.quotes).toBeDefined();
      expect(result.metadata?.symbols).toEqual(['AAPL']);
      expect(result.metadata?.fetchedAt).toBeDefined();
    });
  });

  // ── execute() — set_alert ───────────────────────────────────────────────

  describe('execute() — set_alert', () => {
    it('creates alert metadata for a "drops below" condition', async () => {
      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Set alert', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          symbol: 'TSLA',
          condition: 'below',
          price: 200,
        },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Price alert set');
      expect(result.output).toContain('TSLA');
      expect(result.output).toContain('drops below');
      expect(result.output).toContain('$200.00');
      expect(result.output).toContain('every 30 minutes');

      // Verify cron job metadata
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.action).toBe('create_cron_job');
      expect(result.metadata?.cronSchedule).toBe('*/30 * * * *');
      expect(result.metadata?.symbol).toBe('TSLA');
      expect(result.metadata?.condition).toBe('below');
      expect(result.metadata?.targetPrice).toBe(200);
      expect(result.metadata?.skillId).toBe('stock-monitor');
      expect(result.metadata?.usesAi).toBe(false);
      expect(result.metadata?.estimatedCostPerRun).toBe(0);
    });

    it('creates alert metadata for a "rises above" condition', async () => {
      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Set alert', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          symbol: 'AAPL',
          condition: 'above',
          price: 300,
        },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('rises above');
      expect(result.output).toContain('$300.00');
    });

    it('returns error for missing symbol in alert', async () => {
      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Set alert', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          condition: 'below',
          price: 200,
        },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('No valid stock symbol');
    });

    it('returns error for invalid price in alert', async () => {
      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Set alert', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          symbol: 'AAPL',
          condition: 'below',
          price: -50,
        },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('positive number');
    });

    it('returns error for invalid condition', async () => {
      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Set alert', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          symbol: 'AAPL',
          condition: 'invalid_cond',
          price: 200,
        },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Condition must be one of');
    });
  });

  // ── validate() ──────────────────────────────────────────────────────────

  describe('validate()', () => {
    it('returns valid for a proper stock quote output', async () => {
      const result: ToolResult = {
        success: true,
        output: 'AAPL: $245.30 \u25B2 +3.00 (+1.24%)',
      };

      const validation = await stockMonitor.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('returns valid for alert confirmation output', async () => {
      const result: ToolResult = {
        success: true,
        output: 'Price alert set: notify when TSLA drops below $200.00. Checking every 30 minutes.',
      };

      const validation = await stockMonitor.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('returns valid for failed results (errors are already handled)', async () => {
      const result: ToolResult = {
        success: false,
        output: 'Failed to check stock: Network error',
        error: 'Network error',
      };

      const validation = await stockMonitor.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('returns invalid when output is missing symbol or price', async () => {
      const result: ToolResult = {
        success: true,
        output: 'Some generic output with no stock data',
      };

      const validation = await stockMonitor.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.feedback).toContain('missing');
    });
  });

  // ── Price formatting ────────────────────────────────────────────────────

  describe('price formatting', () => {
    it('uses up arrow for positive price change', async () => {
      vi.stubGlobal(
        'fetch',
        createMockFetch(async () =>
          jsonResponse(
            buildYahooChartResponse({
              symbol: 'AAPL',
              regularMarketPrice: 150.00,
              chartPreviousClose: 145.00,
            }),
          ),
        ),
      );

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'AAPL' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.output).toContain('\u25B2'); // up arrow
      expect(result.output).toContain('+5.00');
      expect(result.output).toContain('+3.45%');
    });

    it('uses down arrow for negative price change', async () => {
      vi.stubGlobal(
        'fetch',
        createMockFetch(async () =>
          jsonResponse(
            buildYahooChartResponse({
              symbol: 'META',
              regularMarketPrice: 490.00,
              chartPreviousClose: 500.00,
            }),
          ),
        ),
      );

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'META' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.output).toContain('\u25BC'); // down arrow
      expect(result.output).toContain('-10.00');
      expect(result.output).toContain('-2.00%');
    });

    it('handles zero change correctly', async () => {
      vi.stubGlobal(
        'fetch',
        createMockFetch(async () =>
          jsonResponse(
            buildYahooChartResponse({
              symbol: 'GOOG',
              regularMarketPrice: 175.00,
              chartPreviousClose: 175.00,
            }),
          ),
        ),
      );

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Fetch stock', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: { symbol: 'GOOG' },
      };

      const result = await stockMonitor.execute(plan);

      expect(result.output).toContain('\u25B2'); // zero change uses up arrow (>= 0)
      expect(result.output).toContain('+0.00');
      expect(result.output).toContain('+0.00%');
    });
  });
});
