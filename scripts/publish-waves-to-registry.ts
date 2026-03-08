#!/usr/bin/env npx tsx

/**
 * Publish community waves from lildude to the wave-registry repo.
 *
 * Quality gates:
 * 1. Valid wave.json (parseable JSON with required fields)
 * 2. At least 1 trigger
 * 3. Non-empty description
 * 4. Has an entry point file (index.js)
 * 5. No dangerous shell permissions (rm, sudo, chmod, etc.)
 *
 * Usage:
 *   npx tsx scripts/publish-waves-to-registry.ts [--dry-run]
 *
 * Assumes the wave-registry repo is a sibling directory:
 *   ../wave-registry/
 */

import { existsSync, readdirSync, readFileSync, statSync, cpSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LILDUDE_ROOT = join(__dirname, '..');
const COMMUNITY_DIR = join(LILDUDE_ROOT, 'waves', 'community');
const REGISTRY_ROOT = join(LILDUDE_ROOT, '..', 'wave-registry');
const REGISTRY_WAVES_DIR = join(REGISTRY_ROOT, 'waves');

/** Dangerous shell commands that disqualify a wave. */
const DANGEROUS_SHELL_COMMANDS = new Set([
  'rm', 'rmdir', 'sudo', 'chmod', 'chown', 'chgrp',
  'mkfs', 'dd', 'fdisk', 'kill', 'killall',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'passwd', 'useradd', 'userdel', 'groupadd',
  'iptables', 'ufw', 'nft',
]);

interface QualityResult {
  name: string;
  passed: boolean;
  reason?: string;
}

/**
 * Validate a wave manifest against quality gates.
 */
function validateWave(waveDir: string, waveName: string): QualityResult {
  const manifestPath = join(waveDir, 'wave.json');

  // Gate 1: wave.json exists and is parseable
  if (!existsSync(manifestPath)) {
    return { name: waveName, passed: false, reason: 'missing wave.json' };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return { name: waveName, passed: false, reason: 'invalid JSON in wave.json' };
  }

  // Gate 1b: Required fields
  if (!manifest.name || typeof manifest.name !== 'string') {
    return { name: waveName, passed: false, reason: 'missing or invalid name' };
  }

  // Gate 2: At least 1 trigger
  const triggers = manifest.triggers;
  if (!Array.isArray(triggers) || triggers.length === 0) {
    return { name: waveName, passed: false, reason: 'no triggers defined' };
  }

  // Gate 3: Non-empty description
  if (!manifest.description || typeof manifest.description !== 'string' || manifest.description.trim().length === 0) {
    return { name: waveName, passed: false, reason: 'empty or missing description' };
  }

  // Gate 4: Entry point exists
  const entryPoint = (manifest.entryPoint as string) || 'index.js';
  if (!existsSync(join(waveDir, entryPoint))) {
    return { name: waveName, passed: false, reason: `missing entry point: ${entryPoint}` };
  }

  // Gate 5: No dangerous shell permissions
  const permissions = manifest.permissions as Record<string, unknown> | undefined;
  if (permissions && Array.isArray(permissions.shell)) {
    for (const cmd of permissions.shell) {
      if (typeof cmd === 'string' && DANGEROUS_SHELL_COMMANDS.has(cmd.toLowerCase())) {
        return { name: waveName, passed: false, reason: `dangerous shell permission: ${cmd}` };
      }
    }
  }

  return { name: waveName, passed: true };
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');

  console.log('=== Wave Registry Publisher ===\n');

  // Verify directories exist
  if (!existsSync(COMMUNITY_DIR)) {
    console.error(`Community waves directory not found: ${COMMUNITY_DIR}`);
    process.exit(1);
  }

  if (!existsSync(REGISTRY_ROOT)) {
    console.error(`Wave registry repo not found: ${REGISTRY_ROOT}`);
    console.error('Expected it as a sibling to lildude at ../wave-registry/');
    process.exit(1);
  }

  if (!existsSync(REGISTRY_WAVES_DIR)) {
    mkdirSync(REGISTRY_WAVES_DIR, { recursive: true });
  }

  // Count existing registry waves (to preserve them)
  const existingRegistryWaves = new Set(
    readdirSync(REGISTRY_WAVES_DIR).filter((e) => {
      try {
        return statSync(join(REGISTRY_WAVES_DIR, e)).isDirectory();
      } catch {
        return false;
      }
    }),
  );
  console.log(`Existing registry waves: ${existingRegistryWaves.size}`);

  // Scan and validate community waves
  const communityEntries = readdirSync(COMMUNITY_DIR).filter((e) => {
    try {
      return statSync(join(COMMUNITY_DIR, e)).isDirectory();
    } catch {
      return false;
    }
  });

  console.log(`Community waves to scan: ${communityEntries.length}\n`);

  const passed: QualityResult[] = [];
  const failed: QualityResult[] = [];
  let skippedExisting = 0;

  for (const entry of communityEntries) {
    const waveDir = join(COMMUNITY_DIR, entry);

    // Skip if already in registry
    if (existingRegistryWaves.has(entry)) {
      skippedExisting++;
      continue;
    }

    const result = validateWave(waveDir, entry);
    if (result.passed) {
      passed.push(result);
    } else {
      failed.push(result);
    }
  }

  console.log(`Quality gate results:`);
  console.log(`  Passed: ${passed.length}`);
  console.log(`  Failed: ${failed.length}`);
  console.log(`  Skipped (already in registry): ${skippedExisting}\n`);

  if (failed.length > 0) {
    console.log('Failed waves (sample):');
    for (const f of failed.slice(0, 10)) {
      console.log(`  ${f.name}: ${f.reason}`);
    }
    if (failed.length > 10) {
      console.log(`  ... and ${failed.length - 10} more`);
    }
    console.log();
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would copy ${passed.length} waves to registry. Exiting.`);
    return;
  }

  // Copy passing waves to registry
  console.log(`Copying ${passed.length} waves to ${REGISTRY_WAVES_DIR}...\n`);
  let copied = 0;

  for (const wave of passed) {
    const srcDir = join(COMMUNITY_DIR, wave.name);
    const destDir = join(REGISTRY_WAVES_DIR, wave.name);

    try {
      cpSync(srcDir, destDir, { recursive: true });
      copied++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Failed to copy ${wave.name}: ${msg}`);
    }
  }

  console.log(`Copied ${copied} waves to registry.\n`);

  // Rebuild registry.json
  console.log('Rebuilding registry.json...\n');
  try {
    execSync('node scripts/build-registry.js', {
      cwd: REGISTRY_ROOT,
      stdio: 'inherit',
    });
  } catch {
    console.error('Failed to rebuild registry. Run manually:');
    console.error(`  cd ${REGISTRY_ROOT} && node scripts/build-registry.js`);
  }

  console.log(`\nDone! ${copied} new waves published to wave-registry.`);
  console.log(`Total registry waves: ${existingRegistryWaves.size + copied}`);
  console.log('\nNext steps:');
  console.log(`  1. cd ${REGISTRY_ROOT}`);
  console.log('  2. Review the changes: git diff --stat');
  console.log('  3. Commit and push: git add -A && git commit -m "Publish community waves"');
}

main();
