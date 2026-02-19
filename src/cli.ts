#!/usr/bin/env node

/**
 * Lil Dude CLI entry point.
 * Registers commands: --version, doctor, start, onboard.
 * See HLD Section 5 (Step 9).
 */

import { Command } from 'commander';
import { runDoctor } from './cli/doctor.js';

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
  .action(() => {
    console.log('Starting Lil Dude... (not yet implemented — coming in Sprint 1)');
  });

program
  .command('onboard')
  .description('Run the onboarding wizard')
  .action(() => {
    console.log('Onboarding wizard... (not yet implemented — coming in Sprint 1)');
  });

program.parse();
