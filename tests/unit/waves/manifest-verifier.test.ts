import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  signManifest,
  verifySignature,
  verifyWaveDirectory,
  createSignatureFile,
} from '../../../src/waves/manifest-verifier.js';

const TEST_KEY = 'test-signing-key-minimum-16-chars';
const TEST_MANIFEST = JSON.stringify({
  name: 'test-wave',
  version: '1.0.0',
  description: 'A test wave',
  author: 'tester',
});

describe('manifest-verifier', () => {
  describe('signManifest', () => {
    it('produces a hex-encoded signature', () => {
      const signature = signManifest(TEST_MANIFEST, TEST_KEY);
      expect(signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces consistent signatures for same input', () => {
      const sig1 = signManifest(TEST_MANIFEST, TEST_KEY);
      const sig2 = signManifest(TEST_MANIFEST, TEST_KEY);
      expect(sig1).toBe(sig2);
    });

    it('produces different signatures for different manifests', () => {
      const sig1 = signManifest(TEST_MANIFEST, TEST_KEY);
      const sig2 = signManifest('{"name":"other"}', TEST_KEY);
      expect(sig1).not.toBe(sig2);
    });

    it('produces different signatures for different keys', () => {
      const sig1 = signManifest(TEST_MANIFEST, TEST_KEY);
      const sig2 = signManifest(TEST_MANIFEST, 'another-key-at-least-16-chars');
      expect(sig1).not.toBe(sig2);
    });

    it('rejects short signing keys', () => {
      expect(() => signManifest(TEST_MANIFEST, 'short')).toThrow(
        'at least 16 characters',
      );
    });

    it('rejects empty signing keys', () => {
      expect(() => signManifest(TEST_MANIFEST, '')).toThrow(
        'at least 16 characters',
      );
    });
  });

  describe('verifySignature', () => {
    it('returns true for valid signature', () => {
      const signature = signManifest(TEST_MANIFEST, TEST_KEY);
      expect(verifySignature(TEST_MANIFEST, signature, TEST_KEY)).toBe(true);
    });

    it('returns false for tampered manifest', () => {
      const signature = signManifest(TEST_MANIFEST, TEST_KEY);
      expect(
        verifySignature('{"tampered":true}', signature, TEST_KEY),
      ).toBe(false);
    });

    it('returns false for wrong key', () => {
      const signature = signManifest(TEST_MANIFEST, TEST_KEY);
      expect(
        verifySignature(TEST_MANIFEST, signature, 'wrong-key-at-least-16chars'),
      ).toBe(false);
    });

    it('returns false for corrupted signature', () => {
      expect(
        verifySignature(TEST_MANIFEST, 'corrupted', TEST_KEY),
      ).toBe(false);
    });

    it('returns false for empty signature', () => {
      expect(verifySignature(TEST_MANIFEST, '', TEST_KEY)).toBe(false);
    });
  });

  describe('verifyWaveDirectory', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `verifier-test-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns unverified when no wave.json exists', () => {
      const result = verifyWaveDirectory(tempDir, TEST_KEY);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('No wave.json');
    });

    it('returns unsigned when no .wave-signature exists', () => {
      writeFileSync(join(tempDir, 'wave.json'), TEST_MANIFEST);

      const result = verifyWaveDirectory(tempDir, TEST_KEY);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('unsigned');
    });

    it('returns unverified when no signing key provided', () => {
      writeFileSync(join(tempDir, 'wave.json'), TEST_MANIFEST);
      writeFileSync(join(tempDir, '.wave-signature'), '{}');

      const result = verifyWaveDirectory(tempDir);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('No signing key');
    });

    it('verifies a correctly signed wave', () => {
      writeFileSync(join(tempDir, 'wave.json'), TEST_MANIFEST);
      const sigFile = createSignatureFile(TEST_MANIFEST, TEST_KEY, 'ci-test');
      writeFileSync(join(tempDir, '.wave-signature'), sigFile);

      const result = verifyWaveDirectory(tempDir, TEST_KEY);
      expect(result.verified).toBe(true);
      expect(result.reason).toContain('valid');
      expect(result.signer).toBe('ci-test');
      expect(result.signedAt).toBeDefined();
    });

    it('rejects a tampered manifest', () => {
      writeFileSync(join(tempDir, 'wave.json'), TEST_MANIFEST);
      const sigFile = createSignatureFile(TEST_MANIFEST, TEST_KEY, 'ci-test');
      writeFileSync(join(tempDir, '.wave-signature'), sigFile);

      // Tamper with manifest after signing
      writeFileSync(
        join(tempDir, 'wave.json'),
        JSON.stringify({ name: 'tampered-wave' }),
      );

      const result = verifyWaveDirectory(tempDir, TEST_KEY);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('does not match');
    });

    it('rejects invalid signature file format', () => {
      writeFileSync(join(tempDir, 'wave.json'), TEST_MANIFEST);
      writeFileSync(join(tempDir, '.wave-signature'), '{"invalid": true}');

      const result = verifyWaveDirectory(tempDir, TEST_KEY);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Invalid signature file');
    });

    it('rejects unsupported algorithm', () => {
      writeFileSync(join(tempDir, 'wave.json'), TEST_MANIFEST);
      writeFileSync(
        join(tempDir, '.wave-signature'),
        JSON.stringify({
          signature: 'abc123',
          algorithm: 'sha512',
          signer: 'test',
          signedAt: new Date().toISOString(),
        }),
      );

      const result = verifyWaveDirectory(tempDir, TEST_KEY);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Unsupported algorithm');
    });

    it('handles malformed JSON in signature file', () => {
      writeFileSync(join(tempDir, 'wave.json'), TEST_MANIFEST);
      writeFileSync(join(tempDir, '.wave-signature'), 'not-json');

      const result = verifyWaveDirectory(tempDir, TEST_KEY);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Verification error');
    });
  });

  describe('createSignatureFile', () => {
    it('creates valid JSON with expected fields', () => {
      const sigFile = createSignatureFile(TEST_MANIFEST, TEST_KEY, 'ci-bot');
      const parsed = JSON.parse(sigFile);

      expect(parsed.signature).toMatch(/^[0-9a-f]{64}$/);
      expect(parsed.algorithm).toBe('sha256');
      expect(parsed.signer).toBe('ci-bot');
      expect(parsed.signedAt).toBeDefined();
    });

    it('creates verifiable signatures', () => {
      const sigFile = createSignatureFile(TEST_MANIFEST, TEST_KEY, 'test');
      const parsed = JSON.parse(sigFile);

      expect(
        verifySignature(TEST_MANIFEST, parsed.signature, TEST_KEY),
      ).toBe(true);
    });
  });
});
