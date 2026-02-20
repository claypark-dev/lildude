#!/usr/bin/env node

/**
 * Lil Dude CLI entry point.
 * Registers commands: --version, doctor, start, onboard, skill.
 * See HLD Section 5 (Step 9).
 */

import { Command } from 'commander';
import { join } from 'node:path';
import { runDoctor } from './cli/doctor.js';
import { runOnboardingWizard } from './onboarding/wizard.js';
import { startApp, startOnboardingMode, isOnboarded } from './index.js';
import { loadConfig, homeDir } from './config/loader.js';
import { createDatabase } from './persistence/db.js';
import { installSkill, listSkills, uninstallSkill, searchSkills } from './skills/hub.js';
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

const skillCmd = program
  .command('skill')
  .description('Manage skills: install, list, uninstall, search');

skillCmd
  .command('install <source>')
  .description('Install a skill from GitHub (e.g. github:user/repo)')
  .action(async (source: string) => {
    try {
      const config = await loadConfig();
      const dbPath = join(homeDir(), 'lil-dude.db');
      const dbManager = createDatabase(dbPath);
      dbManager.runMigrations();

      const securityLevel = config.security.level as SecurityLevel;
      const manifest = await installSkill(dbManager.db, source, securityLevel);
      console.log(`Installed skill "${manifest.name}" v${manifest.version}`);

      dbManager.close();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to install skill: ${message}`);
      process.exit(1);
    }
  });

skillCmd
  .command('list')
  .description('List all installed and bundled skills')
  .action(async () => {
    try {
      await loadConfig();
      const dbPath = join(homeDir(), 'lil-dude.db');
      const dbManager = createDatabase(dbPath);
      dbManager.runMigrations();

      const skills = listSkills(dbManager.db);
      if (skills.length === 0) {
        console.log('No skills found.');
      } else {
        for (const skill of skills) {
          console.log(`  ${skill.name} v${skill.version} [${skill.source}] (${skill.status})`);
        }
      }

      dbManager.close();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to list skills: ${message}`);
      process.exit(1);
    }
  });

skillCmd
  .command('uninstall <name>')
  .description('Uninstall an installed skill by name')
  .action(async (name: string) => {
    try {
      await loadConfig();
      const dbPath = join(homeDir(), 'lil-dude.db');
      const dbManager = createDatabase(dbPath);
      dbManager.runMigrations();

      await uninstallSkill(dbManager.db, name);
      console.log(`Uninstalled skill "${name}"`);

      dbManager.close();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to uninstall skill: ${message}`);
      process.exit(1);
    }
  });

skillCmd
  .command('search <query>')
  .description('Search the skill registry')
  .action((query: string) => {
    try {
      const results = searchSkills(query);
      if (results.length === 0) {
        console.log(`No skills found matching "${query}".`);
      } else {
        console.log(`Found ${results.length} skill(s):`);
        for (const entry of results) {
          console.log(`  ${entry.name} v${entry.version} — ${entry.description}`);
          console.log(`    Install: lil-dude skill install ${entry.source}`);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to search skills: ${message}`);
      process.exit(1);
    }
  });

program.parse();
