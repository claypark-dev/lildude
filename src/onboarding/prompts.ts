/**
 * Interactive prompts for the onboarding wizard.
 * Uses inquirer to collect user input for agent identity, providers,
 * channels, heartbeat, MCP servers, security level, budget, and user preferences.
 * Separated from wizard.ts to keep files under 300 lines.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import type { OnboardingProvider, VerifyResult } from './verify-provider.js';

/** Channel selection choices available during onboarding. */
export type OnboardingChannel =
  | 'discord'
  | 'telegram'
  | 'slack'
  | 'imessage'
  | 'whatsapp'
  | 'signal'
  | 'matrix'
  | 'teams'
  | 'line'
  | 'googlechat';

/** MCP server definition collected during onboarding. */
export interface OnboardingMcpServer {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
}

/** Shape of all answers collected by the wizard. */
export interface WizardAnswers {
  agentName: string;
  agentPersona: string;
  providers: OnboardingProvider[];
  apiKeys: Record<string, string>;
  channels: OnboardingChannel[];
  channelTokens: Record<string, string>;
  securityLevel: number;
  monthlyBudget: number;
  userName: string;
  heartbeatEnabled: boolean;
  heartbeatIntervalMinutes: number;
  heartbeatMaxDailyBudgetUsd: number;
  mcpEnabled: boolean;
  mcpServers: OnboardingMcpServer[];
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
  // --- Step 1: Agent identity ---
  console.log(chalk.bold('\n  Step 1: Name Your Assistant\n'));

  const { agentName } = await inquirer.prompt<{ agentName: string }>([
    {
      type: 'input',
      name: 'agentName',
      message: 'What should your assistant be called?',
      default: 'Lil Dude',
      validate: (input: string) =>
        input.trim().length > 0 || 'Name cannot be empty.',
    },
  ]);

  const { agentPersona } = await inquirer.prompt<{ agentPersona: string }>([
    {
      type: 'input',
      name: 'agentPersona',
      message: 'Describe your assistant\'s persona (used in system prompt):',
      default: 'a chill, capable AI executive assistant',
      validate: (input: string) =>
        input.trim().length > 0 || 'Persona cannot be empty.',
    },
  ]);

  // --- Step 2: AI providers ---
  console.log(chalk.bold('\n  Step 2: AI Providers\n'));

  const { providers } = await inquirer.prompt<{ providers: OnboardingProvider[] }>([
    {
      type: 'checkbox',
      name: 'providers',
      message: 'Select AI provider(s):',
      choices: [
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'OpenAI (GPT)', value: 'openai' },
        { name: 'Google Gemini', value: 'gemini' },
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

  // --- Step 3: Channels ---
  console.log(chalk.bold('\n  Step 3: Messaging Channels\n'));

  const { channels } = await inquirer.prompt<{ channels: OnboardingChannel[] }>([
    {
      type: 'checkbox',
      name: 'channels',
      message: 'Select messaging channels (WebChat is always enabled):',
      choices: [
        { name: 'Discord', value: 'discord' },
        { name: 'Telegram', value: 'telegram' },
        { name: 'Slack', value: 'slack' },
        { name: 'iMessage (macOS only)', value: 'imessage' },
        { name: 'WhatsApp', value: 'whatsapp' },
        { name: 'Signal', value: 'signal' },
        { name: 'Matrix', value: 'matrix' },
        { name: 'Microsoft Teams', value: 'teams' },
        { name: 'LINE', value: 'line' },
        { name: 'Google Chat', value: 'googlechat' },
      ],
    },
  ]);

  const channelTokens: Record<string, string> = {};
  for (const channel of channels) {
    // iMessage and WhatsApp don't require a bot token during onboarding
    if (channel === 'imessage' || channel === 'whatsapp') {
      continue;
    }

    if (channel === 'slack') {
      const { token } = await inquirer.prompt<{ token: string }>([
        {
          type: 'password',
          name: 'token',
          message: 'Enter Slack bot token (xoxb-...):',
          mask: '*',
          validate: (input: string) =>
            input.trim().length > 0 || 'Bot token cannot be empty.',
        },
      ]);
      channelTokens.slack = token.trim();

      const { appToken } = await inquirer.prompt<{ appToken: string }>([
        {
          type: 'password',
          name: 'appToken',
          message: 'Enter Slack app-level token (xapp-..., optional, press Enter to skip):',
          mask: '*',
        },
      ]);
      if (appToken.trim().length > 0) {
        channelTokens.slackAppToken = appToken.trim();
      }
      continue;
    }

    if (channel === 'matrix') {
      const { homeserverUrl } = await inquirer.prompt<{ homeserverUrl: string }>([
        {
          type: 'input',
          name: 'homeserverUrl',
          message: 'Enter Matrix homeserver URL (e.g. https://matrix.org):',
          validate: (input: string) =>
            input.trim().length > 0 || 'Homeserver URL cannot be empty.',
        },
      ]);
      channelTokens.matrixHomeserverUrl = homeserverUrl.trim();

      const { accessToken } = await inquirer.prompt<{ accessToken: string }>([
        {
          type: 'password',
          name: 'accessToken',
          message: 'Enter Matrix access token:',
          mask: '*',
          validate: (input: string) =>
            input.trim().length > 0 || 'Access token cannot be empty.',
        },
      ]);
      channelTokens.matrix = accessToken.trim();
      continue;
    }

    if (channel === 'teams') {
      const { appId } = await inquirer.prompt<{ appId: string }>([
        {
          type: 'input',
          name: 'appId',
          message: 'Enter Microsoft Teams App ID:',
          validate: (input: string) =>
            input.trim().length > 0 || 'App ID cannot be empty.',
        },
      ]);
      channelTokens.teamsAppId = appId.trim();

      const { appPassword } = await inquirer.prompt<{ appPassword: string }>([
        {
          type: 'password',
          name: 'appPassword',
          message: 'Enter Microsoft Teams App Password:',
          mask: '*',
          validate: (input: string) =>
            input.trim().length > 0 || 'App password cannot be empty.',
        },
      ]);
      channelTokens.teams = appPassword.trim();
      continue;
    }

    if (channel === 'line') {
      const { channelAccessToken } = await inquirer.prompt<{ channelAccessToken: string }>([
        {
          type: 'password',
          name: 'channelAccessToken',
          message: 'Enter LINE Channel Access Token:',
          mask: '*',
          validate: (input: string) =>
            input.trim().length > 0 || 'Channel access token cannot be empty.',
        },
      ]);
      channelTokens.line = channelAccessToken.trim();

      const { channelSecret } = await inquirer.prompt<{ channelSecret: string }>([
        {
          type: 'password',
          name: 'channelSecret',
          message: 'Enter LINE Channel Secret:',
          mask: '*',
          validate: (input: string) =>
            input.trim().length > 0 || 'Channel secret cannot be empty.',
        },
      ]);
      channelTokens.lineChannelSecret = channelSecret.trim();
      continue;
    }

    if (channel === 'googlechat') {
      const { serviceAccountKey } = await inquirer.prompt<{ serviceAccountKey: string }>([
        {
          type: 'input',
          name: 'serviceAccountKey',
          message: 'Enter path to Google Chat service account key JSON:',
          validate: (input: string) =>
            input.trim().length > 0 || 'Service account key path cannot be empty.',
        },
      ]);
      channelTokens.googlechat = serviceAccountKey.trim();
      continue;
    }

    if (channel === 'signal') {
      const { phoneNumber } = await inquirer.prompt<{ phoneNumber: string }>([
        {
          type: 'input',
          name: 'phoneNumber',
          message: 'Enter Signal phone number (e.g. +1234567890):',
          validate: (input: string) =>
            input.trim().length > 0 || 'Phone number cannot be empty.',
        },
      ]);
      channelTokens.signal = phoneNumber.trim();
      continue;
    }

    // Generic token prompt for discord, telegram
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

  // --- Step 4: Security level ---
  console.log(chalk.bold('\n  Step 4: Security Level\n'));

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

  // --- Step 5: Budget ---
  console.log(chalk.bold('\n  Step 5: Budget\n'));

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

  // --- Step 6: Your name ---
  console.log(chalk.bold('\n  Step 6: About You\n'));

  const { userName } = await inquirer.prompt<{ userName: string }>([
    {
      type: 'input',
      name: 'userName',
      message: 'What should your assistant call you?',
      default: 'Friend',
      validate: (input: string) =>
        input.trim().length > 0 || 'Name cannot be empty.',
    },
  ]);

  // --- Step 7: Heartbeat configuration ---
  console.log(chalk.bold('\n  Step 7: Proactive Heartbeat\n'));
  console.log(chalk.gray('  The heartbeat lets your assistant proactively check'));
  console.log(chalk.gray('  for things to do (reminders, follow-ups, etc.)\n'));

  const { heartbeatEnabled } = await inquirer.prompt<{ heartbeatEnabled: boolean }>([
    {
      type: 'confirm',
      name: 'heartbeatEnabled',
      message: 'Enable proactive heartbeat?',
      default: true,
    },
  ]);

  let heartbeatIntervalMinutes = 30;
  let heartbeatMaxDailyBudgetUsd = 0.50;

  if (heartbeatEnabled) {
    const heartbeatDetails = await inquirer.prompt<{
      heartbeatIntervalMinutes: number;
      heartbeatMaxDailyBudgetUsd: number;
    }>([
      {
        type: 'number',
        name: 'heartbeatIntervalMinutes',
        message: 'Heartbeat interval in minutes (5-1440):',
        default: 30,
        validate: (input: number) => {
          if (typeof input !== 'number' || Number.isNaN(input)) {
            return 'Please enter a valid number.';
          }
          if (input < 5 || input > 1440) {
            return 'Interval must be between 5 and 1440 minutes.';
          }
          return true;
        },
      },
      {
        type: 'number',
        name: 'heartbeatMaxDailyBudgetUsd',
        message: 'Max daily heartbeat budget (USD):',
        default: 0.50,
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
    heartbeatIntervalMinutes = heartbeatDetails.heartbeatIntervalMinutes;
    heartbeatMaxDailyBudgetUsd = heartbeatDetails.heartbeatMaxDailyBudgetUsd;
  }

  // --- Step 8: MCP servers ---
  console.log(chalk.bold('\n  Step 8: MCP Tool Servers\n'));
  console.log(chalk.gray('  MCP (Model Context Protocol) servers let your assistant'));
  console.log(chalk.gray('  use external tools (file access, databases, APIs, etc.)\n'));

  const { mcpEnabled } = await inquirer.prompt<{ mcpEnabled: boolean }>([
    {
      type: 'confirm',
      name: 'mcpEnabled',
      message: 'Would you like to configure MCP servers?',
      default: false,
    },
  ]);

  const mcpServers: OnboardingMcpServer[] = [];

  if (mcpEnabled) {
    let addingServers = true;
    while (addingServers) {
      const serverAnswers = await inquirer.prompt<{
        name: string;
        transport: 'stdio' | 'sse';
        command: string;
        addAnother: boolean;
      }>([
        {
          type: 'input',
          name: 'name',
          message: 'MCP server name:',
          validate: (input: string) =>
            input.trim().length > 0 || 'Name cannot be empty.',
        },
        {
          type: 'list',
          name: 'transport',
          message: 'Transport type:',
          choices: [
            { name: 'stdio (local command)', value: 'stdio' },
            { name: 'SSE (remote URL)', value: 'sse' },
          ],
          default: 'stdio',
        },
        {
          type: 'input',
          name: 'command',
          message: 'Command or URL to run the server:',
          validate: (input: string) =>
            input.trim().length > 0 || 'Command/URL cannot be empty.',
        },
        {
          type: 'confirm',
          name: 'addAnother',
          message: 'Add another MCP server?',
          default: false,
        },
      ]);

      const server: OnboardingMcpServer = {
        name: serverAnswers.name.trim(),
        transport: serverAnswers.transport,
      };

      if (serverAnswers.transport === 'stdio') {
        const parts = serverAnswers.command.trim().split(/\s+/);
        server.command = parts[0];
        server.args = parts.slice(1);
      } else {
        server.url = serverAnswers.command.trim();
      }

      mcpServers.push(server);
      addingServers = serverAnswers.addAnother;
    }
  }

  return {
    agentName: agentName.trim(),
    agentPersona: agentPersona.trim(),
    providers,
    apiKeys,
    channels,
    channelTokens,
    securityLevel,
    monthlyBudget,
    userName: userName.trim(),
    heartbeatEnabled,
    heartbeatIntervalMinutes,
    heartbeatMaxDailyBudgetUsd,
    mcpEnabled,
    mcpServers,
  };
}
