import { describe, it, expect } from 'vitest';
import {
  buildConfigFromAnswers,
  validateAnswers,
  type WizardAnswers,
} from '../../../src/onboarding/wizard.js';

/**
 * Helper to create a valid base set of wizard answers.
 * Override specific fields as needed per test.
 */
function makeAnswers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    providers: ['anthropic'],
    apiKeys: { anthropic: 'sk-ant-test-key-123' },
    channels: [],
    channelTokens: {},
    securityLevel: 3,
    monthlyBudget: 20,
    userName: 'TestUser',
    ...overrides,
  };
}

describe('buildConfigFromAnswers', () => {
  it('builds valid config for a single Anthropic provider', () => {
    const answers = makeAnswers();
    const config = buildConfigFromAnswers(answers);

    expect(config.version).toBe(1);
    expect(config.user.name).toBe('TestUser');
    expect(config.providers.anthropic.enabled).toBe(true);
    expect(config.providers.anthropic.apiKey).toBe('sk-ant-test-key-123');
    expect(config.providers.openai.enabled).toBe(false);
    expect(config.providers.deepseek.enabled).toBe(false);
    expect(config.security.level).toBe(3);
    expect(config.budget.monthlyLimitUsd).toBe(20);
    expect(config.channels.webchat.enabled).toBe(true);
  });

  it('builds valid config for multiple providers', () => {
    const answers = makeAnswers({
      providers: ['anthropic', 'openai', 'deepseek'],
      apiKeys: {
        anthropic: 'sk-ant-key',
        openai: 'sk-openai-key',
        deepseek: 'sk-deepseek-key',
      },
    });
    const config = buildConfigFromAnswers(answers);

    expect(config.providers.anthropic.enabled).toBe(true);
    expect(config.providers.anthropic.apiKey).toBe('sk-ant-key');
    expect(config.providers.openai.enabled).toBe(true);
    expect(config.providers.openai.apiKey).toBe('sk-openai-key');
    expect(config.providers.deepseek.enabled).toBe(true);
    expect(config.providers.deepseek.apiKey).toBe('sk-deepseek-key');
  });

  it('enables Discord channel with token', () => {
    const answers = makeAnswers({
      channels: ['discord'],
      channelTokens: { discord: 'discord-bot-token-abc' },
    });
    const config = buildConfigFromAnswers(answers);

    expect(config.channels.discord.enabled).toBe(true);
    expect(config.channels.discord.token).toBe('discord-bot-token-abc');
    expect(config.channels.telegram.enabled).toBe(false);
  });

  it('enables Telegram channel with token', () => {
    const answers = makeAnswers({
      channels: ['telegram'],
      channelTokens: { telegram: 'telegram-bot-token-xyz' },
    });
    const config = buildConfigFromAnswers(answers);

    expect(config.channels.telegram.enabled).toBe(true);
    expect(config.channels.telegram.token).toBe('telegram-bot-token-xyz');
    expect(config.channels.discord.enabled).toBe(false);
  });

  it('enables both Discord and Telegram channels', () => {
    const answers = makeAnswers({
      channels: ['discord', 'telegram'],
      channelTokens: {
        discord: 'discord-token',
        telegram: 'telegram-token',
      },
    });
    const config = buildConfigFromAnswers(answers);

    expect(config.channels.discord.enabled).toBe(true);
    expect(config.channels.discord.token).toBe('discord-token');
    expect(config.channels.telegram.enabled).toBe(true);
    expect(config.channels.telegram.token).toBe('telegram-token');
  });

  it('webchat is always enabled regardless of channel selection', () => {
    const answers = makeAnswers({ channels: [] });
    const config = buildConfigFromAnswers(answers);

    expect(config.channels.webchat.enabled).toBe(true);
  });

  it('sets security level correctly', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      const answers = makeAnswers({ securityLevel: level });
      const config = buildConfigFromAnswers(answers);
      expect(config.security.level).toBe(level);
    }
  });

  it('sets monthly budget correctly', () => {
    const answers = makeAnswers({ monthlyBudget: 50 });
    const config = buildConfigFromAnswers(answers);
    expect(config.budget.monthlyLimitUsd).toBe(50);
  });

  it('sets zero budget', () => {
    const answers = makeAnswers({ monthlyBudget: 0 });
    const config = buildConfigFromAnswers(answers);
    expect(config.budget.monthlyLimitUsd).toBe(0);
  });

  it('applies Zod defaults for fields not set by wizard', () => {
    const answers = makeAnswers();
    const config = buildConfigFromAnswers(answers);

    // These should come from Zod defaults
    expect(config.user.timezone).toBe('America/New_York');
    expect(config.budget.perTaskDefaultLimitUsd).toBe(0.50);
    expect(config.budget.warningThresholdPct).toBe(0.8);
    expect(config.budget.hardStopEnabled).toBe(true);
    expect(config.gateway.wsPort).toBe(18420);
    expect(config.gateway.httpPort).toBe(18421);
    expect(config.gateway.host).toBe('127.0.0.1');
    expect(config.preferences.enableModelRouting).toBe(true);
  });

  it('only enables providers with saved API keys', () => {
    // If a provider was selected but its key was not saved (user declined)
    const answers = makeAnswers({
      providers: ['anthropic', 'openai'],
      apiKeys: { anthropic: 'sk-ant-key' }, // openai key not saved
    });
    const config = buildConfigFromAnswers(answers);

    expect(config.providers.anthropic.enabled).toBe(true);
    expect(config.providers.openai.enabled).toBe(false);
    expect(config.providers.openai.apiKey).toBeUndefined();
  });
});

describe('validateAnswers', () => {
  it('returns no errors for valid answers', () => {
    const answers = makeAnswers();
    const errors = validateAnswers(answers);
    expect(errors).toHaveLength(0);
  });

  it('returns error when no providers selected', () => {
    const answers = makeAnswers({ providers: [], apiKeys: {} });
    const errors = validateAnswers(answers);
    expect(errors).toContain('At least one AI provider must be selected.');
  });

  it('returns error when provider API key is missing', () => {
    const answers = makeAnswers({
      providers: ['anthropic', 'openai'],
      apiKeys: { anthropic: 'sk-ant-key' }, // openai missing
    });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('openai'))).toBe(true);
  });

  it('returns error when provider API key is empty string', () => {
    const answers = makeAnswers({
      providers: ['anthropic'],
      apiKeys: { anthropic: '   ' },
    });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('anthropic'))).toBe(true);
  });

  it('returns error for security level below 1', () => {
    const answers = makeAnswers({ securityLevel: 0 });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('Security level'))).toBe(true);
  });

  it('returns error for security level above 5', () => {
    const answers = makeAnswers({ securityLevel: 6 });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('Security level'))).toBe(true);
  });

  it('returns error for non-integer security level', () => {
    const answers = makeAnswers({ securityLevel: 2.5 });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('whole number'))).toBe(true);
  });

  it('returns error for negative budget', () => {
    const answers = makeAnswers({ monthlyBudget: -10 });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('negative'))).toBe(true);
  });

  it('returns error for NaN budget', () => {
    const answers = makeAnswers({ monthlyBudget: NaN });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('valid number'))).toBe(true);
  });

  it('returns error for Infinity budget', () => {
    const answers = makeAnswers({ monthlyBudget: Infinity });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('valid number'))).toBe(true);
  });

  it('allows zero budget', () => {
    const answers = makeAnswers({ monthlyBudget: 0 });
    const errors = validateAnswers(answers);
    expect(errors).toHaveLength(0);
  });

  it('returns error for empty user name', () => {
    const answers = makeAnswers({ userName: '' });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('User name'))).toBe(true);
  });

  it('returns error for whitespace-only user name', () => {
    const answers = makeAnswers({ userName: '   ' });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('User name'))).toBe(true);
  });

  it('returns error for channel with missing token', () => {
    const answers = makeAnswers({
      channels: ['discord'],
      channelTokens: {}, // no discord token
    });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('discord'))).toBe(true);
  });

  it('returns error for channel with empty token', () => {
    const answers = makeAnswers({
      channels: ['telegram'],
      channelTokens: { telegram: '  ' },
    });
    const errors = validateAnswers(answers);
    expect(errors.some((err) => err.includes('telegram'))).toBe(true);
  });

  it('returns multiple errors when multiple fields are invalid', () => {
    const answers = makeAnswers({
      providers: [],
      apiKeys: {},
      securityLevel: 0,
      monthlyBudget: -5,
      userName: '',
    });
    const errors = validateAnswers(answers);
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });

  it('accepts valid answers with all channels enabled', () => {
    const answers = makeAnswers({
      channels: ['discord', 'telegram'],
      channelTokens: {
        discord: 'valid-discord-token',
        telegram: 'valid-telegram-token',
      },
    });
    const errors = validateAnswers(answers);
    expect(errors).toHaveLength(0);
  });

  it('accepts valid answers with all providers', () => {
    const answers = makeAnswers({
      providers: ['anthropic', 'openai', 'deepseek'],
      apiKeys: {
        anthropic: 'key-a',
        openai: 'key-o',
        deepseek: 'key-d',
      },
    });
    const errors = validateAnswers(answers);
    expect(errors).toHaveLength(0);
  });
});
