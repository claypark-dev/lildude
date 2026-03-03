/**
 * OAuth token storage with encryption at rest — S2.N.4
 *
 * Tokens are encrypted using AES-256-GCM before storing in SQLite.
 * The encryption key is derived from a per-installation secret stored
 * in the config directory (~/.lil-dude/.oauth-key).
 *
 * If no key file exists, one is generated on first use.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { homeDir } from '../config/loader.js';
import { createModuleLogger } from '../utils/logger.js';

const storeLogger = createModuleLogger('oauth-store');

/** Algorithm used for token encryption. */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT = 'lildude-oauth-v1';

/** Stored OAuth token (decrypted). */
export interface OAuthToken {
  id: string;
  provider: string;
  accountLabel: string;
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt?: Date;
}

/** Options for storing a new token. */
export interface StoreTokenOptions {
  provider: string;
  accountLabel?: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
}

/**
 * Get or generate the encryption key for OAuth tokens.
 * The key is derived from a random secret stored in ~/.lil-dude/.oauth-key.
 *
 * @returns A 32-byte encryption key.
 */
function getEncryptionKey(): Buffer {
  const keyDir = homeDir();
  const keyPath = join(keyDir, '.oauth-key');

  let secret: string;

  if (existsSync(keyPath)) {
    secret = readFileSync(keyPath, 'utf-8').trim();
  } else {
    secret = randomBytes(48).toString('hex');
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(keyPath, secret, { mode: 0o600 });
    storeLogger.info('Generated new OAuth encryption key');
  }

  return scryptSync(secret, SALT, KEY_LENGTH);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt.
 * @param key - The 32-byte encryption key.
 * @returns Object with encrypted text, IV, and auth tag (all hex-encoded).
 */
function encrypt(plaintext: string, key: Buffer): { encrypted: string; iv: string; authTag: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

/**
 * Decrypt an encrypted string using AES-256-GCM.
 *
 * @param encrypted - Hex-encoded encrypted text.
 * @param ivHex - Hex-encoded initialization vector.
 * @param authTagHex - Hex-encoded GCM authentication tag.
 * @param key - The 32-byte encryption key.
 * @returns The decrypted plaintext.
 */
function decrypt(encrypted: string, ivHex: string, authTagHex: string, key: Buffer): string {
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');

  return decrypted;
}

/**
 * Store an OAuth token (encrypted at rest).
 *
 * @param db - Database instance.
 * @param options - Token storage options.
 * @returns The stored token ID.
 */
export function storeToken(db: BetterSqlite3.Database, options: StoreTokenOptions): string {
  const key = getEncryptionKey();
  const tokenId = nanoid();
  const accountLabel = options.accountLabel ?? 'default';

  const accessEncrypted = encrypt(options.accessToken, key);
  let refreshEncrypted: { encrypted: string; iv: string; authTag: string } | undefined;

  let refreshTokenPacked: string | null = null;

  if (options.refreshToken) {
    refreshEncrypted = encrypt(options.refreshToken, key);
    // Pack IV:authTag:ciphertext so refresh can be decrypted independently
    refreshTokenPacked = `${refreshEncrypted.iv}:${refreshEncrypted.authTag}:${refreshEncrypted.encrypted}`;
  }

  const expiresAt = options.expiresIn
    ? new Date(Date.now() + options.expiresIn * 1000).toISOString()
    : undefined;

  db.prepare(
    `INSERT OR REPLACE INTO oauth_tokens
     (id, provider, account_label, access_token_encrypted, refresh_token_encrypted,
      token_type, scope, expires_at, iv, auth_tag, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).run(
    tokenId,
    options.provider,
    accountLabel,
    accessEncrypted.encrypted,
    refreshTokenPacked,
    options.tokenType ?? 'Bearer',
    options.scope ?? null,
    expiresAt ?? null,
    accessEncrypted.iv,
    accessEncrypted.authTag,
  );

  storeLogger.info({ provider: options.provider, accountLabel }, 'OAuth token stored');
  return tokenId;
}

/** Shape of an oauth_tokens DB row. */
interface TokenRow {
  id: string;
  provider: string;
  account_label: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_type: string;
  scope: string | null;
  expires_at: string | null;
  iv: string;
  auth_tag: string;
}

/**
 * Retrieve and decrypt an OAuth token.
 *
 * @param db - Database instance.
 * @param provider - The OAuth provider name.
 * @param accountLabel - The account label (default: 'default').
 * @returns The decrypted token, or null if not found.
 */
export function getToken(
  db: BetterSqlite3.Database,
  provider: string,
  accountLabel: string = 'default',
): OAuthToken | null {
  const row = db.prepare(
    'SELECT * FROM oauth_tokens WHERE provider = ? AND account_label = ?',
  ).get(provider, accountLabel) as TokenRow | undefined;

  if (!row) {
    return null;
  }

  try {
    const key = getEncryptionKey();
    const accessToken = decrypt(row.access_token_encrypted, row.iv, row.auth_tag, key);
    let refreshToken: string | undefined;

    if (row.refresh_token_encrypted) {
      // Refresh token is packed as iv:authTag:ciphertext
      const parts = row.refresh_token_encrypted.split(':');
      if (parts.length === 3) {
        refreshToken = decrypt(parts[2], parts[0], parts[1], key);
      }
    }

    return {
      id: row.id,
      provider: row.provider,
      accountLabel: row.account_label,
      accessToken,
      refreshToken,
      tokenType: row.token_type,
      scope: row.scope ?? undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    storeLogger.error({ provider, accountLabel, error: message }, 'Failed to decrypt token');
    return null;
  }
}

/**
 * Check if a token is expired or will expire within the given buffer.
 *
 * @param token - The OAuth token to check.
 * @param bufferSeconds - How many seconds before expiry to consider it expired. Default: 300 (5 min).
 * @returns True if the token is expired or will expire within the buffer.
 */
export function isTokenExpired(token: OAuthToken, bufferSeconds: number = 300): boolean {
  if (!token.expiresAt) {
    return false; // No expiry set, assume valid
  }
  return token.expiresAt.getTime() < Date.now() + bufferSeconds * 1000;
}

/**
 * Delete an OAuth token.
 *
 * @param db - Database instance.
 * @param provider - The OAuth provider name.
 * @param accountLabel - The account label.
 * @returns True if a token was deleted.
 */
export function deleteToken(
  db: BetterSqlite3.Database,
  provider: string,
  accountLabel: string = 'default',
): boolean {
  const result = db.prepare(
    'DELETE FROM oauth_tokens WHERE provider = ? AND account_label = ?',
  ).run(provider, accountLabel);

  if (result.changes > 0) {
    storeLogger.info({ provider, accountLabel }, 'OAuth token deleted');
  }

  return result.changes > 0;
}

/**
 * List all stored OAuth providers and accounts (without decrypting tokens).
 *
 * @param db - Database instance.
 * @returns Array of provider/account pairs with expiry info.
 */
export function listTokens(
  db: BetterSqlite3.Database,
): Array<{ provider: string; accountLabel: string; scope: string | null; expiresAt: string | null }> {
  const rows = db.prepare(
    'SELECT provider, account_label, scope, expires_at FROM oauth_tokens ORDER BY provider, account_label',
  ).all() as Array<{ provider: string; account_label: string; scope: string | null; expires_at: string | null }>;

  return rows.map((row) => ({
    provider: row.provider,
    accountLabel: row.account_label,
    scope: row.scope,
    expiresAt: row.expires_at,
  }));
}
