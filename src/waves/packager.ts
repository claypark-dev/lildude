/**
 * Wave packager for community publishing.
 * Validates, scans, sandboxes, and hashes a wave directory
 * to prepare it for submission to the community registry.
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { validateManifest } from './schema.js';
import { scanWaveCode } from './security-scanner.js';
import { executeSandboxed } from './shorebreak-sandbox.js';
import type { WaveManifest } from '../types/index.js';
import type { ScanResult } from './security-scanner.js';
import type { SandboxResult } from './shorebreak-sandbox.js';
import { createModuleLogger } from '../utils/logger.js';

const packagerLogger = createModuleLogger('wave-packager');

/** Maximum total package size in bytes (100KB). */
const MAX_PACKAGE_SIZE_BYTES = 100 * 1024;

/** Reserved name prefixes that only official waves may use. */
const RESERVED_PREFIXES = ['lil-dude-', 'lildude-'];

/** Bundled wave names that cannot be published as community waves. */
const BUNDLED_WAVE_NAMES = [
  'email-reader', 'email-sender', 'google-calendar', 'google-flights',
  'reminders', 'stock-monitor', 'web-search', 'auto-responder',
  'availability-check', 'contact-share', 'meeting-request', 'message-relay',
  'task-delegation', 'faq-responder', 'event-rsvp', 'document-request',
];

/** A single file in a wave package. */
export interface PackageFile {
  /** Path relative to the wave directory root. */
  relativePath: string;
  /** File content as a UTF-8 string. */
  content: string;
  /** SHA-256 hash of the file content. */
  hash: string;
}

/** Result of packaging a wave directory. */
export interface PackageResult {
  /** Validated wave manifest. */
  manifest: WaveManifest;
  /** All files in the package. */
  files: PackageFile[];
  /** Security scan result. */
  scanResult: ScanResult;
  /** Sandbox execution result (null if skipped). */
  sandboxResult: SandboxResult | null;
  /** SHA-256 hash of the entire package contents. */
  packageHash: string;
  /** Total size of all files in bytes. */
  totalSizeBytes: number;
}

/** Result of wave name validation. */
export interface NameValidationResult {
  /** Whether the name is valid for community publishing. */
  valid: boolean;
  /** Reason the name was rejected (if invalid). */
  reason?: string;
}

/**
 * Validate a wave name for community publishing rules.
 *
 * Rules:
 * - Must be kebab-case (lowercase letters, numbers, hyphens)
 * - 3–50 characters long
 * - Cannot start with reserved prefixes
 * - Cannot conflict with bundled wave names
 *
 * @param name - The wave name to validate.
 * @returns Validation result with reason if invalid.
 */
export function validateCommunityWaveName(name: string): NameValidationResult {
  if (name.length < 3) {
    return { valid: false, reason: 'Wave name must be at least 3 characters' };
  }

  if (name.length > 50) {
    return { valid: false, reason: 'Wave name must be 50 characters or fewer' };
  }

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    return {
      valid: false,
      reason: 'Wave name must be kebab-case (lowercase letters, numbers, hyphens only)',
    };
  }

  for (const prefix of RESERVED_PREFIXES) {
    if (name.startsWith(prefix)) {
      return {
        valid: false,
        reason: `Wave names starting with "${prefix}" are reserved for official waves`,
      };
    }
  }

  if (BUNDLED_WAVE_NAMES.includes(name)) {
    return {
      valid: false,
      reason: `"${name}" conflicts with a bundled wave name`,
    };
  }

  return { valid: true };
}

/**
 * Compute the SHA-256 hash of a package's file contents.
 * Files are sorted by path to ensure deterministic hashing.
 *
 * @param files - The package files to hash.
 * @returns A hex-encoded SHA-256 hash string.
 */
export function computePackageHash(files: PackageFile[]): string {
  const hasher = createHash('sha256');
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const file of sorted) {
    hasher.update(file.relativePath);
    hasher.update(file.content);
  }

  return hasher.digest('hex');
}

/**
 * Read all files from a wave directory into PackageFile objects.
 * Skips hidden files and directories (starting with '.').
 *
 * @param wavePath - Absolute path to the wave directory.
 * @returns Array of PackageFile objects.
 */
function readWaveFiles(wavePath: string): PackageFile[] {
  const files: PackageFile[] = [];

  function walk(dirPath: string): void {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files/dirs and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const content = readFileSync(fullPath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex');
        files.push({
          relativePath: relative(wavePath, fullPath),
          content,
          hash,
        });
      }
    }
  }

  walk(wavePath);
  return files;
}

/**
 * Validate, scan, and package a wave directory for community publishing.
 *
 * Steps:
 * 1. Read and validate wave.json manifest
 * 2. Validate community naming rules
 * 3. Read all files and compute hashes
 * 4. Check total package size
 * 5. Run security scan on entry point
 * 6. Optionally run sandbox execution
 * 7. Compute overall package hash
 *
 * @param wavePath - Absolute path to the wave directory.
 * @param options - Optional flags (e.g., skipSandbox).
 * @returns A PackageResult with all validation data.
 * @throws Error if any validation step fails.
 */
export async function packageWave(
  wavePath: string,
  options?: { skipSandbox?: boolean },
): Promise<PackageResult> {
  // 1. Check directory exists
  if (!existsSync(wavePath) || !statSync(wavePath).isDirectory()) {
    throw new Error(`Wave path does not exist or is not a directory: ${wavePath}`);
  }

  // 2. Read and validate manifest
  const manifestPath = join(wavePath, 'wave.json');
  if (!existsSync(manifestPath)) {
    throw new Error('wave.json not found in wave directory');
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    throw new Error('wave.json is not valid JSON');
  }

  const validationResult = validateManifest(rawManifest);
  if (!validationResult.valid || !validationResult.manifest) {
    const errorMessages = validationResult.errors?.join('; ') ?? 'Unknown validation error';
    throw new Error(`Invalid wave manifest: ${errorMessages}`);
  }

  const manifest = validationResult.manifest;

  // 3. Validate community naming rules
  const nameResult = validateCommunityWaveName(manifest.name);
  if (!nameResult.valid) {
    throw new Error(`Invalid wave name: ${nameResult.reason}`);
  }

  // 4. Check entry point exists
  const entryPointPath = join(wavePath, manifest.entryPoint);
  if (!existsSync(entryPointPath)) {
    throw new Error(`Entry point "${manifest.entryPoint}" not found in wave directory`);
  }

  // 5. Read all files
  const files = readWaveFiles(wavePath);
  const totalSizeBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0);

  if (totalSizeBytes > MAX_PACKAGE_SIZE_BYTES) {
    throw new Error(
      `Package size (${Math.round(totalSizeBytes / 1024)}KB) exceeds maximum (${MAX_PACKAGE_SIZE_BYTES / 1024}KB)`,
    );
  }

  // 6. Security scan
  const entryPointContent = readFileSync(entryPointPath, 'utf-8');
  const scanResult = scanWaveCode(entryPointContent, manifest.permissions.domains);

  if (!scanResult.passed) {
    throw new Error(
      `Security scan failed: ${scanResult.summary.critical} critical finding(s). ` +
      `Wave cannot be published with critical security issues.`,
    );
  }

  packagerLogger.info(
    { waveName: manifest.name, scanPassed: scanResult.passed, findings: scanResult.findings.length },
    'Security scan complete',
  );

  // 7. Sandbox execution (optional)
  let sandboxResult: SandboxResult | null = null;

  if (!options?.skipSandbox) {
    try {
      sandboxResult = await executeSandboxed(
        entryPointContent,
        {},
        manifest.permissions.domains,
      );

      if (!sandboxResult.success) {
        throw new Error(`Sandbox execution failed: ${sandboxResult.error}`);
      }

      packagerLogger.info(
        { waveName: manifest.name, sandboxSuccess: sandboxResult.success },
        'Sandbox test complete',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Sandbox test failed: ${message}`);
    }
  }

  // 8. Compute package hash
  const packageHash = computePackageHash(files);

  packagerLogger.info(
    { waveName: manifest.name, fileCount: files.length, totalSizeBytes, packageHash },
    'Wave packaged successfully',
  );

  return {
    manifest,
    files,
    scanResult,
    sandboxResult,
    packageHash,
    totalSizeBytes,
  };
}
