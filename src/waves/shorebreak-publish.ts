/**
 * Shorebreak-to-community publish integration.
 * Enables publishing generated waves from Shorebreak directly to the community registry.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import type { WaveProposal } from './shorebreak.js';
import { packageWave } from './packager.js';
import { publishToRegistry } from './publisher.js';
import { recordPublish } from '../persistence/wave-publish-history.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('shorebreak-publish');

/** Options for publishing a Shorebreak-generated wave. */
export interface ShorebreakPublishOptions {
  /** GitHub PAT for creating the PR. */
  githubToken: string;
  /** Override registry repo (default: claypark-dev/wave-registry). */
  registryRepo?: string;
  /** Skip sandbox execution during packaging. */
  skipSandbox?: boolean;
}

/** Result of a Shorebreak publish attempt. */
export interface ShorebreakPublishResult {
  success: boolean;
  prUrl: string | null;
  prNumber: number | null;
  branch: string | null;
  packageHash: string | null;
  error: string | null;
}

/**
 * Publish a Shorebreak-generated wave proposal to the community registry.
 *
 * Workflow:
 * 1. Write the proposal's source code and manifest to a temp directory
 * 2. Package the wave (validates, scans, sandboxes, hashes)
 * 3. Publish to the registry via GitHub PR
 * 4. Record in publish history
 * 5. Clean up the temp directory
 *
 * @param db - Database connection.
 * @param proposal - The approved wave proposal from Shorebreak.
 * @param options - Publishing options (GitHub token, etc.).
 * @returns The publish result.
 */
export async function publishShorebreakWave(
  db: BetterSqlite3.Database,
  proposal: WaveProposal,
  options: ShorebreakPublishOptions,
): Promise<ShorebreakPublishResult> {
  const tempDir = join(tmpdir(), `lildude-shorebreak-publish-${nanoid()}`);

  logger.info({ name: proposal.name, tempDir }, 'Starting Shorebreak wave publish');

  try {
    // 1. Write proposal to temp directory
    await mkdir(tempDir, { recursive: true });

    const manifest = {
      name: proposal.name,
      version: '1.0.0',
      description: proposal.description,
      author: 'shorebreak',
      permissions: {
        domains: proposal.requiredDomains,
        shell: [],
        directories: [],
        requiresBrowser: false,
        requiresOAuth: [],
      },
      triggers: [],
      deterministic: false,
      tools: [],
      minTier: 'basic',
      entryPoint: 'index.js',
      safetyTier: proposal.safetyTier,
      category: 'uncategorized',
    };

    await writeFile(join(tempDir, 'wave.json'), JSON.stringify(manifest, null, 2));
    await writeFile(join(tempDir, 'index.js'), proposal.sourceCode);

    // 2. Package the wave
    const pkg = await packageWave(tempDir, { skipSandbox: options.skipSandbox });

    if (!pkg.scanResult.passed) {
      logger.warn({ name: proposal.name }, 'Shorebreak wave failed security scan');
      return {
        success: false,
        prUrl: null,
        prNumber: null,
        branch: null,
        packageHash: pkg.packageHash,
        error: `Security scan failed: ${pkg.scanResult.findings.length} findings`,
      };
    }

    // 3. Publish to registry
    const publishResult = await publishToRegistry(pkg, {
      githubToken: options.githubToken,
      registryRepo: options.registryRepo,
    });

    // 4. Record in publish history
    recordPublish(
      db,
      proposal.name,
      '1.0.0',
      publishResult.prUrl,
      publishResult.prNumber,
    );

    logger.info(
      { name: proposal.name, prUrl: publishResult.prUrl },
      'Shorebreak wave published successfully',
    );

    return {
      success: true,
      prUrl: publishResult.prUrl,
      prNumber: publishResult.prNumber,
      branch: publishResult.branch,
      packageHash: pkg.packageHash,
      error: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ name: proposal.name, error: message }, 'Failed to publish Shorebreak wave');
    return {
      success: false,
      prUrl: null,
      prNumber: null,
      branch: null,
      packageHash: null,
      error: message,
    };
  } finally {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      logger.warn({ tempDir }, 'Failed to clean up temp directory');
    }
  }
}

/**
 * Check if a Shorebreak proposal is eligible for community publishing.
 *
 * @param proposal - The wave proposal to check.
 * @returns Whether the proposal can be published and the reason if not.
 */
export function isPublishEligible(
  proposal: WaveProposal,
): { eligible: boolean; reason: string | null } {
  if (!proposal.scanPassed) {
    return { eligible: false, reason: 'Wave did not pass security scan' };
  }

  if (!proposal.testPassed) {
    return { eligible: false, reason: 'Wave did not pass sandbox test' };
  }

  if (!proposal.name || proposal.name.length < 3) {
    return { eligible: false, reason: 'Wave name must be at least 3 characters' };
  }

  return { eligible: true, reason: null };
}
