/**
 * Tests for the email-sender wave module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WavePlan, ToolResult } from '../../../src/types/index.js';

const WAVE_DIR = join(__dirname, '..', '..', '..', 'waves', 'bundled', 'email-sender');

/**
 * Dynamically import the email-sender wave module.
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

describe('email-sender wave', () => {
  let waveModule: Awaited<ReturnType<typeof importWaveModule>>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    waveModule = await importWaveModule();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('plan()', () => {
    it('returns a deterministic plan with rawInput', async () => {
      const plan = await waveModule.plan('send an email to John about the project', {});

      expect(plan.isDeterministic).toBe(true);
      expect(plan.estimatedCostUsd).toBe(0);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe('api_call');
      expect(plan.steps[0].description).toContain('Send email');
      expect(plan.extractedParams.rawInput).toBe('send an email to John about the project');
    });
  });

  describe('execute()', () => {
    it('sends email and returns success with message ID', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'sent-msg-456' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Send email via Gmail', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          to: 'recipient@example.com',
          subject: 'Project Update',
          body: 'Here is the latest status on the project.',
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('recipient@example.com');
      expect(result.output).toContain('Project Update');
      expect(result.output).toContain('sent-msg-456');
      expect(result.metadata?.messageId).toBe('sent-msg-456');
      expect(result.metadata?.to).toBe('recipient@example.com');
      expect(result.metadata?.subject).toBe('Project Update');
    });

    it('sends POST request with base64url-encoded raw message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'msg1' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Send email via Gmail', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          to: 'test@test.com',
          subject: 'Test Subject',
          body: 'Test body content',
          _deps: createMockDeps(),
        },
      };

      await waveModule.execute(plan);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      const options = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(options.body as string);

      expect(calledUrl).toContain('/messages/send');
      expect(options.method).toBe('POST');
      expect(body.raw).toBeDefined();

      // Decode and verify the raw message contains expected headers
      const decoded = Buffer.from(body.raw, 'base64url').toString('utf-8');
      expect(decoded).toContain('To: test@test.com');
      expect(decoded).toContain('Subject: Test Subject');
      expect(decoded).toContain('Test body content');
      expect(decoded).toContain('Content-Type: text/plain');
      expect(decoded).toContain('MIME-Version: 1.0');
    });

    it('includes cc and bcc in raw message when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'msg1' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Send email via Gmail', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          to: 'to@test.com',
          subject: 'Test',
          body: 'Body',
          cc: 'cc@test.com',
          bcc: 'bcc@test.com',
          _deps: createMockDeps(),
        },
      };

      await waveModule.execute(plan);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      const decoded = Buffer.from(body.raw, 'base64url').toString('utf-8');

      expect(decoded).toContain('Cc: cc@test.com');
      expect(decoded).toContain('Bcc: bcc@test.com');
    });

    it('fails when required fields are missing', async () => {
      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Send email via Gmail', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          to: 'recipient@example.com',
          // Missing subject and body
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Missing required email fields');
    });

    it('fails when OAuth deps are missing', async () => {
      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Send email via Gmail', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          to: 'test@test.com',
          subject: 'Test',
          body: 'Body',
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('OAuth setup');
    });

    it('fails when access token is null', async () => {
      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Send email via Gmail', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          to: 'test@test.com',
          subject: 'Test',
          body: 'Body',
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
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Send email via Gmail', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          to: 'test@test.com',
          subject: 'Test',
          body: 'Body',
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('429');
    });

    it('handles fetch network errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Socket hang up')));

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Send email via Gmail', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          to: 'test@test.com',
          subject: 'Test',
          body: 'Body',
          _deps: createMockDeps(),
        },
      };

      const result = await waveModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('failed');
    });

    it('sends correct Authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'msg1' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const plan: WavePlan = {
        steps: [{ type: 'api_call', description: 'Send email via Gmail', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          to: 'test@test.com',
          subject: 'Test',
          body: 'Body',
          _deps: createMockDeps('my-secret-token'),
        },
      };

      await waveModule.execute(plan);

      const options = mockFetch.mock.calls[0][1] as RequestInit;
      expect((options.headers as Record<string, string>).Authorization).toBe('Bearer my-secret-token');
    });
  });

  describe('validate()', () => {
    it('returns valid for successful result', async () => {
      const result: ToolResult = {
        success: true,
        output: 'Email sent successfully to test@test.com',
      };
      const validation = await waveModule.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('returns invalid for failed result with error', async () => {
      const result: ToolResult = {
        success: false,
        output: '',
        error: 'API error',
      };
      const validation = await waveModule.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.feedback).toBe('API error');
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

      const plan = await waveModule.plan('send email to boss about quarterly report', {});

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(plan.isDeterministic).toBe(true);
      expect(plan.estimatedCostUsd).toBe(0);

      fetchSpy.mockRestore();
    });
  });
});
