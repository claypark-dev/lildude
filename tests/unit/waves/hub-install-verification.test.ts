/**
 * Tests for hash verification and trust logging in installWave().
 *
 * Validates the registryHash / verifyHash options and the trust-tier
 * security-log integration added to the wave installation flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { SecurityError } from '../../../src/errors.js';
import type { WaveManifest } from '../../../src/types/index.js';

// ---------------------------------------------------------------------------
// Module mocks — intercept persistence calls so we never hit real tables
// that may not exist in the test migration set.
// ---------------------------------------------------------------------------

vi.mock('../../../src/persistence/wave-package-hashes.js', () => ({
  verifyPackageHash: vi.fn(),
  storePackageHash: vi.fn(),
}));

vi.mock('../../../src/persistence/wave-community-trust.js', () => ({
  getTrustScore: vi.fn(),
}));

vi.mock('../../../src/persistence/security-log.js', () => ({
  appendSecurityLog: vi.fn().mockReturnValue({
    id: 1,
    actionType: 'wave_install',
    actionDetail: '',
    allowed: true,
    securityLevel: 5,
    reason: null,
    taskId: null,
    createdAt: new Date(),
  }),
}));

vi.mock('../../../src/persistence/wave-install-counts.js', () => ({
  incrementInstallCount: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  persistenceLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import the function under test and the mocked modules so we can assert.
// ---------------------------------------------------------------------------

import { installWave } from '../../../src/waves/hub.js';
import { verifyPackageHash, storePackageHash } from '../../../src/persistence/wave-package-hashes.js';
import { getTrustScore } from '../../../src/persistence/wave-community-trust.js';
import { appendSecurityLog } from '../../../src/persistence/security-log.js';

const mockVerifyPackageHash = vi.mocked(verifyPackageHash);
const mockStorePackageHash = vi.mocked(storePackageHash);
const mockGetTrustScore = vi.mocked(getTrustScore);
const mockAppendSecurityLog = vi.mocked(appendSecurityLog);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

/** Minimal valid manifest for testing. */
function createValidManifest(overrides: Partial<WaveManifest> = {}): WaveManifest {
  return {
    name: 'test-wave',
    version: '1.0.0',
    description: 'A test wave',
    author: 'tester',
    permissions: {
      domains: [],
      shell: [],
      directories: [],
      requiresBrowser: false,
      requiresOAuth: [],
    },
    triggers: ['test'],
    deterministic: true,
    tools: [],
    minTier: 'basic',
    entryPoint: 'index.js',
    ...overrides,
  };
}

/** Creates a cloneFn that writes a valid manifest into the temp directory. */
function makeCloneFn(manifest: WaveManifest) {
  return async (_repoUrl: string, destPath: string): Promise<void> => {
    mkdirSync(destPath, { recursive: true });
    writeFileSync(join(destPath, 'wave.json'), JSON.stringify(manifest));
    writeFileSync(join(destPath, 'index.js'), 'module.exports = {}');
  };
}

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('installWave — hash verification and trust logging', () => {
  let manager: DatabaseManager;
  let tempInstalledDir: string;

  beforeEach(() => {
    manager = createTestDb();
    tempInstalledDir = join(tmpdir(), `lildude-test-verify-${nanoid()}`);
    mkdirSync(tempInstalledDir, { recursive: true });

    vi.clearAllMocks();

    // Default: no trust entry, hash verification returns null (no stored hash)
    mockGetTrustScore.mockReturnValue(null);
    mockVerifyPackageHash.mockReturnValue(null);
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {
      // best-effort cleanup
    }
    try {
      rmSync(tempInstalledDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('proceeds normally when no registryHash is provided (backward compat)', async () => {
    const manifest = createValidManifest({ name: 'no-hash-wave' });
    const cloneFn = makeCloneFn(manifest);

    const result = await installWave(manager.db, 'github:user/no-hash-wave', 5, {
      installedDir: tempInstalledDir,
      cloneFn,
    });

    expect(result.name).toBe('no-hash-wave');
    // verifyPackageHash should never be called when no registryHash is supplied
    expect(mockVerifyPackageHash).not.toHaveBeenCalled();
    expect(mockStorePackageHash).not.toHaveBeenCalled();
  });

  it('proceeds when verifyHash is false (skip verification)', async () => {
    const manifest = createValidManifest({ name: 'skip-verify-wave' });
    const cloneFn = makeCloneFn(manifest);

    const result = await installWave(manager.db, 'github:user/skip-verify-wave', 5, {
      installedDir: tempInstalledDir,
      cloneFn,
      registryHash: 'sha256-abc123',
      verifyHash: false,
    });

    expect(result.name).toBe('skip-verify-wave');
    // Even though registryHash is provided, verifyHash=false bypasses the check
    expect(mockVerifyPackageHash).not.toHaveBeenCalled();
    expect(mockStorePackageHash).not.toHaveBeenCalled();
  });

  it('throws SecurityError when hash mismatch detected', async () => {
    const manifest = createValidManifest({ name: 'tampered-wave' });
    const cloneFn = makeCloneFn(manifest);

    // Simulate a stored hash that does NOT match the provided registryHash
    mockVerifyPackageHash.mockReturnValue(false);

    await expect(
      installWave(manager.db, 'github:user/tampered-wave', 5, {
        installedDir: tempInstalledDir,
        cloneFn,
        registryHash: 'sha256-tampered',
      }),
    ).rejects.toThrow(SecurityError);

    expect(mockVerifyPackageHash).toHaveBeenCalledWith(
      manager.db,
      'tampered-wave',
      'sha256-tampered',
    );

    // Should NOT store the hash on mismatch
    expect(mockStorePackageHash).not.toHaveBeenCalled();

    // A security log entry should record the blocked install
    expect(mockAppendSecurityLog).toHaveBeenCalledWith(
      manager.db,
      expect.objectContaining({
        actionType: 'wave_install',
        allowed: false,
        reason: 'Package hash does not match stored hash',
      }),
    );
  });

  it('stores hash when it is a new wave with no stored hash', async () => {
    const manifest = createValidManifest({ name: 'new-wave' });
    const cloneFn = makeCloneFn(manifest);

    // null means no stored hash exists yet — first install
    mockVerifyPackageHash.mockReturnValue(null);

    const result = await installWave(manager.db, 'github:user/new-wave', 5, {
      installedDir: tempInstalledDir,
      cloneFn,
      registryHash: 'sha256-first-install',
    });

    expect(result.name).toBe('new-wave');

    // Should have verified (returned null) and then stored the new hash
    expect(mockVerifyPackageHash).toHaveBeenCalledWith(
      manager.db,
      'new-wave',
      'sha256-first-install',
    );
    expect(mockStorePackageHash).toHaveBeenCalledWith(
      manager.db,
      'new-wave',
      '1.0.0',
      'sha256-first-install',
    );
  });

  it('logs trust tier to security log when trust entry exists', async () => {
    const manifest = createValidManifest({ name: 'trusted-wave' });
    const cloneFn = makeCloneFn(manifest);

    // Simulate an existing trust entry for this wave
    mockGetTrustScore.mockReturnValue({
      waveName: 'trusted-wave',
      trustScore: 85,
      trustTier: 'verified',
      scanPassed: true,
      sandboxPassed: true,
      highFindings: 0,
      criticalFindings: 0,
      computedAt: new Date(),
    });

    const result = await installWave(manager.db, 'github:user/trusted-wave', 5, {
      installedDir: tempInstalledDir,
      cloneFn,
    });

    expect(result.name).toBe('trusted-wave');

    // appendSecurityLog should have been called with trust tier information
    expect(mockAppendSecurityLog).toHaveBeenCalledWith(
      manager.db,
      expect.objectContaining({
        actionType: 'wave_install',
        actionDetail: expect.stringContaining('trust tier: verified'),
        allowed: true,
        reason: 'Trust tier: verified',
      }),
    );
  });
});
