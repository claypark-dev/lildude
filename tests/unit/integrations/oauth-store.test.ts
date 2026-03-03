/**
 * Tests for the OAuth token storage module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';
import {
  storeToken,
  getToken,
  isTokenExpired,
  deleteToken,
  listTokens,
  type OAuthToken,
} from '../../../src/integrations/oauth-store.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('OAuthStore', () => {
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

  describe('storeToken', () => {
    it('stores a token and returns an ID', () => {
      const tokenId = storeToken(db, {
        provider: 'google',
        accessToken: 'test-access-token',
        tokenType: 'Bearer',
      });

      expect(tokenId).toBeDefined();
      expect(typeof tokenId).toBe('string');
      expect(tokenId.length).toBeGreaterThan(0);
    });

    it('stores a token with all optional fields', () => {
      const tokenId = storeToken(db, {
        provider: 'google',
        accountLabel: 'work',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        tokenType: 'Bearer',
        scope: 'email calendar',
        expiresIn: 3600,
      });

      expect(tokenId).toBeDefined();

      const token = getToken(db, 'google', 'work');
      expect(token).not.toBeNull();
      expect(token!.provider).toBe('google');
      expect(token!.accountLabel).toBe('work');
      expect(token!.scope).toBe('email calendar');
      expect(token!.expiresAt).toBeInstanceOf(Date);
    });

    it('uses "default" as account label when not specified', () => {
      storeToken(db, {
        provider: 'google',
        accessToken: 'test-token',
      });

      const token = getToken(db, 'google', 'default');
      expect(token).not.toBeNull();
      expect(token!.accountLabel).toBe('default');
    });

    it('replaces existing token for same provider + account', () => {
      storeToken(db, {
        provider: 'google',
        accessToken: 'first-token',
      });

      storeToken(db, {
        provider: 'google',
        accessToken: 'second-token',
      });

      const token = getToken(db, 'google');
      expect(token).not.toBeNull();
      expect(token!.accessToken).toBe('second-token');
    });
  });

  describe('getToken', () => {
    it('returns null for non-existent provider', () => {
      const token = getToken(db, 'nonexistent');
      expect(token).toBeNull();
    });

    it('decrypts the access token correctly', () => {
      const originalToken = 'ya29.super-secret-access-token-12345';
      storeToken(db, {
        provider: 'google',
        accessToken: originalToken,
      });

      const token = getToken(db, 'google');
      expect(token).not.toBeNull();
      expect(token!.accessToken).toBe(originalToken);
    });

    it('decrypts the refresh token correctly', () => {
      const originalRefresh = '1//0abc-refresh-token-xyz';
      storeToken(db, {
        provider: 'google',
        accessToken: 'access-token',
        refreshToken: originalRefresh,
      });

      const token = getToken(db, 'google');
      expect(token).not.toBeNull();
      expect(token!.refreshToken).toBe(originalRefresh);
    });

    it('returns undefined for refreshToken when not stored', () => {
      storeToken(db, {
        provider: 'google',
        accessToken: 'access-token',
      });

      const token = getToken(db, 'google');
      expect(token).not.toBeNull();
      expect(token!.refreshToken).toBeUndefined();
    });

    it('distinguishes tokens by account label', () => {
      storeToken(db, {
        provider: 'google',
        accountLabel: 'personal',
        accessToken: 'personal-token',
      });

      storeToken(db, {
        provider: 'google',
        accountLabel: 'work',
        accessToken: 'work-token',
      });

      const personal = getToken(db, 'google', 'personal');
      const work = getToken(db, 'google', 'work');

      expect(personal!.accessToken).toBe('personal-token');
      expect(work!.accessToken).toBe('work-token');
    });

    it('distinguishes tokens by provider', () => {
      storeToken(db, {
        provider: 'google',
        accessToken: 'google-token',
      });

      storeToken(db, {
        provider: 'microsoft',
        accessToken: 'microsoft-token',
      });

      const googleToken = getToken(db, 'google');
      const msToken = getToken(db, 'microsoft');

      expect(googleToken!.accessToken).toBe('google-token');
      expect(msToken!.accessToken).toBe('microsoft-token');
    });
  });

  describe('isTokenExpired', () => {
    it('returns false when no expiry is set', () => {
      const token: OAuthToken = {
        id: 'test',
        provider: 'google',
        accountLabel: 'default',
        accessToken: 'token',
        tokenType: 'Bearer',
      };

      expect(isTokenExpired(token)).toBe(false);
    });

    it('returns false for a token expiring far in the future', () => {
      const token: OAuthToken = {
        id: 'test',
        provider: 'google',
        accountLabel: 'default',
        accessToken: 'token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
      };

      expect(isTokenExpired(token)).toBe(false);
    });

    it('returns true for an already expired token', () => {
      const token: OAuthToken = {
        id: 'test',
        provider: 'google',
        accountLabel: 'default',
        accessToken: 'token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      };

      expect(isTokenExpired(token)).toBe(true);
    });

    it('returns true when token expires within default buffer (5 min)', () => {
      const token: OAuthToken = {
        id: 'test',
        provider: 'google',
        accountLabel: 'default',
        accessToken: 'token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 200 * 1000), // 200 seconds (~3.3 min)
      };

      // Default buffer is 300 seconds (5 min), so 200s from now is "expired"
      expect(isTokenExpired(token)).toBe(true);
    });

    it('respects custom buffer seconds', () => {
      const token: OAuthToken = {
        id: 'test',
        provider: 'google',
        accountLabel: 'default',
        accessToken: 'token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 200 * 1000), // 200 seconds
      };

      // With 60s buffer, 200s from now is NOT expired
      expect(isTokenExpired(token, 60)).toBe(false);
      // With 300s buffer, 200s from now IS expired
      expect(isTokenExpired(token, 300)).toBe(true);
    });
  });

  describe('deleteToken', () => {
    it('deletes an existing token', () => {
      storeToken(db, {
        provider: 'google',
        accessToken: 'token-to-delete',
      });

      const deleted = deleteToken(db, 'google');
      expect(deleted).toBe(true);

      const token = getToken(db, 'google');
      expect(token).toBeNull();
    });

    it('returns false when no token exists', () => {
      const deleted = deleteToken(db, 'nonexistent');
      expect(deleted).toBe(false);
    });

    it('only deletes the matching provider + account', () => {
      storeToken(db, {
        provider: 'google',
        accountLabel: 'personal',
        accessToken: 'personal-token',
      });

      storeToken(db, {
        provider: 'google',
        accountLabel: 'work',
        accessToken: 'work-token',
      });

      deleteToken(db, 'google', 'personal');

      expect(getToken(db, 'google', 'personal')).toBeNull();
      expect(getToken(db, 'google', 'work')).not.toBeNull();
    });
  });

  describe('listTokens', () => {
    it('returns empty array when no tokens stored', () => {
      const tokens = listTokens(db);
      expect(tokens).toEqual([]);
    });

    it('lists stored tokens without decrypting', () => {
      storeToken(db, {
        provider: 'google',
        accessToken: 'secret',
        scope: 'email',
      });

      storeToken(db, {
        provider: 'microsoft',
        accountLabel: 'work',
        accessToken: 'also-secret',
        scope: 'mail.read',
      });

      const tokens = listTokens(db);
      expect(tokens).toHaveLength(2);

      // Should not contain actual token values
      const tokenStrings = JSON.stringify(tokens);
      expect(tokenStrings).not.toContain('secret');
      expect(tokenStrings).not.toContain('also-secret');

      // Should contain metadata
      expect(tokens.some((t) => t.provider === 'google')).toBe(true);
      expect(tokens.some((t) => t.provider === 'microsoft')).toBe(true);
      expect(tokens.some((t) => t.accountLabel === 'work')).toBe(true);
    });

    it('returns tokens ordered by provider and account label', () => {
      storeToken(db, { provider: 'microsoft', accessToken: 't1' });
      storeToken(db, { provider: 'google', accountLabel: 'work', accessToken: 't2' });
      storeToken(db, { provider: 'google', accountLabel: 'default', accessToken: 't3' });

      const tokens = listTokens(db);
      expect(tokens[0].provider).toBe('google');
      expect(tokens[0].accountLabel).toBe('default');
      expect(tokens[1].provider).toBe('google');
      expect(tokens[1].accountLabel).toBe('work');
      expect(tokens[2].provider).toBe('microsoft');
    });
  });

  describe('encryption round-trip', () => {
    it('encrypts tokens differently each time (random IV)', () => {
      storeToken(db, { provider: 'test1', accessToken: 'same-token' });
      storeToken(db, { provider: 'test2', accessToken: 'same-token' });

      const rows = db.prepare('SELECT iv, access_token_encrypted FROM oauth_tokens').all() as Array<{
        iv: string;
        access_token_encrypted: string;
      }>;

      // Different IVs should produce different ciphertext even for same plaintext
      expect(rows[0].iv).not.toBe(rows[1].iv);
      expect(rows[0].access_token_encrypted).not.toBe(rows[1].access_token_encrypted);
    });

    it('stored tokens are not readable as plaintext in DB', () => {
      const plaintext = 'ya29.this-is-my-secret-access-token';
      storeToken(db, { provider: 'google', accessToken: plaintext });

      const row = db.prepare('SELECT access_token_encrypted FROM oauth_tokens WHERE provider = ?').get('google') as {
        access_token_encrypted: string;
      };

      expect(row.access_token_encrypted).not.toBe(plaintext);
      expect(row.access_token_encrypted).not.toContain(plaintext);
    });
  });
});
