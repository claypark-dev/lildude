import { describe, it, expect } from 'vitest';
import { createSanitizedEnv, executeInSandbox } from '../../../src/security/sandbox.js';

describe('createSanitizedEnv', () => {
  it('strips variables matching _KEY pattern', () => {
    process.env['TEST_API_KEY'] = 'secret123';
    const env = createSanitizedEnv();
    expect(env['TEST_API_KEY']).toBeUndefined();
    delete process.env['TEST_API_KEY'];
  });

  it('strips variables matching _TOKEN pattern', () => {
    process.env['GITHUB_TOKEN'] = 'ghp_xxxx';
    const env = createSanitizedEnv();
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    delete process.env['GITHUB_TOKEN'];
  });

  it('strips variables matching _SECRET pattern', () => {
    process.env['APP_SECRET'] = 'shhh';
    const env = createSanitizedEnv();
    expect(env['APP_SECRET']).toBeUndefined();
    delete process.env['APP_SECRET'];
  });

  it('strips variables matching _PASSWORD pattern', () => {
    process.env['DB_PASSWORD'] = 'pass123';
    const env = createSanitizedEnv();
    expect(env['DB_PASSWORD']).toBeUndefined();
    delete process.env['DB_PASSWORD'];
  });

  it('strips ANTHROPIC_ variables', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-xxx';
    const env = createSanitizedEnv();
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('strips OPENAI_ variables', () => {
    process.env['OPENAI_API_KEY'] = 'sk-xxx';
    const env = createSanitizedEnv();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    delete process.env['OPENAI_API_KEY'];
  });

  it('preserves safe variables like HOME', () => {
    const env = createSanitizedEnv();
    expect(env['HOME']).toBeDefined();
  });

  it('restricts PATH to safe directories', () => {
    const env = createSanitizedEnv();
    expect(env['PATH']).toBe('/usr/local/bin:/usr/bin:/bin');
  });

  it('merges additional env variables', () => {
    const env = createSanitizedEnv({ CUSTOM_VAR: 'hello' });
    expect(env['CUSTOM_VAR']).toBe('hello');
  });

  it('additional env overrides defaults', () => {
    const env = createSanitizedEnv({ PATH: '/custom/bin' });
    expect(env['PATH']).toBe('/custom/bin');
  });
});

describe('executeInSandbox', () => {
  it('runs echo and captures stdout', async () => {
    const result = await executeInSandbox('echo', ['hello world'], {
      cwd: process.cwd(),
      timeout: 5000,
      maxOutputBytes: 1024,
    });
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('captures stderr from failing command', async () => {
    const result = await executeInSandbox('ls', ['/nonexistent_directory_xyz'], {
      cwd: process.cwd(),
      timeout: 5000,
      maxOutputBytes: 1024,
    });
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.exitCode).not.toBe(0);
  });

  it('handles timeout', async () => {
    const result = await executeInSandbox('sleep', ['10'], {
      cwd: process.cwd(),
      timeout: 100,
      maxOutputBytes: 1024,
    });
    expect(result.timedOut).toBe(true);
  });

  it('handles non-existent binary', async () => {
    const result = await executeInSandbox('/nonexistent_binary_xyz', [], {
      cwd: process.cwd(),
      timeout: 5000,
      maxOutputBytes: 1024,
    });
    // Non-existent binary should fail — error may appear in stderr or via error event
    expect(result.exitCode).not.toBe(0);
  });

  it('uses shell: false (no shell injection)', async () => {
    // If shell were true, this would expand; with shell false it's a literal arg
    const result = await executeInSandbox('echo', ['$(whoami)'], {
      cwd: process.cwd(),
      timeout: 5000,
      maxOutputBytes: 1024,
    });
    // With shell: false, $(whoami) is treated as a literal string
    expect(result.stdout.trim()).toBe('$(whoami)');
  });

  it('strips sensitive env vars from child process', async () => {
    process.env['TEST_SECRET_KEY_FOR_SANDBOX'] = 'should_not_appear';
    const result = await executeInSandbox('env', [], {
      cwd: process.cwd(),
      timeout: 5000,
      maxOutputBytes: 65536,
    });
    expect(result.stdout).not.toContain('TEST_SECRET_KEY_FOR_SANDBOX');
    delete process.env['TEST_SECRET_KEY_FOR_SANDBOX'];
  });
});
