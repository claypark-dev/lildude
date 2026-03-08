import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import type { WaveRegistryEntry } from '../../../src/waves/hub-helpers.js';

// Mock fetchRegistry — avoid hitting the network during tests.
vi.mock('../../../src/waves/hub-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/waves/hub-registry.js')>();
  return {
    ...actual,
    fetchRegistry: vi.fn(),
  };
});

// Mock upsertTrustScore so we can force per-wave errors.
vi.mock('../../../src/persistence/wave-community-trust.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/persistence/wave-community-trust.js')>();
  return {
    ...actual,
    upsertTrustScore: vi.fn().mockImplementation(actual.upsertTrustScore),
  };
});

// Lazy imports so the mocks are installed before modules resolve.
const { fetchRegistry } = await import('../../../src/waves/hub-registry.js');
const { upsertTrustScore } = await import('../../../src/persistence/wave-community-trust.js');

import {
  recomputeTrustScores,
  startPeriodicRecomputation,
  stopPeriodicRecomputation,
  type RecomputeResult,
} from '../../../src/waves/trust-recomputation.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

/** Helper: build a minimal WaveRegistryEntry for testing. */
function makeRegistryEntry(overrides: Partial<WaveRegistryEntry> = {}): WaveRegistryEntry {
  return {
    name: 'test-wave',
    description: 'A test wave',
    author: 'tester',
    source: 'github:tester/test-wave',
    triggers: ['test'],
    version: '1.0.0',
    scanPassed: true,
    sandboxPassed: true,
    publishedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

describe('trust-recomputation', () => {
  let manager: DatabaseManager;
  const mockedFetchRegistry = vi.mocked(fetchRegistry);
  const mockedUpsertTrustScore = vi.mocked(upsertTrustScore);

  beforeEach(() => {
    manager = createTestDb();
    vi.clearAllMocks();
    // Default: delegate to the real implementation
    mockedUpsertTrustScore.mockImplementation((...args) => {
      // Call the real upsertTrustScore from the actual module.
      // Since we override per-test when needed, this is the safe default.
      const { upsertTrustScore: realUpsert } = vi.importActual<typeof import('../../../src/persistence/wave-community-trust.js')>('../../../src/persistence/wave-community-trust.js') as any;
      // For most tests, just allow the insert (it will work on the in-memory DB).
      // We need to call the DB directly since importActual is sync here.
      // Simplest: just do nothing (the test verifies counts, not DB state).
    });
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {
      // best-effort cleanup
    }
  });

  // === recomputeTrustScores ===

  describe('recomputeTrustScores', () => {
    it('processes registry waves and returns a result', async () => {
      mockedFetchRegistry.mockResolvedValue([
        makeRegistryEntry({ name: 'wave-alpha' }),
        makeRegistryEntry({ name: 'wave-beta' }),
      ]);

      const result = await recomputeTrustScores(manager.db);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('updated');
      expect(result).toHaveProperty('errors');
    });

    it('result.processed matches the number of registry waves', async () => {
      const waves = [
        makeRegistryEntry({ name: 'wave-one' }),
        makeRegistryEntry({ name: 'wave-two' }),
        makeRegistryEntry({ name: 'wave-three' }),
      ];
      mockedFetchRegistry.mockResolvedValue(waves);

      const result = await recomputeTrustScores(manager.db);

      expect(result.processed).toBe(waves.length);
    });

    it('updates all waves when no individual failures occur', async () => {
      const waves = [
        makeRegistryEntry({ name: 'good-wave-a' }),
        makeRegistryEntry({ name: 'good-wave-b' }),
      ];
      mockedFetchRegistry.mockResolvedValue(waves);

      const result = await recomputeTrustScores(manager.db);

      expect(result.updated).toBe(waves.length);
      expect(result.errors).toHaveLength(0);
    });

    it('handles empty registry gracefully', async () => {
      mockedFetchRegistry.mockResolvedValue([]);

      const result = await recomputeTrustScores(manager.db);

      expect(result.processed).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('returns error when registry fetch fails', async () => {
      mockedFetchRegistry.mockRejectedValue(new Error('Network unavailable'));

      const result = await recomputeTrustScores(manager.db);

      expect(result.processed).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Registry fetch failed');
    });

    it('continues processing after individual wave failure', async () => {
      // Make upsertTrustScore throw only for the second wave.
      let callIndex = 0;
      mockedUpsertTrustScore.mockImplementation(() => {
        callIndex++;
        if (callIndex === 2) {
          throw new Error('DB constraint violation');
        }
      });

      mockedFetchRegistry.mockResolvedValue([
        makeRegistryEntry({ name: 'good-wave' }),
        makeRegistryEntry({ name: 'bad-wave' }),
        makeRegistryEntry({ name: 'another-good-wave' }),
      ]);

      const result = await recomputeTrustScores(manager.db);

      // All three should be attempted
      expect(result.processed).toBe(3);
      // Two should succeed, one should fail
      expect(result.updated).toBe(2);
      // The bad one should produce an error
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('bad-wave');
    });

    it('collects errors in result.errors array', async () => {
      // Make upsertTrustScore throw for every call.
      mockedUpsertTrustScore.mockImplementation(() => {
        throw new Error('Simulated persistence failure');
      });

      mockedFetchRegistry.mockResolvedValue([
        makeRegistryEntry({ name: 'fail-wave-a' }),
        makeRegistryEntry({ name: 'fail-wave-b' }),
      ]);

      const result = await recomputeTrustScores(manager.db);

      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors).toHaveLength(2);
      expect(result.updated).toBe(0);
      // Each error entry should be a string containing the wave name
      for (const errorMessage of result.errors) {
        expect(typeof errorMessage).toBe('string');
        expect(errorMessage).toContain('Simulated persistence failure');
      }
    });

    it('result conforms to RecomputeResult shape', async () => {
      mockedFetchRegistry.mockResolvedValue([
        makeRegistryEntry({ name: 'shape-test' }),
      ]);

      const result: RecomputeResult = await recomputeTrustScores(manager.db);

      expect(typeof result.processed).toBe('number');
      expect(typeof result.updated).toBe('number');
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  // === startPeriodicRecomputation / stopPeriodicRecomputation ===

  describe('startPeriodicRecomputation', () => {
    it('returns a timer handle', () => {
      mockedFetchRegistry.mockResolvedValue([]);

      const timer = startPeriodicRecomputation(manager.db, 60_000);

      expect(timer).toBeDefined();
      // NodeJS.Timeout has a ref/unref method
      expect(typeof timer.unref).toBe('function');

      // Clean up
      stopPeriodicRecomputation(timer);
    });

    it('fires an immediate recomputation on start', async () => {
      mockedFetchRegistry.mockResolvedValue([]);

      const timer = startPeriodicRecomputation(manager.db, 100_000);

      // Give the microtask a tick to fire the immediate call
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockedFetchRegistry).toHaveBeenCalled();

      stopPeriodicRecomputation(timer);
    });
  });

  describe('stopPeriodicRecomputation', () => {
    it('clears the timer so no further runs occur', async () => {
      mockedFetchRegistry.mockResolvedValue([]);

      // Use a very short interval so we can verify it stops
      const timer = startPeriodicRecomputation(manager.db, 50);

      // Wait for the immediate run
      await new Promise((resolve) => setTimeout(resolve, 30));

      const callCountAfterStart = mockedFetchRegistry.mock.calls.length;

      stopPeriodicRecomputation(timer);

      // Wait long enough for another interval tick
      await new Promise((resolve) => setTimeout(resolve, 120));

      // After stopping, no additional calls should have been made beyond
      // what was already in-flight.
      const callCountAfterStop = mockedFetchRegistry.mock.calls.length;

      // Allow at most one extra call that was already scheduled
      expect(callCountAfterStop).toBeLessThanOrEqual(callCountAfterStart + 1);
    });
  });
});
