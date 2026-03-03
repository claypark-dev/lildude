/**
 * OAuth2 handler — S2.N.4
 *
 * Implements the OAuth2 Authorization Code flow with PKCE.
 * Supports multiple providers via a config-driven approach.
 *
 * Flow:
 *   1. User initiates auth → we generate state + PKCE code_verifier/challenge
 *   2. Redirect user to provider's auth URL
 *   3. Provider redirects back with auth code
 *   4. We exchange code for tokens using PKCE
 *   5. Tokens are encrypted and stored via oauth-store
 *   6. Automatic refresh when tokens expire
 */

import { createHash, randomBytes } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { storeToken, getToken, isTokenExpired } from './oauth-store.js';
import { createModuleLogger } from '../utils/logger.js';

const oauthLogger = createModuleLogger('oauth');

/** OAuth provider configuration. */
export interface OAuthProviderConfig {
  /** Unique provider name (e.g., 'google'). */
  name: string;
  /** OAuth authorization endpoint. */
  authorizationUrl: string;
  /** OAuth token exchange endpoint. */
  tokenUrl: string;
  /** Client ID from the provider. */
  clientId: string;
  /** Client secret (optional for PKCE-only flows). */
  clientSecret?: string;
  /** Default scopes to request. */
  defaultScopes: string[];
  /** Redirect URI (where the provider sends the user back). */
  redirectUri: string;
}

/** Result of initiating an OAuth flow. */
export interface OAuthInitResult {
  /** The URL to redirect the user to for authorization. */
  authorizationUrl: string;
  /** The state parameter (stored for CSRF validation). */
  state: string;
}

/** Token response from the OAuth provider. */
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

/** Pre-configured OAuth provider presets. */
export const OAUTH_PRESETS: Record<string, Omit<OAuthProviderConfig, 'clientId' | 'clientSecret' | 'redirectUri'>> = {
  google: {
    name: 'google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    defaultScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar',
    ],
  },
  microsoft: {
    name: 'microsoft',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    defaultScopes: [
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Calendars.ReadWrite',
    ],
  },
};

/**
 * Generate a PKCE code verifier (random string).
 * @returns A 128-character random string using URL-safe characters.
 */
function generateCodeVerifier(): string {
  return randomBytes(96).toString('base64url');
}

/**
 * Generate a PKCE code challenge from a code verifier.
 * Uses S256 method (SHA-256 hash, base64url-encoded).
 *
 * @param verifier - The code verifier string.
 * @returns The S256 code challenge.
 */
function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Store OAuth state for CSRF protection during the auth flow.
 *
 * @param db - Database instance.
 * @param state - Random state parameter.
 * @param provider - Provider name.
 * @param codeVerifier - PKCE code verifier.
 * @param redirectUri - The redirect URI used for this flow.
 */
function storeOAuthState(
  db: BetterSqlite3.Database,
  state: string,
  provider: string,
  codeVerifier: string,
  redirectUri: string,
): void {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
  db.prepare(
    `INSERT INTO oauth_state (state, provider, code_verifier, redirect_uri, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(state, provider, codeVerifier, redirectUri, expiresAt);
}

/** Shape of an oauth_state DB row. */
interface OAuthStateRow {
  state: string;
  provider: string;
  code_verifier: string;
  redirect_uri: string;
  expires_at: string;
}

/**
 * Retrieve and consume the OAuth state (one-time use).
 *
 * @param db - Database instance.
 * @param state - The state parameter from the callback.
 * @returns The state record if valid and not expired, null otherwise.
 */
function consumeOAuthState(
  db: BetterSqlite3.Database,
  state: string,
): OAuthStateRow | null {
  const row = db.prepare(
    'SELECT * FROM oauth_state WHERE state = ?',
  ).get(state) as OAuthStateRow | undefined;

  if (!row) {
    return null;
  }

  // Delete the state (one-time use)
  db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);

  // Check expiry
  if (new Date(row.expires_at) < new Date()) {
    oauthLogger.warn({ state, provider: row.provider }, 'OAuth state expired');
    return null;
  }

  return row;
}

/**
 * Clean up expired OAuth state records.
 *
 * @param db - Database instance.
 */
export function cleanExpiredStates(db: BetterSqlite3.Database): void {
  db.prepare('DELETE FROM oauth_state WHERE expires_at < CURRENT_TIMESTAMP').run();
}

/**
 * Initiate an OAuth2 authorization flow with PKCE.
 *
 * Generates the PKCE code verifier/challenge, stores the state for CSRF
 * protection, and returns the authorization URL for the user to visit.
 *
 * @param db - Database instance.
 * @param providerConfig - The OAuth provider configuration.
 * @param scopes - Optional scope override (defaults to provider's defaultScopes).
 * @returns The authorization URL and state parameter.
 */
export function initiateOAuthFlow(
  db: BetterSqlite3.Database,
  providerConfig: OAuthProviderConfig,
  scopes?: string[],
): OAuthInitResult {
  const state = nanoid(32);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const scopeString = (scopes ?? providerConfig.defaultScopes).join(' ');

  // Store state for callback validation
  storeOAuthState(db, state, providerConfig.name, codeVerifier, providerConfig.redirectUri);

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: providerConfig.clientId,
    redirect_uri: providerConfig.redirectUri,
    response_type: 'code',
    scope: scopeString,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline', // Request refresh token (Google-specific, ignored by others)
    prompt: 'consent', // Force consent to get refresh token
  });

  const authorizationUrl = `${providerConfig.authorizationUrl}?${params.toString()}`;

  oauthLogger.info(
    { provider: providerConfig.name, scopes: scopeString },
    'OAuth flow initiated',
  );

  return { authorizationUrl, state };
}

/**
 * Handle the OAuth callback — exchange the authorization code for tokens.
 *
 * Validates the state parameter, exchanges the code using PKCE,
 * encrypts and stores the tokens.
 *
 * @param db - Database instance.
 * @param providerConfig - The OAuth provider configuration.
 * @param code - The authorization code from the callback.
 * @param state - The state parameter from the callback.
 * @returns The stored token ID, or null if the exchange failed.
 */
export async function handleOAuthCallback(
  db: BetterSqlite3.Database,
  providerConfig: OAuthProviderConfig,
  code: string,
  state: string,
): Promise<string | null> {
  // Validate state (CSRF protection)
  const storedState = consumeOAuthState(db, state);
  if (!storedState) {
    oauthLogger.warn({ state, provider: providerConfig.name }, 'Invalid or expired OAuth state');
    return null;
  }

  if (storedState.provider !== providerConfig.name) {
    oauthLogger.warn(
      { expected: providerConfig.name, got: storedState.provider },
      'OAuth state provider mismatch',
    );
    return null;
  }

  // Exchange code for tokens
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: storedState.redirect_uri,
      client_id: providerConfig.clientId,
      code_verifier: storedState.code_verifier,
    });

    if (providerConfig.clientSecret) {
      body.set('client_secret', providerConfig.clientSecret);
    }

    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      oauthLogger.error(
        { provider: providerConfig.name, status: response.status, error: errorText },
        'Token exchange failed',
      );
      return null;
    }

    const tokenResponse = await response.json() as TokenResponse;

    // Store encrypted tokens
    const tokenId = storeToken(db, {
      provider: providerConfig.name,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenType: tokenResponse.token_type,
      scope: tokenResponse.scope,
      expiresIn: tokenResponse.expires_in,
    });

    oauthLogger.info(
      { provider: providerConfig.name, hasRefreshToken: !!tokenResponse.refresh_token },
      'OAuth tokens stored successfully',
    );

    return tokenId;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    oauthLogger.error({ provider: providerConfig.name, error: message }, 'Token exchange error');
    return null;
  }
}

/**
 * Get a valid access token for a provider, refreshing if needed.
 *
 * If the stored token is expired and a refresh token exists, automatically
 * refreshes the access token. Returns null if no valid token is available.
 *
 * @param db - Database instance.
 * @param providerConfig - The OAuth provider configuration.
 * @param accountLabel - The account label (default: 'default').
 * @returns A valid access token string, or null.
 */
export async function getValidAccessToken(
  db: BetterSqlite3.Database,
  providerConfig: OAuthProviderConfig,
  accountLabel: string = 'default',
): Promise<string | null> {
  const token = getToken(db, providerConfig.name, accountLabel);

  if (!token) {
    return null;
  }

  if (!isTokenExpired(token)) {
    return token.accessToken;
  }

  // Token is expired — try to refresh
  if (!token.refreshToken) {
    oauthLogger.warn(
      { provider: providerConfig.name, accountLabel },
      'Token expired and no refresh token available',
    );
    return null;
  }

  oauthLogger.info(
    { provider: providerConfig.name, accountLabel },
    'Refreshing expired OAuth token',
  );

  return refreshAccessToken(db, providerConfig, token.refreshToken, accountLabel);
}

/**
 * Refresh an expired access token using the refresh token.
 *
 * @param db - Database instance.
 * @param providerConfig - The OAuth provider configuration.
 * @param refreshToken - The refresh token.
 * @param accountLabel - The account label.
 * @returns The new access token, or null on failure.
 */
async function refreshAccessToken(
  db: BetterSqlite3.Database,
  providerConfig: OAuthProviderConfig,
  refreshToken: string,
  accountLabel: string,
): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: providerConfig.clientId,
    });

    if (providerConfig.clientSecret) {
      body.set('client_secret', providerConfig.clientSecret);
    }

    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      oauthLogger.error(
        { provider: providerConfig.name, status: response.status, error: errorText },
        'Token refresh failed',
      );
      return null;
    }

    const tokenResponse = await response.json() as TokenResponse;

    // Store the new tokens (keep existing refresh token if not returned)
    storeToken(db, {
      provider: providerConfig.name,
      accountLabel,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token ?? refreshToken,
      tokenType: tokenResponse.token_type,
      scope: tokenResponse.scope,
      expiresIn: tokenResponse.expires_in,
    });

    oauthLogger.info(
      { provider: providerConfig.name, accountLabel },
      'OAuth token refreshed successfully',
    );

    return tokenResponse.access_token;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    oauthLogger.error({ provider: providerConfig.name, error: message }, 'Token refresh error');
    return null;
  }
}
