/**
 * Encryption utilities for securing OAuth tokens and other sensitive data.
 * Uses AES-256-GCM for authenticated encryption and PBKDF2 for key derivation.
 * All functions are synchronous and use Node.js built-in crypto module only.
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
} from 'node:crypto';

/** Length of the initialization vector for AES-GCM in bytes. */
const IV_LENGTH = 12;

/** Length of the authentication tag for AES-GCM in bytes. */
const AUTH_TAG_LENGTH = 16;

/** Length of the derived key for AES-256 in bytes. */
const KEY_LENGTH = 32;

/** Number of PBKDF2 iterations for key derivation. */
const PBKDF2_ITERATIONS = 100_000;

/** Length of the salt for key derivation in bytes. */
const SALT_LENGTH = 16;

/** Digest algorithm for PBKDF2. */
const PBKDF2_DIGEST = 'sha512';

/** Cipher algorithm. */
const CIPHER_ALGORITHM = 'aes-256-gcm';

/**
 * Derive a cryptographic key from a user-provided secret using PBKDF2.
 * The same secret and salt always produce the same key (deterministic).
 *
 * @param secret - The user-provided secret (e.g., a passphrase).
 * @param salt - Optional salt for derivation. If omitted, a default salt is used.
 *               For encryption, a random salt is generated and prepended to ciphertext.
 * @returns A 32-byte Buffer suitable for AES-256 keying material.
 */
export function deriveKey(secret: string, salt?: string): Buffer {
  const saltBuffer = salt
    ? Buffer.from(salt, 'utf-8')
    : Buffer.from('lil-dude-default-salt', 'utf-8');

  return pbkdf2Sync(
    secret,
    saltBuffer,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST,
  );
}

/**
 * Encrypt a plaintext string using AES-256-GCM with a derived key.
 * The output is a base64-encoded string containing:
 *   [salt (16 bytes)] + [IV (12 bytes)] + [authTag (16 bytes)] + [ciphertext]
 *
 * A random salt is generated per encryption to ensure unique keys per message.
 *
 * @param plaintext - The string to encrypt.
 * @param secret - The user-provided secret used for key derivation.
 * @returns A base64-encoded ciphertext string with prepended salt, IV, and auth tag.
 * @throws {Error} If encryption fails.
 */
export function encrypt(plaintext: string, secret: string): string {
  try {
    const salt = randomBytes(SALT_LENGTH);
    const key = pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Combine: salt + iv + authTag + ciphertext
    const combined = Buffer.concat([salt, iv, authTag, encrypted]);
    return combined.toString('base64');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Encryption failed: ${message}`);
  }
}

/**
 * Decrypt a base64-encoded ciphertext string produced by {@link encrypt}.
 * Extracts the salt, IV, and auth tag from the ciphertext, derives the key,
 * and performs authenticated decryption.
 *
 * @param ciphertext - The base64-encoded ciphertext to decrypt.
 * @param secret - The user-provided secret used for key derivation.
 * @returns The decrypted plaintext string.
 * @throws {Error} If decryption fails (wrong secret, tampered data, etc.).
 */
export function decrypt(ciphertext: string, secret: string): string {
  try {
    const combined = Buffer.from(ciphertext, 'base64');

    const minimumLength = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
    if (combined.length < minimumLength) {
      throw new Error('Ciphertext is too short to contain required components');
    }

    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
    );
    const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);

    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf-8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Decryption failed: ${message}`);
  }
}
