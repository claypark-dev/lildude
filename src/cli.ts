#!/usr/bin/env node

/**
 * Lil Dude CLI entry point.
 * Registers commands: --version, doctor, start, onboard, wave.
 * See HLD Section 5 (Step 9).
 */

import { Command } from 'commander';
import { join } from 'node:path';
import { runDoctor } from './cli/doctor.js';
import { runOnboardingWizard } from './onboarding/wizard.js';
import { startApp, startOnboardingMode, isOnboarded } from './index.js';
import { loadConfig, homeDir } from './config/loader.js';
import { createDatabase } from './persistence/db.js';
import { installWave, listWaves, uninstallWave, searchWaves } from './waves/hub.js';
import type { SecurityLevel } from './security/permissions.js';

const program = new Command();

program
  .name('lil-dude')
  .description('Your personal AI executive assistant')
  .version('0.1.0');

program
  .command('doctor')
  .description('Check system health and configuration')
  .action(async () => {
    const exitCode = await runDoctor();
    process.exit(exitCode);
  });

program
  .command('start')
  .description('Start the Lil Dude agent')
  .action(async () => {
    if (!isOnboarded()) {
      // No config found — start in onboarding mode with web wizard
      console.log('No configuration found — starting in onboarding mode.');
      console.log('Open the web panel to set up your assistant.\n');
      try {
        await startOnboardingMode();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to start onboarding mode: ${message}`);
        process.exit(1);
      }
      return;
    }

    try {
      await startApp();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to start Lil Dude: ${message}`);
      process.exit(1);
    }
  });

program
  .command('onboard')
  .description('Run the onboarding wizard')
  .action(async () => {
    try {
      await runOnboardingWizard();
    } catch {
      process.exit(1);
    }
  });

const waveCmd = program
  .command('wave')
  .description('Manage waves: install, list, uninstall, search');

waveCmd
  .command('install <source>')
  .description('Install a wave from GitHub (e.g. github:user/repo)')
  .action(async (source: string) => {
    try {
      const config = await loadConfig();
      const dbPath = join(homeDir(), 'lil-dude.db');
      const dbManager = createDatabase(dbPath);
      dbManager.runMigrations();

      const securityLevel = config.security.level as SecurityLevel;
      const manifest = await installWave(dbManager.db, source, securityLevel);
      console.log(`Installed wave "${manifest.name}" v${manifest.version}`);

      dbManager.close();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to install wave: ${message}`);
      process.exit(1);
    }
  });

waveCmd
  .command('list')
  .description('List all installed and bundled waves')
  .action(async () => {
    try {
      await loadConfig();
      const dbPath = join(homeDir(), 'lil-dude.db');
      const dbManager = createDatabase(dbPath);
      dbManager.runMigrations();

      const waves = listWaves(dbManager.db);
      if (waves.length === 0) {
        console.log('No waves found.');
      } else {
        for (const wave of waves) {
          console.log(`  ${wave.name} v${wave.version} [${wave.source}] (${wave.status})`);
        }
      }

      dbManager.close();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to list waves: ${message}`);
      process.exit(1);
    }
  });

waveCmd
  .command('uninstall <name>')
  .description('Uninstall an installed wave by name')
  .action(async (name: string) => {
    try {
      await loadConfig();
      const dbPath = join(homeDir(), 'lil-dude.db');
      const dbManager = createDatabase(dbPath);
      dbManager.runMigrations();

      await uninstallWave(dbManager.db, name);
      console.log(`Uninstalled wave "${name}"`);

      dbManager.close();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to uninstall wave: ${message}`);
      process.exit(1);
    }
  });

waveCmd
  .command('search <query>')
  .description('Search the wave registry')
  .action((query: string) => {
    try {
      const results = searchWaves(query);
      if (results.length === 0) {
        console.log(`No waves found matching "${query}".`);
      } else {
        console.log(`Found ${results.length} wave(s):`);
        for (const entry of results) {
          console.log(`  ${entry.name} v${entry.version} — ${entry.description}`);
          console.log(`    Install: lil-dude wave install ${entry.source}`);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to search waves: ${message}`);
      process.exit(1);
    }
  });

program.parse();
