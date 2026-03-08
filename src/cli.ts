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
import { packageWave } from './waves/packager.js';
import { publishToRegistry } from './waves/publisher.js';
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
  .action(async (query: string) => {
    try {
      const dbPath = join(homeDir(), 'lil-dude.db');
      const dbManager = createDatabase(dbPath);
      dbManager.runMigrations();

      const results = await searchWaves(dbManager.db, query);
      if (results.length === 0) {
        console.log(`No waves found matching "${query}".`);
      } else {
        console.log(`Found ${results.length} wave(s):`);
        for (const entry of results) {
          console.log(`  ${entry.name} v${entry.version} — ${entry.description}`);
          console.log(`    Install: lil-dude wave install ${entry.source}`);
        }
      }

      dbManager.close();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to search waves: ${message}`);
      process.exit(1);
    }
  });

waveCmd
  .command('publish <path>')
  .description('Publish a wave to the community registry via GitHub PR')
  .option('--dry-run', 'Validate and scan without opening a PR')
  .option('--skip-sandbox', 'Skip sandbox execution (scan still required)')
  .option('--registry-repo <repo>', 'Override registry repo', 'clapyark/wave-registry')
  .option('--github-token <token>', 'GitHub PAT (or set GITHUB_TOKEN env var)')
  .action(async (wavePath: string, options: {
    dryRun?: boolean;
    skipSandbox?: boolean;
    registryRepo: string;
    githubToken?: string;
  }) => {
    try {
      const resolvedPath = wavePath.startsWith('/')
        ? wavePath
        : join(process.cwd(), wavePath);

      console.log(`Packaging wave from: ${resolvedPath}`);

      // Package (validate + scan + sandbox)
      const pkg = await packageWave(resolvedPath, { skipSandbox: options.skipSandbox });

      console.log(`  Name:      ${pkg.manifest.name}`);
      console.log(`  Version:   ${pkg.manifest.version}`);
      console.log(`  Files:     ${pkg.files.length}`);
      console.log(`  Size:      ${Math.round(pkg.totalSizeBytes / 1024)}KB`);
      console.log(`  Scan:      ${pkg.scanResult.passed ? 'PASSED' : 'FAILED'}`);
      if (pkg.sandboxResult) {
        console.log(`  Sandbox:   ${pkg.sandboxResult.success ? 'PASSED' : 'FAILED'}`);
      }
      console.log(`  Hash:      ${pkg.packageHash.slice(0, 16)}...`);

      if (options.dryRun) {
        console.log('\nDry run — validation passed. No PR created.');
        return;
      }

      const githubToken = options.githubToken ?? process.env.GITHUB_TOKEN;
      if (!githubToken) {
        console.error('GitHub token required. Use --github-token or set GITHUB_TOKEN env var.');
        process.exit(1);
      }

      console.log('\nPublishing to community registry...');
      const result = await publishToRegistry(pkg, {
        githubToken,
        registryRepo: options.registryRepo,
      });

      console.log(`\nPR created: ${result.prUrl}`);
      console.log(`Branch: ${result.branch}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to publish wave: ${message}`);
      process.exit(1);
    }
  });

waveCmd
  .command('validate <path>')
  .description('Validate a wave directory against community submission standards')
  .option('--skip-sandbox', 'Skip sandbox execution')
  .option('--json', 'Output results as JSON')
  .action(async (wavePath: string, options: { skipSandbox?: boolean; json?: boolean }) => {
    try {
      const resolvedPath = wavePath.startsWith('/')
        ? wavePath
        : join(process.cwd(), wavePath);

      const pkg = await packageWave(resolvedPath, { skipSandbox: options.skipSandbox });

      if (options.json) {
        console.log(JSON.stringify({
          valid: true,
          name: pkg.manifest.name,
          version: pkg.manifest.version,
          scanPassed: pkg.scanResult.passed,
          scanSummary: pkg.scanResult.summary,
          sandboxPassed: pkg.sandboxResult?.success ?? null,
          packageHash: pkg.packageHash,
          totalSizeBytes: pkg.totalSizeBytes,
          fileCount: pkg.files.length,
        }, null, 2));
      } else {
        console.log(`Validation PASSED for "${pkg.manifest.name}" v${pkg.manifest.version}`);
        console.log(`  Scan: ${pkg.scanResult.passed ? 'PASSED' : 'FAILED'} (${pkg.scanResult.findings.length} findings)`);
        if (pkg.sandboxResult) {
          console.log(`  Sandbox: ${pkg.sandboxResult.success ? 'PASSED' : 'FAILED'}`);
        }
        console.log(`  Size: ${Math.round(pkg.totalSizeBytes / 1024)}KB`);
        console.log(`  Hash: ${pkg.packageHash.slice(0, 16)}...`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ valid: false, error: message }));
      } else {
        console.error(`Validation FAILED: ${message}`);
      }
      process.exit(1);
    }
  });

program.parse();
