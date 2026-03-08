import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import type { WaveProposal } from '../../../src/waves/shorebreak.js';
import type { ScanResult } from '../../../src/waves/security-scanner.js';

// Mock packageWave and publishToRegistry — they perform filesystem & network I/O.
vi.mock('../../../src/waves/packager.js', () => ({
  packageWave: vi.fn(),
}));

vi.mock('../../../src/waves/publisher.js', () => ({
  publishToRegistry: vi.fn(),
}));

// Also mock recordPublish to avoid requiring the full publish-history table setup.
vi.mock('../../../src/persistence/wave-publish-history.js', () => ({
  recordPublish: vi.fn(),
}));

const { packageWave } = await import('../../../src/waves/packager.js');
const { publishToRegistry } = await import('../../../src/waves/publisher.js');

import {
  isPublishEligible,
  publishShorebreakWave,
  type ShorebreakPublishResult,
  type ShorebreakPublishOptions,
} from '../../../src/waves/shorebreak-publish.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

/** Helper: build a minimal WaveProposal for testing. */
function makeProposal(overrides: Partial<WaveProposal> = {}): WaveProposal {
  return {
    id: 'test-proposal-1',
    name: 'test-wave',
    description: 'A test wave for unit tests',
    sourceCode: 'var execute = async (params) => { return "hello"; };',
    safetyTier: 'observe',
    sourceTemplate: 'free-form',
    requiredDomains: [],
    scanResult: {
      passed: true,
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    } as ScanResult,
    scanPassed: true,
    testPassed: true,
    generationCostUsd: 0.001,
    ...overrides,
  };
}

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

describe('shorebreak-publish', () => {
  let manager: DatabaseManager;
  const mockedPackageWave = vi.mocked(packageWave);
  const mockedPublishToRegistry = vi.mocked(publishToRegistry);

  beforeEach(() => {
    manager = createTestDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {
      // best-effort cleanup
    }
  });

  // === isPublishEligible ===

  describe('isPublishEligible', () => {
    it('returns eligible for waves that pass scan and test', () => {
      const proposal = makeProposal({
        scanPassed: true,
        testPassed: true,
        name: 'good-wave',
      });

      const result = isPublishEligible(proposal);

      expect(result.eligible).toBe(true);
      expect(result.reason).toBeNull();
    });

    it('returns not eligible when scan fails', () => {
      const proposal = makeProposal({
        scanPassed: false,
        testPassed: true,
        name: 'unsafe-wave',
      });

      const result = isPublishEligible(proposal);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('security scan');
    });

    it('returns not eligible when test fails', () => {
      const proposal = makeProposal({
        scanPassed: true,
        testPassed: false,
        name: 'broken-wave',
      });

      const result = isPublishEligible(proposal);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('sandbox test');
    });

    it('returns not eligible when name is too short', () => {
      const proposal = makeProposal({
        scanPassed: true,
        testPassed: true,
        name: 'ab',
      });

      const result = isPublishEligible(proposal);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('at least 3 characters');
    });

    it('returns not eligible when name is empty', () => {
      const proposal = makeProposal({
        scanPassed: true,
        testPassed: true,
        name: '',
      });

      const result = isPublishEligible(proposal);

      expect(result.eligible).toBe(false);
    });
  });

  // === publishShorebreakWave ===

  describe('publishShorebreakWave', () => {
    const defaultOptions: ShorebreakPublishOptions = {
      githubToken: 'ghp_testtoken123456',
    };

    it('returns error result when packaging fails', async () => {
      mockedPackageWave.mockRejectedValue(new Error('Package validation failed'));

      const proposal = makeProposal({ name: 'bad-package-wave' });
      const result = await publishShorebreakWave(manager.db, proposal, defaultOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Package validation failed');
      expect(result.prUrl).toBeNull();
      expect(result.prNumber).toBeNull();
      expect(result.branch).toBeNull();
      expect(result.packageHash).toBeNull();
    });

    it('returns error result when scan fails during packaging', async () => {
      mockedPackageWave.mockResolvedValue({
        manifest: {} as any,
        files: [],
        scanResult: {
          passed: false,
          findings: [{ severity: 'high', message: 'Dangerous pattern', line: 1 }],
          summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
        },
        sandboxResult: null,
        packageHash: 'abc123',
        totalSizeBytes: 500,
      });

      const proposal = makeProposal({ name: 'scan-fail-wave' });
      const result = await publishShorebreakWave(manager.db, proposal, defaultOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Security scan failed');
      expect(result.packageHash).toBe('abc123');
      expect(result.prUrl).toBeNull();
    });

    it('returns success result when packaging and publishing succeed', async () => {
      mockedPackageWave.mockResolvedValue({
        manifest: {} as any,
        files: [],
        scanResult: { passed: true, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } },
        sandboxResult: null,
        packageHash: 'hash-abc',
        totalSizeBytes: 200,
      });

      mockedPublishToRegistry.mockResolvedValue({
        prUrl: 'https://github.com/lildude-community/wave-registry/pull/42',
        prNumber: 42,
        branch: 'wave/test-wave-1.0.0',
      });

      const proposal = makeProposal({ name: 'publish-ok-wave' });
      const result = await publishShorebreakWave(manager.db, proposal, defaultOptions);

      expect(result.success).toBe(true);
      expect(result.prUrl).toBe('https://github.com/lildude-community/wave-registry/pull/42');
      expect(result.prNumber).toBe(42);
      expect(result.branch).toBe('wave/test-wave-1.0.0');
      expect(result.packageHash).toBe('hash-abc');
      expect(result.error).toBeNull();
    });

    it('returns error result when publishToRegistry throws', async () => {
      mockedPackageWave.mockResolvedValue({
        manifest: {} as any,
        files: [],
        scanResult: { passed: true, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } },
        sandboxResult: null,
        packageHash: 'hash-xyz',
        totalSizeBytes: 300,
      });

      mockedPublishToRegistry.mockRejectedValue(new Error('GitHub API rate limited'));

      const proposal = makeProposal({ name: 'registry-fail-wave' });
      const result = await publishShorebreakWave(manager.db, proposal, defaultOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('GitHub API rate limited');
    });
  });

  // === ShorebreakPublishResult shape ===

  describe('ShorebreakPublishResult shape', () => {
    it('success result has all expected fields', async () => {
      mockedPackageWave.mockResolvedValue({
        manifest: {} as any,
        files: [],
        scanResult: { passed: true, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } },
        sandboxResult: null,
        packageHash: 'shape-hash',
        totalSizeBytes: 100,
      });

      mockedPublishToRegistry.mockResolvedValue({
        prUrl: 'https://github.com/org/repo/pull/1',
        prNumber: 1,
        branch: 'wave/shape-test-1.0.0',
      });

      const result: ShorebreakPublishResult = await publishShorebreakWave(
        manager.db,
        makeProposal({ name: 'shape-wave' }),
        { githubToken: 'ghp_shape' },
      );

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('prUrl');
      expect(result).toHaveProperty('prNumber');
      expect(result).toHaveProperty('branch');
      expect(result).toHaveProperty('packageHash');
      expect(result).toHaveProperty('error');
    });

    it('error result sets success to false and error to a string', async () => {
      mockedPackageWave.mockRejectedValue(new Error('Boom'));

      const result: ShorebreakPublishResult = await publishShorebreakWave(
        manager.db,
        makeProposal({ name: 'err-shape-wave' }),
        { githubToken: 'ghp_err' },
      );

      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.prUrl).toBeNull();
      expect(result.prNumber).toBeNull();
    });
  });

  // === ShorebreakPublishOptions ===

  describe('ShorebreakPublishOptions', () => {
    it('requires githubToken for publishing', async () => {
      // This is a compile-time check, but we verify at runtime that the
      // token flows through by ensuring publishToRegistry receives it.
      mockedPackageWave.mockResolvedValue({
        manifest: {} as any,
        files: [],
        scanResult: { passed: true, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } },
        sandboxResult: null,
        packageHash: 'tok-hash',
        totalSizeBytes: 50,
      });

      mockedPublishToRegistry.mockResolvedValue({
        prUrl: 'https://github.com/org/repo/pull/99',
        prNumber: 99,
        branch: 'wave/token-test-1.0.0',
      });

      const options: ShorebreakPublishOptions = {
        githubToken: 'ghp_mytoken',
        registryRepo: 'custom-org/custom-registry',
      };

      await publishShorebreakWave(manager.db, makeProposal({ name: 'token-wave' }), options);

      expect(mockedPublishToRegistry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          githubToken: 'ghp_mytoken',
          registryRepo: 'custom-org/custom-registry',
        }),
      );
    });
  });
});
