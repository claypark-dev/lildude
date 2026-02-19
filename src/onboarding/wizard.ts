/**
 * Onboarding wizard for Lil Dude.
 * Guides the user through initial setup: AI providers, channels,
 * security level, budget, and user preferences.
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
import { collectAnswers, type WizardAnswers, type OnboardingChannel } from './prompts.js';

export type { WizardAnswers, OnboardingChannel };

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
  const rawConfig: Record<string, unknown> = {
    version: 1,
    user: {
      name: answers.userName,
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
    },
    channels: {
      webchat: { enabled: true },
      discord: {
        enabled: answers.channels.includes('discord'),
        ...(answers.channelTokens.discord ? { token: answers.channelTokens.discord } : {}),
      },
      telegram: {
        enabled: answers.channels.includes('telegram'),
        ...(answers.channelTokens.telegram ? { token: answers.channelTokens.telegram } : {}),
      },
    },
    security: {
      level: answers.securityLevel,
    },
    budget: {
      monthlyLimitUsd: answers.monthlyBudget,
    },
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

  for (const channel of answers.channels) {
    if (!answers.channelTokens[channel] || answers.channelTokens[channel].trim().length === 0) {
      errors.push(`Bot token for ${channel} is missing or empty.`);
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
