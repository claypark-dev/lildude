import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateCommunityWaveName,
  computePackageHash,
  packageWave,
  type PackageFile,
} from '../../../src/waves/packager.js';

/** Create a minimal valid wave directory for testing. */
function createTestWave(dir: string, overrides?: Record<string, unknown>): void {
  const manifest = {
    name: 'test-wave',
    version: '1.0.0',
    description: 'A test wave',
    author: 'tester',
    permissions: { domains: [], shell: [], directories: [] },
    triggers: ['test'],
    deterministic: true,
    tools: [],
    minTier: 'basic',
    entryPoint: 'index.js',
    ...overrides,
  };

  writeFileSync(join(dir, 'wave.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(dir, 'index.js'),
    `var execute = async function(params) { return "test result"; };`,
  );
}

describe('packager', () => {
  describe('validateCommunityWaveName', () => {
    it('accepts valid kebab-case names', () => {
      expect(validateCommunityWaveName('my-wave')).toEqual({ valid: true });
      expect(validateCommunityWaveName('weather-checker')).toEqual({ valid: true });
      expect(validateCommunityWaveName('wave-v2')).toEqual({ valid: true });
      expect(validateCommunityWaveName('abc')).toEqual({ valid: true });
    });

    it('rejects names shorter than 3 characters', () => {
      const result = validateCommunityWaveName('ab');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('at least 3');
    });

    it('rejects names longer than 50 characters', () => {
      const longName = 'a'.repeat(51);
      const result = validateCommunityWaveName(longName);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('50 characters');
    });

    it('rejects non-kebab-case names', () => {
      expect(validateCommunityWaveName('MyWave').valid).toBe(false);
      expect(validateCommunityWaveName('my_wave').valid).toBe(false);
      expect(validateCommunityWaveName('my wave').valid).toBe(false);
      expect(validateCommunityWaveName('my--wave').valid).toBe(false);
      expect(validateCommunityWaveName('-my-wave').valid).toBe(false);
    });

    it('rejects reserved prefixes', () => {
      const result1 = validateCommunityWaveName('lil-dude-wave');
      expect(result1.valid).toBe(false);
      expect(result1.reason).toContain('reserved');

      const result2 = validateCommunityWaveName('lildude-wave');
      expect(result2.valid).toBe(false);
      expect(result2.reason).toContain('reserved');
    });

    it('rejects bundled wave names', () => {
      const result = validateCommunityWaveName('email-reader');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('bundled wave');
    });
  });

  describe('computePackageHash', () => {
    it('produces a deterministic hash', () => {
      const files: PackageFile[] = [
        { relativePath: 'wave.json', content: '{"name":"test"}', hash: 'abc' },
        { relativePath: 'index.js', content: 'var x = 1;', hash: 'def' },
      ];

      const hash1 = computePackageHash(files);
      const hash2 = computePackageHash(files);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different content', () => {
      const files1: PackageFile[] = [
        { relativePath: 'index.js', content: 'var x = 1;', hash: 'abc' },
      ];
      const files2: PackageFile[] = [
        { relativePath: 'index.js', content: 'var x = 2;', hash: 'def' },
      ];

      expect(computePackageHash(files1)).not.toBe(computePackageHash(files2));
    });

    it('is order-independent (sorts by path)', () => {
      const filesAB: PackageFile[] = [
        { relativePath: 'a.js', content: 'a', hash: '1' },
        { relativePath: 'b.js', content: 'b', hash: '2' },
      ];
      const filesBA: PackageFile[] = [
        { relativePath: 'b.js', content: 'b', hash: '2' },
        { relativePath: 'a.js', content: 'a', hash: '1' },
      ];

      expect(computePackageHash(filesAB)).toBe(computePackageHash(filesBA));
    });

    it('returns a 64-char hex string (SHA-256)', () => {
      const files: PackageFile[] = [
        { relativePath: 'test.js', content: 'hello', hash: 'x' },
      ];
      const hash = computePackageHash(files);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('packageWave', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'wave-packager-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('packages a valid wave directory', async () => {
      createTestWave(tempDir);

      const result = await packageWave(tempDir, { skipSandbox: true });

      expect(result.manifest.name).toBe('test-wave');
      expect(result.manifest.version).toBe('1.0.0');
      expect(result.files.length).toBe(2); // wave.json + index.js
      expect(result.scanResult.passed).toBe(true);
      expect(result.packageHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.totalSizeBytes).toBeGreaterThan(0);
    });

    it('throws if directory does not exist', async () => {
      await expect(packageWave('/nonexistent/path', { skipSandbox: true }))
        .rejects.toThrow('does not exist');
    });

    it('throws if wave.json is missing', async () => {
      writeFileSync(join(tempDir, 'index.js'), 'var x = 1;');
      await expect(packageWave(tempDir, { skipSandbox: true }))
        .rejects.toThrow('wave.json not found');
    });

    it('throws if wave.json is invalid JSON', async () => {
      writeFileSync(join(tempDir, 'wave.json'), 'not json{');
      writeFileSync(join(tempDir, 'index.js'), 'var x = 1;');
      await expect(packageWave(tempDir, { skipSandbox: true }))
        .rejects.toThrow('not valid JSON');
    });

    it('throws if manifest fails validation', async () => {
      writeFileSync(join(tempDir, 'wave.json'), JSON.stringify({ name: 'x' }));
      writeFileSync(join(tempDir, 'index.js'), 'var x = 1;');
      await expect(packageWave(tempDir, { skipSandbox: true }))
        .rejects.toThrow('Invalid wave manifest');
    });

    it('throws if wave name violates community rules', async () => {
      createTestWave(tempDir, { name: 'lil-dude-wave' });
      await expect(packageWave(tempDir, { skipSandbox: true }))
        .rejects.toThrow('reserved');
    });

    it('throws if entry point is missing', async () => {
      writeFileSync(join(tempDir, 'wave.json'), JSON.stringify({
        name: 'my-wave',
        version: '1.0.0',
        description: 'Test',
        author: 'tester',
        permissions: { domains: [], shell: [], directories: [] },
        triggers: ['test'],
        deterministic: true,
        tools: [],
        minTier: 'basic',
        entryPoint: 'missing.js',
      }));
      await expect(packageWave(tempDir, { skipSandbox: true }))
        .rejects.toThrow('Entry point');
    });

    it('throws if code has critical security findings', async () => {
      createTestWave(tempDir);
      writeFileSync(join(tempDir, 'index.js'), 'eval("dangerous code")');
      await expect(packageWave(tempDir, { skipSandbox: true }))
        .rejects.toThrow('Security scan failed');
    });

    it('throws if package exceeds size limit', async () => {
      createTestWave(tempDir);
      // Write a large file (>100KB)
      const largeContent = 'x'.repeat(110 * 1024);
      writeFileSync(join(tempDir, 'big-data.txt'), largeContent);
      await expect(packageWave(tempDir, { skipSandbox: true }))
        .rejects.toThrow('exceeds maximum');
    });

    it('skips hidden files and node_modules', async () => {
      createTestWave(tempDir);
      writeFileSync(join(tempDir, '.hidden'), 'secret');
      mkdirSync(join(tempDir, 'node_modules'));
      writeFileSync(join(tempDir, 'node_modules', 'pkg.js'), 'module');

      const result = await packageWave(tempDir, { skipSandbox: true });
      const paths = result.files.map((f) => f.relativePath);
      expect(paths).not.toContain('.hidden');
      expect(paths).not.toContain('node_modules/pkg.js');
    });

    it('includes subdirectory files', async () => {
      createTestWave(tempDir);
      mkdirSync(join(tempDir, 'lib'));
      writeFileSync(join(tempDir, 'lib', 'helper.js'), 'var helper = true;');

      const result = await packageWave(tempDir, { skipSandbox: true });
      const paths = result.files.map((f) => f.relativePath);
      expect(paths).toContain('lib/helper.js');
    });

    it('runs sandbox when not skipped (with valid execute function)', async () => {
      createTestWave(tempDir);

      const result = await packageWave(tempDir, { skipSandbox: false });
      expect(result.sandboxResult).not.toBeNull();
      expect(result.sandboxResult!.success).toBe(true);
    });

    it('returns null sandboxResult when skipped', async () => {
      createTestWave(tempDir);

      const result = await packageWave(tempDir, { skipSandbox: true });
      expect(result.sandboxResult).toBeNull();
    });
  });
});
