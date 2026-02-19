/**
 * Doctor Command — S0.F.1
 *
 * Runs system health checks and prints a diagnostic report.
 * Checks: Node.js version, config, database, hardware, API keys, pricing staleness.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homeDir, loadConfig } from '../config/index.js';
import { createDatabase } from '../persistence/db.js';
import { detectHardware } from '../utils/hardware.js';
import type { Config } from '../config/index.js';
import type { HardwareProfile } from '../types/index.js';

/** Result of a single doctor check */
export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

/**
 * Run all doctor checks and print results.
 * Returns exit code 0 if all checks pass, 1 otherwise.
 */
export async function runDoctor(): Promise<number> {
  console.log('\n  Lil Dude Doctor\n');

  const checks: CheckResult[] = [];

  checks.push(checkNodeVersion());
  checks.push(checkConfigExists());
  checks.push(await checkConfigValid());
  checks.push(checkDatabaseExists());
  checks.push(checkDatabaseMigrations());
  checks.push(await checkHardware());
  checks.push(await checkApiKeys());

  let allPassed = true;
  for (const check of checks) {
    const icon = check.passed ? '\u2705' : '\u274C';
    console.log(`  ${icon}  ${check.name}: ${check.message}`);
    if (!check.passed) {
      allPassed = false;
    }
  }

  console.log('');
  if (allPassed) {
    console.log('  All checks passed! Lil Dude is ready.\n');
  } else {
    console.log('  Some checks failed. Fix the issues above.\n');
  }

  return allPassed ? 0 : 1;
}

/**
 * Run all checks and return structured results (for testing).
 */
export async function getDoctorResults(): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  checks.push(checkNodeVersion());
  checks.push(checkConfigExists());
  checks.push(await checkConfigValid());
  checks.push(checkDatabaseExists());
  checks.push(checkDatabaseMigrations());
  checks.push(await checkHardware());
  checks.push(await checkApiKeys());
  return checks;
}

/** Check that Node.js version is >= 20 */
export function checkNodeVersion(): CheckResult {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0], 10);
  if (major >= 20) {
    return { name: 'Node.js version', passed: true, message: `v${version} (>= 20 required)` };
  }
  return { name: 'Node.js version', passed: false, message: `v${version} — requires Node.js 20+` };
}

/** Check that config directory and config.json exist */
export function checkConfigExists(): CheckResult {
  const configPath = join(homeDir(), 'config.json');
  if (existsSync(configPath)) {
    return { name: 'Config file', passed: true, message: configPath };
  }
  return {
    name: 'Config file',
    passed: false,
    message: `Not found at ${configPath}. Run "lil-dude onboard" to create it.`,
  };
}

/** Check that config.json is valid (parseable and passes Zod validation) */
export async function checkConfigValid(): Promise<CheckResult> {
  try {
    const config = await loadConfig();
    return { name: 'Config validation', passed: true, message: `Valid (version ${config.version})` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: 'Config validation', passed: false, message };
  }
}

/** Check that the SQLite database file exists */
export function checkDatabaseExists(): CheckResult {
  const dbPath = join(homeDir(), 'lil-dude.db');
  if (existsSync(dbPath)) {
    return { name: 'Database file', passed: true, message: dbPath };
  }
  return {
    name: 'Database file',
    passed: false,
    message: `Not found at ${dbPath}. It will be created on first start.`,
  };
}

/** Check that database migrations are current */
export function checkDatabaseMigrations(): CheckResult {
  const dbPath = join(homeDir(), 'lil-dude.db');
  if (!existsSync(dbPath)) {
    return { name: 'Database migrations', passed: false, message: 'Database does not exist yet' };
  }

  try {
    const dbManager = createDatabase(dbPath);
    try {
      dbManager.runMigrations();
      dbManager.close();
      return { name: 'Database migrations', passed: true, message: 'All migrations applied' };
    } catch (migrationError: unknown) {
      dbManager.close();
      const message = migrationError instanceof Error ? migrationError.message : String(migrationError);
      return { name: 'Database migrations', passed: false, message };
    }
  } catch (dbError: unknown) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    return { name: 'Database migrations', passed: false, message };
  }
}

/** Check hardware profile */
export async function checkHardware(): Promise<CheckResult> {
  try {
    const hw: HardwareProfile = await detectHardware();
    const features = [];
    if (hw.features.browserAutomation) features.push('browser');
    if (hw.features.localModels) features.push('local-models');
    if (hw.features.voice) features.push('voice');
    const featureStr = features.length > 0 ? features.join(', ') : 'none';
    return {
      name: 'Hardware',
      passed: true,
      message: `${hw.os}/${hw.arch}, ${hw.ramGb}GB RAM, ${hw.cpuCores} cores, GPU: ${hw.hasGpu ? 'yes' : 'no'}, features: ${featureStr}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: 'Hardware', passed: false, message };
  }
}

/** Check if any API keys are configured */
export async function checkApiKeys(): Promise<CheckResult> {
  let config: Config;
  try {
    config = await loadConfig();
  } catch {
    return { name: 'API keys', passed: false, message: 'Cannot check — config is invalid' };
  }

  const providers: string[] = [];
  if (config.providers.anthropic.enabled && config.providers.anthropic.apiKey) providers.push('Anthropic');
  if (config.providers.openai.enabled && config.providers.openai.apiKey) providers.push('OpenAI');
  if (config.providers.deepseek.enabled && config.providers.deepseek.apiKey) providers.push('DeepSeek');
  if (config.providers.gemini.enabled && config.providers.gemini.apiKey) providers.push('Gemini');
  if (config.providers.ollama.enabled) providers.push('Ollama (local)');

  if (providers.length > 0) {
    return { name: 'API keys', passed: true, message: `Configured: ${providers.join(', ')}` };
  }
  return {
    name: 'API keys',
    passed: false,
    message: 'No providers configured. Set API keys via env vars or config file.',
  };
}
