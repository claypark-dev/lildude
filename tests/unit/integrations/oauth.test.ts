/**
 * Tests for the OAuth2 handler module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';
import {
  initiateOAuthFlow,
  handleOAuthCallback,
  getValidAccessToken,
  cleanExpiredStates,
  OAUTH_PRESETS,
  type OAuthProviderConfig,
} from '../../../src/integrations/oauth.js';
import { storeToken, getToken } from '../../../src/integrations/oauth-store.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

/** Helper to build a test provider config. */
function testProviderConfig(overrides?: Partial<OAuthProviderConfig>): OAuthProviderConfig {
  return {
    name: 'test-provider',
    authorizationUrl: 'https://auth.example.com/authorize',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    defaultScopes: ['read', 'write'],
    redirectUri: 'http://localhost:3000/api/v1/oauth/callback',
    ...overrides,
  };
}

describe('OAuth2 Handler', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  describe('OAUTH_PRESETS', () => {
    it('has Google preset with correct endpoints', () => {
      expect(OAUTH_PRESETS.google).toBeDefined();
      expect(OAUTH_PRESETS.google.name).toBe('google');
      expect(OAUTH_PRESETS.google.authorizationUrl).toContain('accounts.google.com');
      expect(OAUTH_PRESETS.google.tokenUrl).toContain('googleapis.com');
      expect(OAUTH_PRESETS.google.defaultScopes.length).toBeGreaterThan(0);
    });

    it('has Microsoft preset with correct endpoints', () => {
      expect(OAUTH_PRESETS.microsoft).toBeDefined();
      expect(OAUTH_PRESETS.microsoft.name).toBe('microsoft');
      expect(OAUTH_PRESETS.microsoft.authorizationUrl).toContain('login.microsoftonline.com');
      expect(OAUTH_PRESETS.microsoft.tokenUrl).toContain('login.microsoftonline.com');
      expect(OAUTH_PRESETS.microsoft.defaultScopes.length).toBeGreaterThan(0);
    });
  });

  describe('initiateOAuthFlow', () => {
    it('returns an authorization URL and state', () => {
      const config = testProviderConfig();
      const result = initiateOAuthFlow(db, config);

      expect(result.authorizationUrl).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.state.length).toBeGreaterThan(0);
    });

    it('builds authorization URL with correct parameters', () => {
      const config = testProviderConfig();
      const result = initiateOAuthFlow(db, config);
      const url = new URL(result.authorizationUrl);

      expect(url.origin + url.pathname).toBe(config.authorizationUrl);
      expect(url.searchParams.get('client_id')).toBe(config.clientId);
      expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe(result.state);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeDefined();
    });

    it('uses default scopes when none specified', () => {
      const config = testProviderConfig({ defaultScopes: ['scope1', 'scope2'] });
      const result = initiateOAuthFlow(db, config);
      const url = new URL(result.authorizationUrl);

      expect(url.searchParams.get('scope')).toBe('scope1 scope2');
    });

    it('uses custom scopes when provided', () => {
      const config = testProviderConfig({ defaultScopes: ['default'] });
      const result = initiateOAuthFlow(db, config, ['custom1', 'custom2']);
      const url = new URL(result.authorizationUrl);

      expect(url.searchParams.get('scope')).toBe('custom1 custom2');
    });

    it('stores state in the database for CSRF validation', () => {
      const config = testProviderConfig();
      const result = initiateOAuthFlow(db, config);

      const row = db.prepare('SELECT * FROM oauth_state WHERE state = ?').get(result.state) as {
        state: string;
        provider: string;
        code_verifier: string;
      } | undefined;

      expect(row).toBeDefined();
      expect(row!.provider).toBe(config.name);
      expect(row!.code_verifier.length).toBeGreaterThan(0);
    });

    it('generates unique state for each flow initiation', () => {
      const config = testProviderConfig();
      const result1 = initiateOAuthFlow(db, config);
      const result2 = initiateOAuthFlow(db, config);

      expect(result1.state).not.toBe(result2.state);
    });

    it('generates PKCE code challenge (S256)', () => {
      const config = testProviderConfig();
      const result = initiateOAuthFlow(db, config);
      const url = new URL(result.authorizationUrl);

      const challenge = url.searchParams.get('code_challenge');
      expect(challenge).toBeDefined();
      // S256 challenge is base64url-encoded SHA-256 hash (43 chars)
      expect(challenge!.length).toBe(43);
    });
  });

  describe('handleOAuthCallback', () => {
    it('returns null for invalid state', async () => {
      const config = testProviderConfig();
      const result = await handleOAuthCallback(db, config, 'auth-code', 'invalid-state');

      expect(result).toBeNull();
    });

    it('returns null for expired state', async () => {
      const config = testProviderConfig();

      // Insert an expired state
      db.prepare(
        `INSERT INTO oauth_state (state, provider, code_verifier, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('expired-state', config.name, 'verifier', config.redirectUri, '2020-01-01T00:00:00Z');

      const result = await handleOAuthCallback(db, config, 'auth-code', 'expired-state');
      expect(result).toBeNull();
    });

    it('returns null for provider mismatch', async () => {
      const config = testProviderConfig({ name: 'google' });

      // Insert state for a different provider
      const expiresAt = new Date(Date.now() + 600_000).toISOString();
      db.prepare(
        `INSERT INTO oauth_state (state, provider, code_verifier, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('test-state', 'microsoft', 'verifier', config.redirectUri, expiresAt);

      const result = await handleOAuthCallback(db, config, 'auth-code', 'test-state');
      expect(result).toBeNull();
    });

    it('consumes state (one-time use)', async () => {
      const config = testProviderConfig();
      const { state } = initiateOAuthFlow(db, config);

      // Mock fetch to return an error (we just want to test state consumption)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('bad request'),
      }));

      await handleOAuthCallback(db, config, 'auth-code', state);

      // State should be consumed (deleted)
      const row = db.prepare('SELECT * FROM oauth_state WHERE state = ?').get(state);
      expect(row).toBeUndefined();
    });

    it('exchanges code for tokens on successful response', async () => {
      const config = testProviderConfig();
      const { state } = initiateOAuthFlow(db, config);

      // Mock successful token exchange
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'read write',
        }),
      }));

      const tokenId = await handleOAuthCallback(db, config, 'auth-code-123', state);
      expect(tokenId).toBeDefined();
      expect(typeof tokenId).toBe('string');

      // Verify token was stored
      const token = getToken(db, config.name);
      expect(token).not.toBeNull();
      expect(token!.accessToken).toBe('new-access-token');
      expect(token!.refreshToken).toBe('new-refresh-token');
    });

    it('sends PKCE code_verifier in token exchange', async () => {
      const config = testProviderConfig();
      const { state } = initiateOAuthFlow(db, config);

      // Capture the fetch call
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'token',
          token_type: 'Bearer',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await handleOAuthCallback(db, config, 'auth-code', state);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(config.tokenUrl);

      const body = new URLSearchParams(options.body);
      expect(body.get('code_verifier')).toBeDefined();
      expect(body.get('code_verifier')!.length).toBeGreaterThan(0);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth-code');
    });

    it('returns null on fetch error', async () => {
      const config = testProviderConfig();
      const { state } = initiateOAuthFlow(db, config);

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await handleOAuthCallback(db, config, 'auth-code', state);
      expect(result).toBeNull();
    });
  });

  describe('getValidAccessToken', () => {
    it('returns null when no token exists', async () => {
      const config = testProviderConfig();
      const result = await getValidAccessToken(db, config);
      expect(result).toBeNull();
    });

    it('returns access token when not expired', async () => {
      const config = testProviderConfig();
      storeToken(db, {
        provider: config.name,
        accessToken: 'valid-token',
        expiresIn: 3600, // 1 hour
      });

      const result = await getValidAccessToken(db, config);
      expect(result).toBe('valid-token');
    });

    it('returns null when token expired and no refresh token', async () => {
      const config = testProviderConfig();
      storeToken(db, {
        provider: config.name,
        accessToken: 'expired-token',
        expiresIn: -100, // already expired
      });

      const result = await getValidAccessToken(db, config);
      expect(result).toBeNull();
    });

    it('refreshes token when expired and refresh token exists', async () => {
      const config = testProviderConfig();
      storeToken(db, {
        provider: config.name,
        accessToken: 'old-token',
        refreshToken: 'my-refresh-token',
        expiresIn: -100, // already expired
      });

      // Mock successful refresh
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'fresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      }));

      const result = await getValidAccessToken(db, config);
      expect(result).toBe('fresh-token');

      // Verify the old token was replaced
      const token = getToken(db, config.name);
      expect(token!.accessToken).toBe('fresh-token');
    });

    it('sends refresh token in refresh request', async () => {
      const config = testProviderConfig();
      storeToken(db, {
        provider: config.name,
        accessToken: 'old-token',
        refreshToken: 'my-refresh-token',
        expiresIn: -100,
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-token',
          token_type: 'Bearer',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await getValidAccessToken(db, config);

      const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('my-refresh-token');
      expect(body.get('client_id')).toBe(config.clientId);
    });

    it('returns null when refresh fails', async () => {
      const config = testProviderConfig();
      storeToken(db, {
        provider: config.name,
        accessToken: 'old-token',
        refreshToken: 'bad-refresh',
        expiresIn: -100,
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('invalid_grant'),
      }));

      const result = await getValidAccessToken(db, config);
      expect(result).toBeNull();
    });
  });

  describe('cleanExpiredStates', () => {
    it('removes expired state records', () => {
      // Insert expired states
      db.prepare(
        `INSERT INTO oauth_state (state, provider, code_verifier, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('old-state-1', 'google', 'v1', 'http://localhost:3000/cb', '2020-01-01T00:00:00Z');
      db.prepare(
        `INSERT INTO oauth_state (state, provider, code_verifier, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('old-state-2', 'google', 'v2', 'http://localhost:3000/cb', '2020-06-01T00:00:00Z');

      // Insert valid state
      const futureDate = new Date(Date.now() + 600_000).toISOString();
      db.prepare(
        `INSERT INTO oauth_state (state, provider, code_verifier, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('valid-state', 'google', 'v3', 'http://localhost:3000/cb', futureDate);

      cleanExpiredStates(db);

      const remaining = db.prepare('SELECT COUNT(*) as count FROM oauth_state').get() as { count: number };
      expect(remaining.count).toBe(1);

      const validRow = db.prepare('SELECT * FROM oauth_state WHERE state = ?').get('valid-state');
      expect(validRow).toBeDefined();
    });
  });
});
