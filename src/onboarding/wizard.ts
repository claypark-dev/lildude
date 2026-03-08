/**
 * Onboarding wizard for Lil Dude.
 * Guides the user through initial setup: agent identity, AI providers,
 * channels, heartbeat, MCP servers, security level, budget, and user preferences.
 * Saves config and initializes the database.
 * See HLD Section 6.4.
 */

import chalk from 'chalk';
import { join } from 'node:path';
import { type Config, ConfigSchema } from '../config/schema.js';
import { saveConfig, homeDir } from '../config/loader.js';
import { createDatabase } from '../persistence/db.js';
import { createModuleLogger } from '../utils/logger.js';
import {
  type OnboardingProvider,
  type VerifyResult,
  verifyApiKey,
} from './verify-provider.js';
import { collectAnswers, type WizardAnswers, type OnboardingChannel, type OnboardingMcpServer } from './prompts.js';

export type { WizardAnswers, OnboardingChannel, OnboardingMcpServer };

const log = createModuleLogger('onboarding');

/** Options for the onboarding wizard, supporting dependency injection. */
export interface WizardOptions {
  /** Override the config home directory (for testing). */
  configHome?: string;
  /** Override the API key verifier (for testing). */
  verifyKey?: (provider: OnboardingProvider, apiKey: string) => Promise<VerifyResult>;
  /** Skip interactive prompts and use provided answers (for testing). */
  answers?: WizardAnswers;
}

/**
 * Print the welcome banner to the console.
 */
function printWelcomeBanner(): void {
  console.log('');
  console.log(chalk.bold.cyan('  Welcome to Lil Dude!'));
  console.log(chalk.gray('  Your personal AI executive assistant'));
  console.log('');
  console.log(chalk.gray('  This wizard will help you set up your configuration.'));
  console.log(chalk.gray('  You can change any of these settings later in ~/.lil-dude/config.json'));
  console.log('');
}

/**
 * Print startup instructions after onboarding completes.
 */
function printStartupInstructions(): void {
  console.log('');
  console.log(chalk.bold.green('  Setup complete!'));
  console.log('');
  console.log(chalk.gray('  To start Lil Dude, run:'));
  console.log(chalk.cyan('    lil-dude start'));
  console.log('');
  console.log(chalk.gray('  To check system health:'));
  console.log(chalk.cyan('    lil-dude doctor'));
  console.log('');
  console.log(chalk.gray('  Configuration saved to:'));
  console.log(chalk.cyan(`    ${join(homeDir(), 'config.json')}`));
  console.log('');
}

/**
 * Build a Config object from wizard answers.
 * This is a pure function, separated from I/O for testability.
 *
 * @param answers - The collected wizard answers
 * @returns A fully-resolved Config object
 */
export function buildConfigFromAnswers(answers: WizardAnswers): Config {
  const channelsConfig: Record<string, Record<string, unknown>> = {
    webchat: { enabled: true },
    discord: {
      enabled: answers.channels.includes('discord'),
      ...(answers.channelTokens.discord ? { token: answers.channelTokens.discord } : {}),
    },
    telegram: {
      enabled: answers.channels.includes('telegram'),
      ...(answers.channelTokens.telegram ? { token: answers.channelTokens.telegram } : {}),
    },
    slack: {
      enabled: answers.channels.includes('slack'),
      ...(answers.channelTokens.slack ? { token: answers.channelTokens.slack } : {}),
      ...(answers.channelTokens.slackAppToken ? { appToken: answers.channelTokens.slackAppToken } : {}),
    },
    imessage: {
      enabled: answers.channels.includes('imessage'),
    },
    whatsapp: {
      enabled: answers.channels.includes('whatsapp'),
    },
    signal: {
      enabled: answers.channels.includes('signal'),
      ...(answers.channelTokens.signal ? { phoneNumber: answers.channelTokens.signal } : {}),
    },
    matrix: {
      enabled: answers.channels.includes('matrix'),
      ...(answers.channelTokens.matrixHomeserverUrl ? { homeserverUrl: answers.channelTokens.matrixHomeserverUrl } : {}),
      ...(answers.channelTokens.matrix ? { accessToken: answers.channelTokens.matrix } : {}),
    },
    teams: {
      enabled: answers.channels.includes('teams'),
      ...(answers.channelTokens.teamsAppId ? { appId: answers.channelTokens.teamsAppId } : {}),
      ...(answers.channelTokens.teams ? { appPassword: answers.channelTokens.teams } : {}),
    },
    line: {
      enabled: answers.channels.includes('line'),
      ...(answers.channelTokens.line ? { channelAccessToken: answers.channelTokens.line } : {}),
      ...(answers.channelTokens.lineChannelSecret ? { channelSecret: answers.channelTokens.lineChannelSecret } : {}),
    },
    googlechat: {
      enabled: answers.channels.includes('googlechat'),
      ...(answers.channelTokens.googlechat ? { serviceAccountKey: answers.channelTokens.googlechat } : {}),
    },
  };

  const mcpConfig: Record<string, unknown> = {
    enabled: answers.mcpEnabled,
    servers: answers.mcpServers.map((server) => ({
      name: server.name,
      transport: server.transport,
      ...(server.command ? { command: server.command } : {}),
      ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
      ...(server.url ? { url: server.url } : {}),
    })),
  };

  const rawConfig: Record<string, unknown> = {
    version: 1,
    user: {
      name: answers.userName,
    },
    agent: {
      name: answers.agentName,
      persona: answers.agentPersona,
    },
    providers: {
      anthropic: {
        enabled: 'anthropic' in answers.apiKeys,
        ...(answers.apiKeys.anthropic ? { apiKey: answers.apiKeys.anthropic } : {}),
      },
      openai: {
        enabled: 'openai' in answers.apiKeys,
        ...(answers.apiKeys.openai ? { apiKey: answers.apiKeys.openai } : {}),
      },
      deepseek: {
        enabled: 'deepseek' in answers.apiKeys,
        ...(answers.apiKeys.deepseek ? { apiKey: answers.apiKeys.deepseek } : {}),
      },
      gemini: {
        enabled: 'gemini' in answers.apiKeys,
        ...(answers.apiKeys.gemini ? { apiKey: answers.apiKeys.gemini } : {}),
      },
    },
    channels: channelsConfig,
    security: {
      level: answers.securityLevel,
    },
    budget: {
      monthlyLimitUsd: answers.monthlyBudget,
    },
    heartbeat: {
      enabled: answers.heartbeatEnabled,
      intervalMinutes: answers.heartbeatIntervalMinutes,
      maxDailyBudgetUsd: answers.heartbeatMaxDailyBudgetUsd,
    },
    mcp: mcpConfig,
  };

  return ConfigSchema.parse(rawConfig);
}

/**
 * Validate wizard answers for correctness.
 * Returns an array of error messages; empty means valid.
 *
 * @param answers - The wizard answers to validate
 * @returns An array of validation error strings (empty if valid)
 */
export function validateAnswers(answers: WizardAnswers): string[] {
  const errors: string[] = [];

  if (answers.agentName.trim().length === 0) {
    errors.push('Agent name cannot be empty.');
  }

  if (answers.agentPersona.trim().length === 0) {
    errors.push('Agent persona cannot be empty.');
  }

  if (answers.providers.length === 0) {
    errors.push('At least one AI provider must be selected.');
  }

  for (const provider of answers.providers) {
    if (!answers.apiKeys[provider] || answers.apiKeys[provider].trim().length === 0) {
      errors.push(`API key for ${provider} is missing or empty.`);
    }
  }

  if (answers.securityLevel < 1 || answers.securityLevel > 5) {
    errors.push('Security level must be between 1 and 5.');
  }

  if (!Number.isFinite(answers.securityLevel) || !Number.isInteger(answers.securityLevel)) {
    errors.push('Security level must be a whole number.');
  }

  if (answers.monthlyBudget < 0) {
    errors.push('Monthly budget cannot be negative.');
  }

  if (!Number.isFinite(answers.monthlyBudget)) {
    errors.push('Monthly budget must be a valid number.');
  }

  if (answers.userName.trim().length === 0) {
    errors.push('User name cannot be empty.');
  }

  if (answers.heartbeatEnabled) {
    if (answers.heartbeatIntervalMinutes < 5 || answers.heartbeatIntervalMinutes > 1440) {
      errors.push('Heartbeat interval must be between 5 and 1440 minutes.');
    }
    if (answers.heartbeatMaxDailyBudgetUsd < 0) {
      errors.push('Heartbeat daily budget cannot be negative.');
    }
  }

  // Validate channel-specific tokens
  const tokenRequirements: Record<string, string[]> = {
    discord: ['discord'],
    telegram: ['telegram'],
    slack: ['slack'],
    signal: ['signal'],
    matrix: ['matrix', 'matrixHomeserverUrl'],
    teams: ['teams', 'teamsAppId'],
    line: ['line', 'lineChannelSecret'],
    googlechat: ['googlechat'],
  };

  for (const channel of answers.channels) {
    const required = tokenRequirements[channel];
    if (!required) {
      continue;
    }
    for (const tokenKey of required) {
      if (!answers.channelTokens[tokenKey] || answers.channelTokens[tokenKey].trim().length === 0) {
        errors.push(`Required credential "${tokenKey}" for ${channel} is missing or empty.`);
      }
    }
  }

  return errors;
}

/**
 * Run the onboarding wizard.
 * Guides the user through setup, saves config, and initializes the database.
 *
 * @param options - Optional overrides for testing (configHome, verifyKey, answers)
 */
export async function runOnboardingWizard(options: WizardOptions = {}): Promise<void> {
  const verifyKey = options.verifyKey ?? verifyApiKey;

  try {
    printWelcomeBanner();

    const answers = options.answers ?? await collectAnswers(verifyKey);

    const validationErrors = validateAnswers(answers);
    if (validationErrors.length > 0) {
      console.log(chalk.red('\n  Validation errors:'));
      for (const validationError of validationErrors) {
        console.log(chalk.red(`    - ${validationError}`));
      }
      return;
    }

    const config = buildConfigFromAnswers(answers);

    if (options.configHome) {
      process.env.LIL_DUDE_HOME = options.configHome;
    }

    await saveConfig(config);
    log.info('Configuration saved');

    const dbPath = join(homeDir(), 'lil-dude.db');
    const dbManager = createDatabase(dbPath);
    dbManager.runMigrations();
    dbManager.close();
    log.info('Database initialized');

    printStartupInstructions();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n  Onboarding failed: ${message}`));
    log.error({ error: message }, 'Onboarding failed');
    throw error;
  }
}
