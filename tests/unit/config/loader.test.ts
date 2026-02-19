import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('config loader', () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    vi.resetModules();
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lildude-config-test-'));
    process.env.LIL_DUDE_HOME = tmpDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('applies defaults when no config file exists', async () => {
    const { loadConfig } = await import('../../../src/config/loader.js');
    const config = await loadConfig();

    expect(config.version).toBe(1);
    expect(config.user.name).toBe('Friend');
    expect(config.user.timezone).toBe('America/New_York');
    expect(config.providers.anthropic.enabled).toBe(false);
    expect(config.providers.ollama.baseUrl).toBe('http://localhost:11434');
    expect(config.providers.ollama.model).toBe('llama3.2');
    expect(config.channels.webchat.enabled).toBe(true);
    expect(config.channels.discord.enabled).toBe(false);
    expect(config.security.level).toBe(3);
    expect(config.budget.monthlyLimitUsd).toBe(20);
    expect(config.budget.perTaskDefaultLimitUsd).toBe(0.50);
    expect(config.budget.warningThresholdPct).toBe(0.8);
    expect(config.budget.hardStopEnabled).toBe(true);
    expect(config.gateway.wsPort).toBe(18420);
    expect(config.gateway.httpPort).toBe(18421);
    expect(config.gateway.host).toBe('127.0.0.1');
    expect(config.preferences.enableModelRouting).toBe(true);
    expect(config.preferences.briefingTime).toBe('08:00');
    expect(config.preferences.powerUserMode).toBe(false);
  });

  it('loads values from config file', async () => {
    const configData = {
      version: 1,
      user: { name: 'TestUser', timezone: 'Europe/London' },
      budget: { monthlyLimitUsd: 50 },
    };
    await writeFile(
      path.join(tmpDir, 'config.json'),
      JSON.stringify(configData),
      'utf-8',
    );

    const { loadConfig } = await import('../../../src/config/loader.js');
    const config = await loadConfig();

    expect(config.user.name).toBe('TestUser');
    expect(config.user.timezone).toBe('Europe/London');
    expect(config.budget.monthlyLimitUsd).toBe(50);
    // Unset values should still get defaults
    expect(config.security.level).toBe(3);
    expect(config.providers.anthropic.enabled).toBe(false);
  });

  it('env var LIL_DUDE_ANTHROPIC_KEY overrides file values', async () => {
    const configData = {
      providers: {
        anthropic: { apiKey: 'file-key', enabled: false },
      },
    };
    await writeFile(
      path.join(tmpDir, 'config.json'),
      JSON.stringify(configData),
      'utf-8',
    );

    process.env.LIL_DUDE_ANTHROPIC_KEY = 'env-key-123';

    const { loadConfig } = await import('../../../src/config/loader.js');
    const config = await loadConfig();

    expect(config.providers.anthropic.apiKey).toBe('env-key-123');
    expect(config.providers.anthropic.enabled).toBe(true);
  });

  it('env var LIL_DUDE_SECURITY overrides security level', async () => {
    const configData = {
      security: { level: 2 },
    };
    await writeFile(
      path.join(tmpDir, 'config.json'),
      JSON.stringify(configData),
      'utf-8',
    );

    process.env.LIL_DUDE_SECURITY = '5';

    const { loadConfig } = await import('../../../src/config/loader.js');
    const config = await loadConfig();

    expect(config.security.level).toBe(5);
  });

  it('env var LIL_DUDE_HOME controls config directory', async () => {
    const customDir = await mkdtemp(path.join(os.tmpdir(), 'lildude-custom-'));
    process.env.LIL_DUDE_HOME = customDir;

    const configData = { user: { name: 'CustomHome' } };
    await writeFile(
      path.join(customDir, 'config.json'),
      JSON.stringify(configData),
      'utf-8',
    );

    const { loadConfig } = await import('../../../src/config/loader.js');
    const config = await loadConfig();

    expect(config.user.name).toBe('CustomHome');

    // Cleanup
    await rm(customDir, { recursive: true, force: true });
  });

  it('rejects invalid config: security level 99', async () => {
    const configData = {
      security: { level: 99 },
    };
    await writeFile(
      path.join(tmpDir, 'config.json'),
      JSON.stringify(configData),
      'utf-8',
    );

    const { loadConfig } = await import('../../../src/config/loader.js');

    await expect(loadConfig()).rejects.toThrow('Config validation failed');
  });

  it('rejects invalid config: security level 0', async () => {
    const configData = {
      security: { level: 0 },
    };
    await writeFile(
      path.join(tmpDir, 'config.json'),
      JSON.stringify(configData),
      'utf-8',
    );

    const { loadConfig } = await import('../../../src/config/loader.js');

    await expect(loadConfig()).rejects.toThrow('Config validation failed');
  });

  it('rejects invalid JSON in config file', async () => {
    await writeFile(
      path.join(tmpDir, 'config.json'),
      'not-json{{{',
      'utf-8',
    );

    const { loadConfig } = await import('../../../src/config/loader.js');

    await expect(loadConfig()).rejects.toThrow('invalid JSON');
  });

  it('rejects non-object config file (array)', async () => {
    await writeFile(
      path.join(tmpDir, 'config.json'),
      '[1, 2, 3]',
      'utf-8',
    );

    const { loadConfig } = await import('../../../src/config/loader.js');

    await expect(loadConfig()).rejects.toThrow('must contain a JSON object');
  });

  it('creates missing directory on save', async () => {
    const nestedDir = path.join(tmpDir, 'nested', 'deep');
    process.env.LIL_DUDE_HOME = nestedDir;

    const { loadConfig, saveConfig } = await import('../../../src/config/loader.js');
    const config = await loadConfig();
    await saveConfig(config);

    const savedRaw = await readFile(path.join(nestedDir, 'config.json'), 'utf-8');
    const savedConfig: unknown = JSON.parse(savedRaw);

    expect(savedConfig).toBeDefined();
    expect(typeof savedConfig).toBe('object');
    expect((savedConfig as Record<string, unknown>).version).toBe(1);
  });

  it('saves and reloads config round-trip', async () => {
    const { loadConfig, saveConfig } = await import('../../../src/config/loader.js');

    // Load defaults
    const config = await loadConfig();
    config.user.name = 'RoundTrip';
    config.budget.monthlyLimitUsd = 100;

    // Save
    await saveConfig(config);

    // Re-import to clear any module caching effects
    vi.resetModules();
    const { loadConfig: loadConfig2 } = await import('../../../src/config/loader.js');
    const reloaded = await loadConfig2();

    expect(reloaded.user.name).toBe('RoundTrip');
    expect(reloaded.budget.monthlyLimitUsd).toBe(100);
  });

  it('homeDir returns LIL_DUDE_HOME when set', async () => {
    process.env.LIL_DUDE_HOME = '/custom/path';
    const { homeDir } = await import('../../../src/config/loader.js');
    expect(homeDir()).toBe('/custom/path');
  });

  it('homeDir returns default when LIL_DUDE_HOME is not set', async () => {
    delete process.env.LIL_DUDE_HOME;
    const { homeDir } = await import('../../../src/config/loader.js');
    expect(homeDir()).toBe(path.join(os.homedir(), '.lil-dude'));
  });

  it('env vars override without a config file', async () => {
    process.env.LIL_DUDE_ANTHROPIC_KEY = 'my-api-key';
    process.env.LIL_DUDE_SECURITY = '4';
    process.env.LIL_DUDE_BUDGET = '100';
    process.env.LIL_DUDE_WS_PORT = '9999';
    process.env.LIL_DUDE_HTTP_PORT = '8888';
    process.env.LIL_DUDE_HOST = '0.0.0.0';

    const { loadConfig } = await import('../../../src/config/loader.js');
    const config = await loadConfig();

    expect(config.providers.anthropic.apiKey).toBe('my-api-key');
    expect(config.providers.anthropic.enabled).toBe(true);
    expect(config.security.level).toBe(4);
    expect(config.budget.monthlyLimitUsd).toBe(100);
    expect(config.gateway.wsPort).toBe(9999);
    expect(config.gateway.httpPort).toBe(8888);
    expect(config.gateway.host).toBe('0.0.0.0');
  });

  it('env var for channel tokens enables the channel', async () => {
    process.env.LIL_DUDE_DISCORD_TOKEN = 'discord-tok';
    process.env.LIL_DUDE_TELEGRAM_TOKEN = 'telegram-tok';

    const { loadConfig } = await import('../../../src/config/loader.js');
    const config = await loadConfig();

    expect(config.channels.discord.token).toBe('discord-tok');
    expect(config.channels.discord.enabled).toBe(true);
    expect(config.channels.telegram.token).toBe('telegram-tok');
    expect(config.channels.telegram.enabled).toBe(true);
  });
});
