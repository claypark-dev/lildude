/**
 * Configuration loader for Lil Dude.
 * Reads config from ~/.lil-dude/config.json, applies env var overrides,
 * validates with Zod, and provides save functionality.
 *
 * Priority: env vars > config.json > Zod defaults
 * See HLD Section 4.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ZodError } from 'zod';
import { ConfigError } from '../errors.js';
import { createModuleLogger } from '../utils/logger.js';
import { ConfigSchema, type Config } from './schema.js';

const log = createModuleLogger('config');

/**
 * Returns the base directory for Lil Dude configuration files.
 * Checks LIL_DUDE_HOME env var first, then defaults to ~/.lil-dude.
 */
export function homeDir(): string {
  return process.env.LIL_DUDE_HOME ?? path.join(os.homedir(), '.lil-dude');
}

/**
 * Returns the full path to the config.json file.
 */
function configFilePath(): string {
  return path.join(homeDir(), 'config.json');
}

/**
 * Reads the raw config file from disk.
 * Returns an empty object if the file does not exist.
 */
async function readConfigFile(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(configFilePath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ConfigError('Config file must contain a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      log.info('No config file found, using defaults');
      return {};
    }
    if (error instanceof SyntaxError) {
      throw new ConfigError(`Config file contains invalid JSON: ${error.message}`);
    }
    throw new ConfigError(`Failed to read config file: ${String(error)}`);
  }
}

/**
 * Applies environment variable overrides to the raw config object.
 * Supported env vars:
 *   LIL_DUDE_ANTHROPIC_KEY  -> providers.anthropic.apiKey + enabled
 *   LIL_DUDE_OPENAI_KEY     -> providers.openai.apiKey + enabled
 *   LIL_DUDE_DEEPSEEK_KEY   -> providers.deepseek.apiKey + enabled
 *   LIL_DUDE_GEMINI_KEY     -> providers.gemini.apiKey + enabled
 *   LIL_DUDE_DISCORD_TOKEN  -> channels.discord.token + enabled
 *   LIL_DUDE_TELEGRAM_TOKEN -> channels.telegram.token + enabled
 *   LIL_DUDE_SECURITY       -> security.level
 *   LIL_DUDE_BUDGET         -> budget.monthlyLimitUsd
 *   LIL_DUDE_WS_PORT        -> gateway.wsPort
 *   LIL_DUDE_HTTP_PORT      -> gateway.httpPort
 *   LIL_DUDE_HOST           -> gateway.host
 */
function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const merged = structuredClone(config);

  const ensureNested = (obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> => {
    let current = obj;
    for (const key of keys) {
      if (typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
    return current;
  };

  // Provider API keys
  const providerKeyMap: Record<string, string> = {
    LIL_DUDE_ANTHROPIC_KEY: 'anthropic',
    LIL_DUDE_OPENAI_KEY: 'openai',
    LIL_DUDE_DEEPSEEK_KEY: 'deepseek',
    LIL_DUDE_GEMINI_KEY: 'gemini',
  };

  for (const [envVar, providerName] of Object.entries(providerKeyMap)) {
    const value = process.env[envVar];
    if (value !== undefined) {
      const provider = ensureNested(merged, 'providers', providerName);
      provider.apiKey = value;
      provider.enabled = true;
      log.info({ provider: providerName }, 'API key set from env var');
    }
  }

  // Channel tokens
  const channelTokenMap: Record<string, string> = {
    LIL_DUDE_DISCORD_TOKEN: 'discord',
    LIL_DUDE_TELEGRAM_TOKEN: 'telegram',
  };

  for (const [envVar, channelName] of Object.entries(channelTokenMap)) {
    const value = process.env[envVar];
    if (value !== undefined) {
      const channel = ensureNested(merged, 'channels', channelName);
      channel.token = value;
      channel.enabled = true;
      log.info({ channel: channelName }, 'Token set from env var');
    }
  }

  // Security level
  const securityLevel = process.env.LIL_DUDE_SECURITY;
  if (securityLevel !== undefined) {
    const level = Number(securityLevel);
    if (!Number.isNaN(level)) {
      const security = ensureNested(merged, 'security');
      security.level = level;
    }
  }

  // Budget
  const budget = process.env.LIL_DUDE_BUDGET;
  if (budget !== undefined) {
    const limit = Number(budget);
    if (!Number.isNaN(limit)) {
      const budgetObj = ensureNested(merged, 'budget');
      budgetObj.monthlyLimitUsd = limit;
    }
  }

  // Gateway ports and host
  const wsPort = process.env.LIL_DUDE_WS_PORT;
  if (wsPort !== undefined) {
    const port = Number(wsPort);
    if (!Number.isNaN(port)) {
      const gateway = ensureNested(merged, 'gateway');
      gateway.wsPort = port;
    }
  }

  const httpPort = process.env.LIL_DUDE_HTTP_PORT;
  if (httpPort !== undefined) {
    const port = Number(httpPort);
    if (!Number.isNaN(port)) {
      const gateway = ensureNested(merged, 'gateway');
      gateway.httpPort = port;
    }
  }

  const host = process.env.LIL_DUDE_HOST;
  if (host !== undefined) {
    const gateway = ensureNested(merged, 'gateway');
    gateway.host = host;
  }

  return merged;
}

/**
 * Loads the configuration from disk, applies environment variable overrides,
 * and validates against the ConfigSchema.
 *
 * @returns The fully-resolved and validated Config object
 * @throws {ConfigError} When the config file is malformed or validation fails
 */
export async function loadConfig(): Promise<Config> {
  try {
    const rawFile = await readConfigFile();
    const withEnv = applyEnvOverrides(rawFile);
    const result = ConfigSchema.safeParse(withEnv);

    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new ConfigError(`Config validation failed: ${issues}`);
    }

    log.info('Configuration loaded successfully');
    return result.data;
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if (error instanceof ZodError) {
      const issues = error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new ConfigError(`Config validation failed: ${issues}`);
    }
    throw new ConfigError(`Failed to load config: ${String(error)}`);
  }
}

/**
 * Saves the given configuration to disk as config.json.
 * Creates the config directory if it does not exist.
 *
 * @param config - The Config object to persist
 * @throws {ConfigError} When writing to disk fails
 */
export async function saveConfig(config: Config): Promise<void> {
  try {
    const dir = homeDir();
    await mkdir(dir, { recursive: true });
    const filePath = configFilePath();
    const json = JSON.stringify(config, null, 2);
    await writeFile(filePath, json, 'utf-8');
    log.info({ path: filePath }, 'Configuration saved');
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(`Failed to save config: ${String(error)}`);
  }
}
