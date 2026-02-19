#!/usr/bin/env node

/**
 * Lil Dude CLI entry point.
 * Registers commands: --version, doctor, start, onboard.
 * See HLD Section 5 (Step 9).
 */

import { Command } from 'commander';
import { runDoctor } from './cli/doctor.js';
import { runOnboardingWizard } from './onboarding/wizard.js';
import { startApp, isOnboarded } from './index.js';

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
      console.error(
        'No configuration found. Please run `lil-dude onboard` first to set up your assistant.',
      );
      process.exit(1);
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

program.parse();
