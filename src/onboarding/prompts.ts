/**
 * Interactive prompts for the onboarding wizard.
 * Uses inquirer to collect user input for providers, channels,
 * security level, budget, and user preferences.
 * Separated from wizard.ts to keep files under 300 lines.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import type { OnboardingProvider, VerifyResult } from './verify-provider.js';

/** Channel selection choices available during onboarding. */
export type OnboardingChannel = 'discord' | 'telegram';

/** Shape of all answers collected by the wizard. */
export interface WizardAnswers {
  providers: OnboardingProvider[];
  apiKeys: Record<string, string>;
  channels: OnboardingChannel[];
  channelTokens: Record<string, string>;
  securityLevel: number;
  monthlyBudget: number;
  userName: string;
}

/**
 * Collect wizard answers interactively via inquirer prompts.
 *
 * @param verifyKey - Function to verify API keys against providers
 * @returns The collected wizard answers
 */
export async function collectAnswers(
  verifyKey: (provider: OnboardingProvider, apiKey: string) => Promise<VerifyResult>,
): Promise<WizardAnswers> {
  const { providers } = await inquirer.prompt<{ providers: OnboardingProvider[] }>([
    {
      type: 'checkbox',
      name: 'providers',
      message: 'Select AI provider(s):',
      choices: [
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'OpenAI (GPT)', value: 'openai' },
        { name: 'DeepSeek', value: 'deepseek' },
      ],
      validate: (input: OnboardingProvider[]) =>
        input.length > 0 || 'Please select at least one provider.',
    },
  ]);

  const apiKeys: Record<string, string> = {};
  for (const provider of providers) {
    const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
      {
        type: 'password',
        name: 'apiKey',
        message: `Enter API key for ${provider}:`,
        mask: '*',
        validate: (input: string) =>
          input.trim().length > 0 || 'API key cannot be empty.',
      },
    ]);

    console.log(chalk.gray(`  Verifying ${provider} API key...`));
    const result = await verifyKey(provider, apiKey.trim());

    if (result.valid) {
      console.log(chalk.green(`  ${provider} key verified successfully.`));
      apiKeys[provider] = apiKey.trim();
    } else {
      console.log(chalk.yellow(`  Warning: ${provider} key verification failed: ${result.error ?? 'unknown error'}`));
      const { keepKey } = await inquirer.prompt<{ keepKey: boolean }>([
        {
          type: 'confirm',
          name: 'keepKey',
          message: 'Save this key anyway?',
          default: false,
        },
      ]);
      if (keepKey) {
        apiKeys[provider] = apiKey.trim();
      }
    }
  }

  const { channels } = await inquirer.prompt<{ channels: OnboardingChannel[] }>([
    {
      type: 'checkbox',
      name: 'channels',
      message: 'Select messaging channels (WebChat is always enabled):',
      choices: [
        { name: 'Discord', value: 'discord' },
        { name: 'Telegram', value: 'telegram' },
      ],
    },
  ]);

  const channelTokens: Record<string, string> = {};
  for (const channel of channels) {
    const { token } = await inquirer.prompt<{ token: string }>([
      {
        type: 'password',
        name: 'token',
        message: `Enter bot token for ${channel}:`,
        mask: '*',
        validate: (input: string) =>
          input.trim().length > 0 || 'Bot token cannot be empty.',
      },
    ]);
    channelTokens[channel] = token.trim();
  }

  const { securityLevel } = await inquirer.prompt<{ securityLevel: number }>([
    {
      type: 'list',
      name: 'securityLevel',
      message: 'Select security level:',
      choices: [
        { name: '1 - Minimal: Almost no restrictions (development only)', value: 1 },
        { name: '2 - Low: Basic safety rails', value: 2 },
        { name: '3 - Standard: Recommended for most users (default)', value: 3 },
        { name: '4 - High: Strict controls, approval required for most actions', value: 4 },
        { name: '5 - Lockdown: Maximum restrictions, manual approval for everything', value: 5 },
      ],
      default: 2, // Index 2 = level 3 (Standard)
    },
  ]);

  const { monthlyBudget } = await inquirer.prompt<{ monthlyBudget: number }>([
    {
      type: 'number',
      name: 'monthlyBudget',
      message: 'Monthly AI spending budget (USD):',
      default: 20,
      validate: (input: number) => {
        if (typeof input !== 'number' || Number.isNaN(input)) {
          return 'Please enter a valid number.';
        }
        if (input < 0) {
          return 'Budget cannot be negative.';
        }
        return true;
      },
    },
  ]);

  const { userName } = await inquirer.prompt<{ userName: string }>([
    {
      type: 'input',
      name: 'userName',
      message: 'What should Lil Dude call you?',
      default: 'Friend',
      validate: (input: string) =>
        input.trim().length > 0 || 'Name cannot be empty.',
    },
  ]);

  return {
    providers,
    apiKeys,
    channels,
    channelTokens,
    securityLevel,
    monthlyBudget,
    userName: userName.trim(),
  };
}
