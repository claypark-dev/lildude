/**
 * Tests for the email-reader wave module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WavePlan, ToolResult } from '../../../src/types/index.js';

const WAVE_DIR = join(__dirname, '..', '..', '..', 'waves', 'bundled', 'email-reader');

/**
 * Dynamically import the email-reader wave module.
 */
async function importWaveModule(): Promise<{
  plan: (userInput: string, context: Record<string, unknown>) => Promise<WavePlan>;
  execute: (plan: WavePlan) => Promise<ToolResult>;
  validate: (result: ToolResult) => Promise<{ valid: boolean; feedback?: string }>;
}> {
  const modulePath = pathToFileURL(join(WAVE_DIR, 'index.js')).href;
  return import(modulePath) as Promise<{
    plan: (userInput: string, context: Record<string, unknown>) => Promise<WavePlan>;
    execute: (plan: WavePlan) => Promise<ToolResult>;
    validate: (result: ToolResult) => Promise<{ valid: boolean; feedback?: string }>;
  }>;
}

/** Build mock deps with a getAccessToken function. */
function createMockDeps(accessToken: string | null = 'test-access-token') {
  return {
    getAccessToken: vi.fn().mockResolvedValue(accessToken),
  };
}

describe('email-reader wave', () => {
  let waveModule: Awaited<ReturnType<typeof importWaveModule>>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    waveModule = await importWaveModule();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('plan()', () => {
    it('infers "list" action for "check my email"', async () => {
      const plan = await waveModule.plan('check my email', {});

      expect(plan.isDeterministic).toBe(true);
      expect(plan.estimatedCostUsd).toBe(0);
      expect(plan.extractedParams.action).toBe('list');
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe('api_call');
    });

    it('infers "search" action for "find emails from John"', async () => {
      const plan = await waveModule.plan('find emails from John', {});

      expect(plan.extractedParams.action).toBe('search');
    });

    it('infers "search" action for "search for invoices"', async () => {
      const plan = await waveModule.plan('search for invoices in my inbox', {});

      expect(plan.extractedParams.action).toBe('search');
    });

    it('sets unreadOnly for "show me unread emails"', async () => {
      const plan = await waveModule.plan('show me unread emails', {});

      expect(plan.extractedParams.unreadOnly).toBe(true);
    });

    it('sets unreadOnly for "any new messages?"', async () => {
      const plan = await waveModule.plan('any new messages?', {});

      expect(plan.extractedParams.unreadOnly).toBe(true);
    });

    it('defaults to list without unreadOnly for generic query', async () => {
      const plan = await waveModule.plan("what's in my inbox", {});

      expect(plan.extractedParams.action).toBe('list');
      expect(plan.extractedParams.unreadOnly).toBe(false);
    });

    it('preserves rawInput in extractedParams', async () => {
      const plan = await waveModule.plan('check my email please', {});

      expect(plan.extractedParams.rawInput).toBe('check my email please');
    });
  });

  describe('execute()', () => {
    it('returns formatted email list on success', async () => {
      const mockFetch = vi.fn()
        // List messages call
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [{ id: 'msg1', threadId: 't1' }],
            }),
        })
        // Get message details call
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'msg1',
              threadId: 't1',
              labelIds: ['INBOX', 'UNREAD'],
              snippet: 'Hey there!',
              payload: {
                headers: [
                  { name: 'From', value: 'alice@example.com' },
                  { name: 'Subject', value: 'Hello' },
                  { name: 'Date', value: 'Mon, 3 Mar 2026 10:00:00 -0500' },
                ],
              },
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Gmail list operation', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          unreadOnly: false,
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('1 email(s)');
      expect(result.output).toContain('Hello');
      expect(result.output).toContain('alice@example.com');
      expect(result.metadata?.emailCount).toBe(1);
    });

    it('returns "no emails found" for empty inbox', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Gmail list operation', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          unreadOnly: false,
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No');
      expect(result.output).toContain('emails found');
      expect(result.metadata?.emailCount).toBe(0);
    });

    it('adds unread qualifier to "no emails" message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Gmail list operation', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          unreadOnly: true,
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('unread');
    });

    it('fails when OAuth deps are missing', async () => {
      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Gmail list operation', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          unreadOnly: false,
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('OAuth setup');
    });

    it('fails when access token is null', async () => {
      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Gmail list operation', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          unreadOnly: false,
          _deps: createMockDeps(null),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('No Gmail access token');
    });

    it('handles API error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Gmail list operation', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          unreadOnly: false,
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('401');
    });

    it('handles fetch network errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS resolution failed')));

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Gmail list operation', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          unreadOnly: false,
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('failed');
    });

    it('handles invalid params gracefully', async () => {
      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Gmail list operation', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'invalid_action',
          maxResults: 999,
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Invalid');
    });

    it('skips messages that fail detail fetch', async () => {
      const mockFetch = vi.fn()
        // List messages
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                { id: 'msg1', threadId: 't1' },
                { id: 'msg2', threadId: 't2' },
              ],
            }),
        })
        // First message detail - fails
        .mockResolvedValueOnce({ ok: false, status: 500 })
        // Second message detail - succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'msg2',
              threadId: 't2',
              labelIds: ['INBOX'],
              snippet: 'Second email',
              payload: {
                headers: [
                  { name: 'From', value: 'bob@example.com' },
                  { name: 'Subject', value: 'Second Email' },
                  { name: 'Date', value: 'Mon, 3 Mar 2026 11:00:00 -0500' },
                ],
              },
            }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Gmail list operation', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          unreadOnly: false,
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(true);
      expect(result.metadata?.emailCount).toBe(1);
      expect(result.output).toContain('Second Email');
    });
  });

  describe('validate()', () => {
    it('returns valid for successful result with output', async () => {
      const result: ToolResult = { success: true, output: 'Found 3 emails' };
      const validation = await waveModule.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('returns invalid for failed result with error', async () => {
      const result: ToolResult = { success: false, output: '', error: 'API error' };
      const validation = await waveModule.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.feedback).toBe('API error');
    });

    it('returns invalid for empty output on success', async () => {
      const result: ToolResult = { success: true, output: '' };
      const validation = await waveModule.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.feedback).toContain('empty output');
    });

    it('returns invalid for null result', async () => {
      const validation = await waveModule.validate(null as unknown as ToolResult);

      expect(validation.valid).toBe(false);
      expect(validation.feedback).toContain('No result');
    });
  });

  describe('deterministic execution contract', () => {
    it('plan() does not make any fetch calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const plan = await waveModule.plan('check my unread emails', {});

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(plan.isDeterministic).toBe(true);
      expect(plan.estimatedCostUsd).toBe(0);

      fetchSpy.mockRestore();
    });
  });
});
