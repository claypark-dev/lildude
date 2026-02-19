/**
 * OAuth2 flow helper for Google Calendar skill.
 * Handles authorization URL generation, code exchange, token refresh,
 * and encrypted token storage via the knowledge persistence layer.
 *
 * Tokens are encrypted with AES-256-GCM before storage and decrypted on retrieval.
 * Never logs or exposes raw tokens.
 */

import { z } from 'zod';

/** Category used for storing OAuth tokens in the knowledge table. */
const KNOWLEDGE_CATEGORY = 'oauth';

/** Key used for storing Google OAuth tokens in the knowledge table. */
const KNOWLEDGE_KEY = 'google-calendar-tokens';

/** Google OAuth2 endpoints. */
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Required OAuth scopes for Google Calendar. */
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

/** Zod schema for validating Google OAuth token response. */
const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  token_type: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
});

/** Zod schema for validating stored token structure. */
const StoredTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  tokenType: z.string(),
});

/**
 * Generate a Google OAuth2 authorization URL for the user to visit.
 * The user must authorize calendar access and provide the resulting code.
 *
 * @param {string} clientId - The Google OAuth2 client ID.
 * @param {string} redirectUri - The redirect URI configured in the Google Cloud console.
 * @returns {{ url: string }} An object containing the authorization URL.
 */
export function startOAuthFlow(clientId, redirectUri) {
  if (!clientId || typeof clientId !== 'string') {
    throw new Error('OAuth client ID is required');
  }
  if (!redirectUri || typeof redirectUri !== 'string') {
    throw new Error('OAuth redirect URI is required');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });

  return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` };
}

/**
 * Exchange an authorization code for access and refresh tokens.
 *
 * @param {string} code - The authorization code from the OAuth callback.
 * @param {string} clientId - The Google OAuth2 client ID.
 * @param {string} clientSecret - The Google OAuth2 client secret.
 * @param {string} redirectUri - The redirect URI matching the one used in startOAuthFlow.
 * @returns {Promise<{ accessToken: string; refreshToken: string; expiresAt: number; tokenType: string }>}
 */
export async function handleCallback(code, clientId, clientSecret, redirectUri) {
  if (!code || typeof code !== 'string') {
    throw new Error('Authorization code is required');
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
    }

    const rawBody = await response.json();
    const parsed = TokenResponseSchema.parse(rawBody);

    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? '',
      expiresAt: Date.now() + parsed.expires_in * 1000,
      tokenType: parsed.token_type,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OAuth callback handling failed: ${message}`);
  }
}

/**
 * Refresh an expired access token using a refresh token.
 *
 * @param {string} currentRefreshToken - The stored refresh token.
 * @param {string} clientId - The Google OAuth2 client ID.
 * @param {string} clientSecret - The Google OAuth2 client secret.
 * @returns {Promise<{ accessToken: string; refreshToken: string; expiresAt: number; tokenType: string }>}
 */
export async function refreshToken(currentRefreshToken, clientId, clientSecret) {
  if (!currentRefreshToken || typeof currentRefreshToken !== 'string') {
    throw new Error('Refresh token is required');
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: currentRefreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${errorBody}`);
    }

    const rawBody = await response.json();
    const parsed = TokenResponseSchema.parse(rawBody);

    return {
      accessToken: parsed.access_token,
      // Google may or may not return a new refresh token
      refreshToken: parsed.refresh_token ?? currentRefreshToken,
      expiresAt: Date.now() + parsed.expires_in * 1000,
      tokenType: parsed.token_type,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Token refresh failed: ${message}`);
  }
}

/**
 * Encrypt and store OAuth tokens in the knowledge persistence layer.
 *
 * @param {object} db - The better-sqlite3 database instance.
 * @param {{ accessToken: string; refreshToken: string; expiresAt: number; tokenType: string }} tokens - The tokens to store.
 * @param {string} encryptionSecret - The secret used for encrypting tokens.
 * @param {{ encrypt: (plaintext: string, secret: string) => string }} cryptoUtils - Encryption utilities.
 * @param {{ upsertKnowledge: Function }} knowledgeStore - Knowledge persistence functions.
 */
export function storeTokens(db, tokens, encryptionSecret, cryptoUtils, knowledgeStore) {
  try {
    const validated = StoredTokensSchema.parse(tokens);
    const serialized = JSON.stringify(validated);
    const encrypted = cryptoUtils.encrypt(serialized, encryptionSecret);

    knowledgeStore.upsertKnowledge(db, {
      category: KNOWLEDGE_CATEGORY,
      key: KNOWLEDGE_KEY,
      value: encrypted,
      confidence: 1.0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to store OAuth tokens: ${message}`);
  }
}

/**
 * Retrieve and decrypt OAuth tokens from the knowledge persistence layer.
 *
 * @param {object} db - The better-sqlite3 database instance.
 * @param {string} encryptionSecret - The secret used for decrypting tokens.
 * @param {{ decrypt: (ciphertext: string, secret: string) => string }} cryptoUtils - Decryption utilities.
 * @param {{ getKnowledge: Function }} knowledgeStore - Knowledge persistence functions.
 * @returns {{ accessToken: string; refreshToken: string; expiresAt: number; tokenType: string } | null}
 *          The decrypted tokens, or null if none are stored.
 */
export function getTokens(db, encryptionSecret, cryptoUtils, knowledgeStore) {
  try {
    const rows = knowledgeStore.getKnowledge(db, KNOWLEDGE_CATEGORY, KNOWLEDGE_KEY);

    if (!rows || rows.length === 0) {
      return null;
    }

    // Use the most recent entry (first row, ordered by created_at DESC)
    const encryptedValue = rows[0].value;
    const decrypted = cryptoUtils.decrypt(encryptedValue, encryptionSecret);
    const parsed = JSON.parse(decrypted);
    const validated = StoredTokensSchema.parse(parsed);

    return validated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to retrieve OAuth tokens: ${message}`);
  }
}

/**
 * Check whether stored tokens are expired (with a 5-minute buffer).
 *
 * @param {{ expiresAt: number }} tokens - The tokens with an expiry timestamp.
 * @returns {boolean} True if the tokens are expired or within 5 minutes of expiry.
 */
export function isTokenExpired(tokens) {
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() >= tokens.expiresAt - bufferMs;
}
