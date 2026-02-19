import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encrypt, decrypt } from '../../../src/utils/crypto.js';
import type { SkillPlan, ToolResult } from '../../../src/types/index.js';

// ─── Dynamic Imports for Skill Modules ────────────────────────────────────

const SKILL_DIR = join(__dirname, '..', '..', '..', 'skills', 'bundled', 'google-calendar');

/**
 * Dynamically import the index.js skill module.
 * Uses file:// URL protocol required for ESM dynamic imports.
 */
async function importSkillModule(): Promise<{
  plan: (userInput: string, context: Record<string, unknown>) => Promise<SkillPlan>;
  execute: (plan: SkillPlan) => Promise<ToolResult>;
  validate: (result: ToolResult) => Promise<{ valid: boolean; feedback?: string }>;
}> {
  const modulePath = pathToFileURL(join(SKILL_DIR, 'index.js')).href;
  return import(modulePath) as Promise<{
    plan: (userInput: string, context: Record<string, unknown>) => Promise<SkillPlan>;
    execute: (plan: SkillPlan) => Promise<ToolResult>;
    validate: (result: ToolResult) => Promise<{ valid: boolean; feedback?: string }>;
  }>;
}

/**
 * Dynamically import the oauth.js module.
 */
async function importOAuthModule(): Promise<{
  startOAuthFlow: (clientId: string, redirectUri: string) => { url: string };
  handleCallback: (
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ) => Promise<{ accessToken: string; refreshToken: string; expiresAt: number; tokenType: string }>;
  refreshToken: (
    currentRefreshToken: string,
    clientId: string,
    clientSecret: string,
  ) => Promise<{ accessToken: string; refreshToken: string; expiresAt: number; tokenType: string }>;
  storeTokens: (
    db: unknown,
    tokens: { accessToken: string; refreshToken: string; expiresAt: number; tokenType: string },
    encryptionSecret: string,
    cryptoUtils: { encrypt: typeof encrypt },
    knowledgeStore: { upsertKnowledge: ReturnType<typeof vi.fn> },
  ) => void;
  getTokens: (
    db: unknown,
    encryptionSecret: string,
    cryptoUtils: { decrypt: typeof decrypt },
    knowledgeStore: { getKnowledge: ReturnType<typeof vi.fn> },
  ) => { accessToken: string; refreshToken: string; expiresAt: number; tokenType: string } | null;
  isTokenExpired: (tokens: { expiresAt: number }) => boolean;
}> {
  const modulePath = pathToFileURL(join(SKILL_DIR, 'oauth.js')).href;
  return import(modulePath) as ReturnType<typeof importOAuthModule>;
}

// ─── Mock Helpers ─────────────────────────────────────────────────────────

/** Create a mock knowledge store for token storage/retrieval. */
function createMockKnowledgeStore() {
  return {
    upsertKnowledge: vi.fn(),
    getKnowledge: vi.fn().mockReturnValue([]),
  };
}

/** Encryption secret for tests. */
const TEST_SECRET = 'test-encryption-secret-for-calendar';

/** Sample OAuth tokens for tests. */
const SAMPLE_TOKENS = {
  accessToken: 'ya29.test-access-token',
  refreshToken: '1//test-refresh-token',
  expiresAt: Date.now() + 3600 * 1000,
  tokenType: 'Bearer',
};

/** Build mock deps for plan.extractedParams._deps */
function createMockDeps(tokenOverrides?: Partial<typeof SAMPLE_TOKENS>) {
  const tokens = { ...SAMPLE_TOKENS, ...tokenOverrides };
  const encryptedTokens = encrypt(JSON.stringify(tokens), TEST_SECRET);

  const knowledgeStore = createMockKnowledgeStore();
  knowledgeStore.getKnowledge.mockReturnValue([
    { value: encryptedTokens, category: 'oauth', key: 'google-calendar-tokens' },
  ]);

  return {
    db: {},
    encryptionSecret: TEST_SECRET,
    cryptoUtils: { encrypt, decrypt },
    knowledgeStore,
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('google-calendar skill', () => {
  let skillModule: Awaited<ReturnType<typeof importSkillModule>>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    skillModule = await importSkillModule();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('plan()', () => {
    it('infers "create" action from "Add meeting with Sarah tomorrow at 2pm"', async () => {
      const plan = await skillModule.plan('Add meeting with Sarah tomorrow at 2pm', {});

      expect(plan.isDeterministic).toBe(true);
      expect(plan.estimatedCostUsd).toBe(0);
      expect(plan.extractedParams.action).toBe('create');
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps[0].type).toBe('api_call');
    });

    it('infers "list" action from "What\'s on my calendar today?"', async () => {
      const plan = await skillModule.plan("What's on my calendar today?", {});

      expect(plan.extractedParams.action).toBe('list');
      expect(plan.isDeterministic).toBe(true);
    });

    it('infers "delete" action from "Cancel my 3pm meeting"', async () => {
      const plan = await skillModule.plan('Cancel my 3pm meeting', {});

      expect(plan.extractedParams.action).toBe('delete');
    });

    it('infers "create" action from "Schedule a call with John"', async () => {
      const plan = await skillModule.plan('Schedule a call with John', {});

      expect(plan.extractedParams.action).toBe('create');
    });

    it('infers "delete" action from "Remove the standup event"', async () => {
      const plan = await skillModule.plan('Remove the standup event', {});

      expect(plan.extractedParams.action).toBe('delete');
    });

    it('defaults to "list" for ambiguous input', async () => {
      const plan = await skillModule.plan('Check my calendar', {});

      expect(plan.extractedParams.action).toBe('list');
    });
  });

  describe('execute() — create event via API', () => {
    it('creates an event via the Google Calendar API', async () => {
      const mockResponse = new Response(
        JSON.stringify({
          id: 'event123',
          summary: 'Meeting with Sarah',
          htmlLink: 'https://calendar.google.com/event/event123',
        }),
        { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } },
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const mockDeps = createMockDeps();

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Create event', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'create',
          title: 'Meeting with Sarah',
          date: '2026-02-20',
          time: '14:00',
          duration: 60,
          _deps: mockDeps,
        },
      };

      const result = await skillModule.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Meeting with Sarah');
      expect(result.metadata?.eventId).toBe('event123');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Verify the fetch was called with POST method and correct URL
      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[0]).toContain('calendars/primary/events');
      expect((fetchCall[1] as RequestInit).method).toBe('POST');
    });
  });

  describe('execute() — list events via API', () => {
    it('lists events from the Google Calendar API', async () => {
      const mockResponse = new Response(
        JSON.stringify({
          items: [
            {
              summary: 'Team Standup',
              start: { dateTime: '2026-02-19T10:00:00Z' },
              end: { dateTime: '2026-02-19T10:30:00Z' },
            },
            {
              summary: 'Lunch',
              start: { dateTime: '2026-02-19T12:00:00Z' },
              end: { dateTime: '2026-02-19T13:00:00Z' },
            },
          ],
        }),
        { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } },
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const mockDeps = createMockDeps();

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'List events', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          startDate: '2026-02-19',
          endDate: '2026-02-20',
          _deps: mockDeps,
        },
      };

      const result = await skillModule.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('2 event(s)');
      expect(result.output).toContain('Team Standup');
      expect(result.output).toContain('Lunch');
      expect(result.metadata?.eventCount).toBe(2);
    });

    it('handles empty event list', async () => {
      const mockResponse = new Response(
        JSON.stringify({ items: [] }),
        { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } },
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const mockDeps = createMockDeps();

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'List events', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          _deps: mockDeps,
        },
      };

      const result = await skillModule.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No events found');
    });
  });

  describe('execute() — delete event via API', () => {
    it('deletes an event by ID', async () => {
      const mockResponse = new Response(null, { status: 204, statusText: 'No Content' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const mockDeps = createMockDeps();

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Delete event', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'delete',
          eventId: 'event-to-delete-123',
          _deps: mockDeps,
        },
      };

      const result = await skillModule.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('event-to-delete-123');
      expect(result.metadata?.deletedEventId).toBe('event-to-delete-123');
    });

    it('fails when no eventId is provided for delete', async () => {
      const mockDeps = createMockDeps();

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Delete event', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'delete',
          _deps: mockDeps,
        },
      };

      const result = await skillModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('no event ID');
    });
  });

  describe('execute() — missing OAuth tokens', () => {
    it('handles missing OAuth tokens gracefully', async () => {
      const knowledgeStore = createMockKnowledgeStore();
      knowledgeStore.getKnowledge.mockReturnValue([]);

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'List events', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          _deps: {
            db: {},
            encryptionSecret: TEST_SECRET,
            cryptoUtils: { encrypt, decrypt },
            knowledgeStore,
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
          },
        },
      };

      const result = await skillModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('No Google Calendar OAuth tokens found');
    });

    it('handles missing deps gracefully', async () => {
      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'List events', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
        },
      };

      const result = await skillModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('OAuth setup');
    });
  });

  describe('execute() — API error handling', () => {
    it('handles API error responses', async () => {
      const mockResponse = new Response('Unauthorized', {
        status: 401,
        statusText: 'Unauthorized',
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const mockDeps = createMockDeps();

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'List events', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'list',
          _deps: mockDeps,
        },
      };

      const result = await skillModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('401');
    });

    it('handles fetch network errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const mockDeps = createMockDeps();

      const plan: SkillPlan = {
        steps: [{ type: 'api_call', description: 'Create event', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          action: 'create',
          title: 'Test Event',
          date: '2026-02-20',
          time: '10:00',
          _deps: mockDeps,
        },
      };

      const result = await skillModule.execute(plan);

      expect(result.success).toBe(false);
      expect(result.output).toContain('failed');
    });
  });

  describe('validate()', () => {
    it('returns valid for successful result with output', async () => {
      const result: ToolResult = { success: true, output: 'Found 3 events' };
      const validation = await skillModule.validate(result);

      expect(validation.valid).toBe(true);
    });

    it('returns invalid for failed result with error', async () => {
      const result: ToolResult = { success: false, output: '', error: 'API error' };
      const validation = await skillModule.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.feedback).toBe('API error');
    });

    it('returns invalid for empty output on success', async () => {
      const result: ToolResult = { success: true, output: '' };
      const validation = await skillModule.validate(result);

      expect(validation.valid).toBe(false);
      expect(validation.feedback).toContain('empty output');
    });
  });
});

describe('google-calendar OAuth module', () => {
  let oauthModule: Awaited<ReturnType<typeof importOAuthModule>>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    oauthModule = await importOAuthModule();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('startOAuthFlow()', () => {
    it('generates a valid authorization URL', () => {
      const result = oauthModule.startOAuthFlow(
        'test-client-id',
        'http://localhost:3000/callback',
      );

      expect(result.url).toContain('accounts.google.com');
      expect(result.url).toContain('client_id=test-client-id');
      expect(result.url).toContain('redirect_uri=');
      expect(result.url).toContain('scope=');
      expect(result.url).toContain('access_type=offline');
    });

    it('throws when client ID is missing', () => {
      expect(() => oauthModule.startOAuthFlow('', 'http://localhost/callback')).toThrow(
        'OAuth client ID is required',
      );
    });

    it('throws when redirect URI is missing', () => {
      expect(() => oauthModule.startOAuthFlow('test-id', '')).toThrow(
        'OAuth redirect URI is required',
      );
    });
  });

  describe('handleCallback()', () => {
    it('exchanges authorization code for tokens', async () => {
      const mockResponse = new Response(
        JSON.stringify({
          access_token: 'ya29.test-access',
          refresh_token: '1//test-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'calendar',
        }),
        { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } },
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const tokens = await oauthModule.handleCallback(
        'auth-code',
        'client-id',
        'client-secret',
        'http://localhost/callback',
      );

      expect(tokens.accessToken).toBe('ya29.test-access');
      expect(tokens.refreshToken).toBe('1//test-refresh');
      expect(tokens.tokenType).toBe('Bearer');
      expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    });

    it('throws when authorization code is empty', async () => {
      await expect(
        oauthModule.handleCallback('', 'client-id', 'client-secret', 'http://localhost/callback'),
      ).rejects.toThrow('Authorization code is required');
    });
  });

  describe('refreshToken()', () => {
    it('refreshes an expired access token', async () => {
      const mockResponse = new Response(
        JSON.stringify({
          access_token: 'ya29.refreshed-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } },
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const tokens = await oauthModule.refreshToken(
        '1//existing-refresh',
        'client-id',
        'client-secret',
      );

      expect(tokens.accessToken).toBe('ya29.refreshed-token');
      // Should keep the existing refresh token if none returned
      expect(tokens.refreshToken).toBe('1//existing-refresh');
    });

    it('throws when refresh token is empty', async () => {
      await expect(
        oauthModule.refreshToken('', 'client-id', 'client-secret'),
      ).rejects.toThrow('Refresh token is required');
    });
  });

  describe('token encryption/decryption via storeTokens/getTokens', () => {
    it('stores and retrieves tokens with encryption round-trip', () => {
      const knowledgeStore = createMockKnowledgeStore();
      const cryptoUtils = { encrypt, decrypt };

      oauthModule.storeTokens(
        {},
        SAMPLE_TOKENS,
        TEST_SECRET,
        cryptoUtils,
        knowledgeStore,
      );

      // Verify upsertKnowledge was called
      expect(knowledgeStore.upsertKnowledge).toHaveBeenCalledTimes(1);

      // Get the encrypted value that was stored
      const storedCall = knowledgeStore.upsertKnowledge.mock.calls[0];
      const storedInput = storedCall[1] as { value: string };
      const encryptedValue = storedInput.value;

      // Now mock getKnowledge to return the stored value
      knowledgeStore.getKnowledge.mockReturnValue([
        { value: encryptedValue, category: 'oauth', key: 'google-calendar-tokens' },
      ]);

      const retrieved = oauthModule.getTokens(
        {},
        TEST_SECRET,
        cryptoUtils,
        knowledgeStore,
      );

      expect(retrieved).not.toBeNull();
      expect(retrieved?.accessToken).toBe(SAMPLE_TOKENS.accessToken);
      expect(retrieved?.refreshToken).toBe(SAMPLE_TOKENS.refreshToken);
      expect(retrieved?.expiresAt).toBe(SAMPLE_TOKENS.expiresAt);
      expect(retrieved?.tokenType).toBe(SAMPLE_TOKENS.tokenType);
    });

    it('returns null when no tokens are stored', () => {
      const knowledgeStore = createMockKnowledgeStore();
      knowledgeStore.getKnowledge.mockReturnValue([]);

      const retrieved = oauthModule.getTokens(
        {},
        TEST_SECRET,
        { encrypt, decrypt },
        knowledgeStore,
      );

      expect(retrieved).toBeNull();
    });

    it('throws when decryption fails with wrong secret', () => {
      const knowledgeStore = createMockKnowledgeStore();
      const cryptoUtils = { encrypt, decrypt };

      // Store with correct secret
      oauthModule.storeTokens({}, SAMPLE_TOKENS, TEST_SECRET, cryptoUtils, knowledgeStore);

      const storedCall = knowledgeStore.upsertKnowledge.mock.calls[0];
      const storedInput = storedCall[1] as { value: string };

      knowledgeStore.getKnowledge.mockReturnValue([
        { value: storedInput.value, category: 'oauth', key: 'google-calendar-tokens' },
      ]);

      // Attempt to decrypt with wrong secret
      expect(() =>
        oauthModule.getTokens({}, 'wrong-secret', cryptoUtils, knowledgeStore),
      ).toThrow('Failed to retrieve OAuth tokens');
    });
  });

  describe('isTokenExpired()', () => {
    it('returns false for tokens expiring in the future', () => {
      const tokens = { expiresAt: Date.now() + 3600 * 1000 };

      expect(oauthModule.isTokenExpired(tokens)).toBe(false);
    });

    it('returns true for expired tokens', () => {
      const tokens = { expiresAt: Date.now() - 1000 };

      expect(oauthModule.isTokenExpired(tokens)).toBe(true);
    });

    it('returns true for tokens within the 5-minute buffer', () => {
      const tokens = { expiresAt: Date.now() + 2 * 60 * 1000 }; // 2 minutes from now

      expect(oauthModule.isTokenExpired(tokens)).toBe(true);
    });
  });
});

describe('google-calendar — deterministic execution contract', () => {
  it('plan() does not make any LLM calls (the executor makes 1)', async () => {
    const modulePath = pathToFileURL(join(SKILL_DIR, 'index.js')).href;
    const skillModule = await import(modulePath) as {
      plan: (input: string, ctx: Record<string, unknown>) => Promise<SkillPlan>;
    };

    // plan() should be synchronous parameter inference — no fetch, no LLM
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const plan = await skillModule.plan('Schedule a meeting tomorrow', {});

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(plan.isDeterministic).toBe(true);
    expect(plan.estimatedCostUsd).toBe(0);

    fetchSpy.mockRestore();
  });
});
