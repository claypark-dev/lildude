import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkNodeVersion,
  checkConfigExists,
  checkConfigValid,
  checkDatabaseExists,
  checkHardware,
  checkApiKeys,
  getDoctorResults,
} from '../../../src/cli/doctor.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('doctor checks', () => {
  describe('checkNodeVersion', () => {
    it('passes for Node.js >= 20', () => {
      const result = checkNodeVersion();
      const major = parseInt(process.versions.node.split('.')[0], 10);
      if (major >= 20) {
        expect(result.passed).toBe(true);
        expect(result.message).toContain(process.versions.node);
      } else {
        expect(result.passed).toBe(false);
      }
    });

    it('returns the correct check name', () => {
      const result = checkNodeVersion();
      expect(result.name).toBe('Node.js version');
    });
  });

  describe('checkConfigExists', () => {
    const originalHome = process.env.LIL_DUDE_HOME;

    afterEach(() => {
      if (originalHome !== undefined) {
        process.env.LIL_DUDE_HOME = originalHome;
      } else {
        delete process.env.LIL_DUDE_HOME;
      }
    });

    it('fails when config does not exist', () => {
      process.env.LIL_DUDE_HOME = join(tmpdir(), 'lil-dude-test-no-config-' + Date.now());
      const result = checkConfigExists();
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Not found');
      expect(result.message).toContain('lil-dude onboard');
    });

    it('passes when config exists', () => {
      const testDir = join(tmpdir(), 'lil-dude-test-config-' + Date.now());
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'config.json'), '{}');
      process.env.LIL_DUDE_HOME = testDir;

      const result = checkConfigExists();
      expect(result.passed).toBe(true);

      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('checkConfigValid', () => {
    const originalHome = process.env.LIL_DUDE_HOME;

    afterEach(() => {
      if (originalHome !== undefined) {
        process.env.LIL_DUDE_HOME = originalHome;
      } else {
        delete process.env.LIL_DUDE_HOME;
      }
    });

    it('passes with valid config', async () => {
      const testDir = join(tmpdir(), 'lil-dude-test-valid-' + Date.now());
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'config.json'), JSON.stringify({ version: 1 }));
      process.env.LIL_DUDE_HOME = testDir;

      const result = await checkConfigValid();
      expect(result.passed).toBe(true);
      expect(result.message).toContain('Valid');

      rmSync(testDir, { recursive: true, force: true });
    });

    it('passes with empty config (uses defaults)', async () => {
      const testDir = join(tmpdir(), 'lil-dude-test-empty-' + Date.now());
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'config.json'), '{}');
      process.env.LIL_DUDE_HOME = testDir;

      const result = await checkConfigValid();
      expect(result.passed).toBe(true);

      rmSync(testDir, { recursive: true, force: true });
    });

    it('fails with invalid JSON', async () => {
      const testDir = join(tmpdir(), 'lil-dude-test-invalid-json-' + Date.now());
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'config.json'), '{broken json');
      process.env.LIL_DUDE_HOME = testDir;

      const result = await checkConfigValid();
      expect(result.passed).toBe(false);
      expect(result.message).toContain('invalid JSON');

      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('checkDatabaseExists', () => {
    const originalHome = process.env.LIL_DUDE_HOME;

    afterEach(() => {
      if (originalHome !== undefined) {
        process.env.LIL_DUDE_HOME = originalHome;
      } else {
        delete process.env.LIL_DUDE_HOME;
      }
    });

    it('fails when database does not exist', () => {
      process.env.LIL_DUDE_HOME = join(tmpdir(), 'lil-dude-test-no-db-' + Date.now());
      const result = checkDatabaseExists();
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Not found');
    });

    it('passes when database exists', () => {
      const testDir = join(tmpdir(), 'lil-dude-test-db-' + Date.now());
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'lil-dude.db'), '');
      process.env.LIL_DUDE_HOME = testDir;

      const result = checkDatabaseExists();
      expect(result.passed).toBe(true);

      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('checkHardware', () => {
    it('passes and returns hardware info', async () => {
      const result = await checkHardware();
      expect(result.passed).toBe(true);
      expect(result.name).toBe('Hardware');
      expect(result.message).toContain('RAM');
      expect(result.message).toContain('cores');
    });
  });

  describe('checkApiKeys', () => {
    const originalHome = process.env.LIL_DUDE_HOME;
    const originalAnthropicKey = process.env.LIL_DUDE_ANTHROPIC_KEY;

    afterEach(() => {
      if (originalHome !== undefined) {
        process.env.LIL_DUDE_HOME = originalHome;
      } else {
        delete process.env.LIL_DUDE_HOME;
      }
      if (originalAnthropicKey !== undefined) {
        process.env.LIL_DUDE_ANTHROPIC_KEY = originalAnthropicKey;
      } else {
        delete process.env.LIL_DUDE_ANTHROPIC_KEY;
      }
    });

    it('fails when no providers are configured', async () => {
      const testDir = join(tmpdir(), 'lil-dude-test-no-keys-' + Date.now());
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'config.json'), '{}');
      process.env.LIL_DUDE_HOME = testDir;
      delete process.env.LIL_DUDE_ANTHROPIC_KEY;

      const result = await checkApiKeys();
      expect(result.passed).toBe(false);
      expect(result.message).toContain('No providers configured');

      rmSync(testDir, { recursive: true, force: true });
    });

    it('passes when Anthropic key is configured via env var', async () => {
      const testDir = join(tmpdir(), 'lil-dude-test-with-key-' + Date.now());
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'config.json'), '{}');
      process.env.LIL_DUDE_HOME = testDir;
      process.env.LIL_DUDE_ANTHROPIC_KEY = 'sk-ant-test-key';

      const result = await checkApiKeys();
      expect(result.passed).toBe(true);
      expect(result.message).toContain('Anthropic');

      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('getDoctorResults', () => {
    const originalHome = process.env.LIL_DUDE_HOME;

    beforeEach(() => {
      const testDir = join(tmpdir(), 'lil-dude-test-doctor-' + Date.now());
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'config.json'), '{}');
      process.env.LIL_DUDE_HOME = testDir;
    });

    afterEach(() => {
      if (originalHome !== undefined) {
        process.env.LIL_DUDE_HOME = originalHome;
      } else {
        delete process.env.LIL_DUDE_HOME;
      }
    });

    it('returns all check results', async () => {
      const results = await getDoctorResults();
      expect(results.length).toBeGreaterThanOrEqual(7);
      for (const result of results) {
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('passed');
        expect(result).toHaveProperty('message');
      }
    });

    it('each result has the correct shape', async () => {
      const results = await getDoctorResults();
      const names = results.map(r => r.name);
      expect(names).toContain('Node.js version');
      expect(names).toContain('Config file');
      expect(names).toContain('Config validation');
      expect(names).toContain('Database file');
      expect(names).toContain('Hardware');
      expect(names).toContain('API keys');
    });
  });
});
