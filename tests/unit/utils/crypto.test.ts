import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, deriveKey } from '../../../src/utils/crypto.js';

describe('crypto utilities', () => {
  const testSecret = 'my-super-secret-passphrase';
  const alternateSecret = 'a-different-secret-passphrase';

  describe('encrypt / decrypt round-trip', () => {
    it('produces the original text after encrypt then decrypt', () => {
      const plaintext = 'Hello, OAuth tokens!';
      const ciphertext = encrypt(plaintext, testSecret);
      const recovered = decrypt(ciphertext, testSecret);

      expect(recovered).toBe(plaintext);
    });

    it('handles empty string input', () => {
      const plaintext = '';
      const ciphertext = encrypt(plaintext, testSecret);
      const recovered = decrypt(ciphertext, testSecret);

      expect(recovered).toBe(plaintext);
    });

    it('handles long plaintext input', () => {
      const plaintext = 'A'.repeat(10_000);
      const ciphertext = encrypt(plaintext, testSecret);
      const recovered = decrypt(ciphertext, testSecret);

      expect(recovered).toBe(plaintext);
    });

    it('handles unicode content correctly', () => {
      const plaintext = 'Token: eyJ0b2tlbiI6Ik \u2603 \u{1F600}';
      const ciphertext = encrypt(plaintext, testSecret);
      const recovered = decrypt(ciphertext, testSecret);

      expect(recovered).toBe(plaintext);
    });

    it('handles JSON-encoded tokens round-trip', () => {
      const tokenPayload = JSON.stringify({
        access_token: 'ya29.a0AfH6SM',
        refresh_token: '1//0dN3FZ',
        token_type: 'Bearer',
        expiry_date: 1700000000000,
      });
      const ciphertext = encrypt(tokenPayload, testSecret);
      const recovered = decrypt(ciphertext, testSecret);

      expect(recovered).toBe(tokenPayload);
      expect(JSON.parse(recovered)).toEqual(JSON.parse(tokenPayload));
    });
  });

  describe('ciphertext uniqueness', () => {
    it('produces different ciphertexts for different secrets', () => {
      const plaintext = 'same plaintext content';
      const ciphertext1 = encrypt(plaintext, testSecret);
      const ciphertext2 = encrypt(plaintext, alternateSecret);

      expect(ciphertext1).not.toBe(ciphertext2);
    });

    it('produces different ciphertexts for the same plaintext and secret (random salt/IV)', () => {
      const plaintext = 'deterministic check';
      const ciphertext1 = encrypt(plaintext, testSecret);
      const ciphertext2 = encrypt(plaintext, testSecret);

      // Each encryption generates a random salt and IV, so ciphertexts differ
      expect(ciphertext1).not.toBe(ciphertext2);

      // But both should decrypt back to the same plaintext
      expect(decrypt(ciphertext1, testSecret)).toBe(plaintext);
      expect(decrypt(ciphertext2, testSecret)).toBe(plaintext);
    });
  });

  describe('tamper detection', () => {
    it('fails decryption when ciphertext is tampered with', () => {
      const plaintext = 'sensitive data';
      const ciphertext = encrypt(plaintext, testSecret);

      // Decode, flip a byte in the encrypted portion, re-encode
      const buffer = Buffer.from(ciphertext, 'base64');
      const tamperedIndex = buffer.length - 1;
      buffer[tamperedIndex] = (buffer[tamperedIndex] ?? 0) ^ 0xff;
      const tampered = buffer.toString('base64');

      expect(() => decrypt(tampered, testSecret)).toThrow('Decryption failed');
    });

    it('fails decryption with the wrong secret', () => {
      const plaintext = 'secret data';
      const ciphertext = encrypt(plaintext, testSecret);

      expect(() => decrypt(ciphertext, alternateSecret)).toThrow('Decryption failed');
    });

    it('fails decryption with truncated ciphertext', () => {
      const plaintext = 'some data';
      const ciphertext = encrypt(plaintext, testSecret);

      // Truncate to below the minimum required length
      const truncated = Buffer.from(ciphertext, 'base64').subarray(0, 10).toString('base64');

      expect(() => decrypt(truncated, testSecret)).toThrow('Decryption failed');
    });

    it('fails decryption with completely invalid base64 data', () => {
      expect(() => decrypt('not-valid-base64!!!', testSecret)).toThrow('Decryption failed');
    });
  });

  describe('deriveKey', () => {
    it('is deterministic with the same secret and salt', () => {
      const key1 = deriveKey(testSecret, 'test-salt');
      const key2 = deriveKey(testSecret, 'test-salt');

      expect(key1.equals(key2)).toBe(true);
    });

    it('produces different keys for different secrets', () => {
      const key1 = deriveKey(testSecret, 'same-salt');
      const key2 = deriveKey(alternateSecret, 'same-salt');

      expect(key1.equals(key2)).toBe(false);
    });

    it('produces different keys for different salts', () => {
      const key1 = deriveKey(testSecret, 'salt-one');
      const key2 = deriveKey(testSecret, 'salt-two');

      expect(key1.equals(key2)).toBe(false);
    });

    it('returns a 32-byte key (AES-256)', () => {
      const key = deriveKey(testSecret, 'some-salt');

      expect(key.length).toBe(32);
    });

    it('uses default salt when none is provided', () => {
      const key1 = deriveKey(testSecret);
      const key2 = deriveKey(testSecret);

      // Should be deterministic with the default salt
      expect(key1.equals(key2)).toBe(true);
    });

    it('default salt produces different key than explicit salt', () => {
      const keyDefault = deriveKey(testSecret);
      const keyExplicit = deriveKey(testSecret, 'explicit-salt');

      expect(keyDefault.equals(keyExplicit)).toBe(false);
    });
  });
});
