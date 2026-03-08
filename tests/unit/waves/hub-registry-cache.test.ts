/**
 * Tests for the in-memory registry cache and request coalescing
 * added to hub-registry.ts in Sprint 19.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  fetchRegistry,
  clearRegistryMemoryCache,
  parseRegistryPayload,
  isNewerVersion,
} from '../../../src/waves/hub-registry.js';

// Mock the persistence layer so we don't need real SQLite
vi.mock('../../../src/persistence/wave-hub-cache.js', () => ({
  getCachedRegistry: vi.fn(),
  setCachedRegistry: vi.fn(),
  getCachedEtag: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../src/waves/hub.js', () => ({
  listWaves: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { getCachedRegistry } from '../../../src/persistence/wave-hub-cache.js';

const mockGetCachedRegistry = vi.mocked(getCachedRegistry);

/** Create a minimal fake DB object. */
function createFakeDb() {
  return {} as Parameters<typeof fetchRegistry>[0];
}

describe('hub-registry memory cache', () => {
  beforeEach(() => {
    clearRegistryMemoryCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearRegistryMemoryCache();
  });

  describe('clearRegistryMemoryCache', () => {
    it('clears the in-memory cache', async () => {
      const db = createFakeDb();

      // First call misses SQLite cache → remote fails → returns empty list
      mockGetCachedRegistry.mockReturnValue(null);
      const firstResult = await fetchRegistry(db);
      expect(firstResult.length).toBe(0);

      // Second call should use memory cache (no SQLite read)
      mockGetCachedRegistry.mockClear();
      const cachedResult = await fetchRegistry(db);
      expect(cachedResult).toEqual(firstResult);
      // getCachedRegistry should NOT be called because memory cache is hit
      expect(mockGetCachedRegistry).not.toHaveBeenCalled();

      // Clear the cache
      clearRegistryMemoryCache();

      // Third call should miss memory cache and hit SQLite again
      mockGetCachedRegistry.mockReturnValue(null);
      await fetchRegistry(db);
      expect(mockGetCachedRegistry).toHaveBeenCalled();
    });
  });

  describe('in-memory cache behavior', () => {
    it('avoids repeated SQLite reads within the cache window', async () => {
      const db = createFakeDb();
      mockGetCachedRegistry.mockReturnValue(null);

      // First call: misses memory, hits SQLite
      await fetchRegistry(db);
      expect(mockGetCachedRegistry).toHaveBeenCalledTimes(1);

      // Reset mock counter
      mockGetCachedRegistry.mockClear();

      // Second call: should hit memory cache — no SQLite read
      await fetchRegistry(db);
      expect(mockGetCachedRegistry).not.toHaveBeenCalled();

      // Third call: still from memory cache
      await fetchRegistry(db);
      expect(mockGetCachedRegistry).not.toHaveBeenCalled();
    });

    it('returns consistent data from memory cache', async () => {
      const db = createFakeDb();
      mockGetCachedRegistry.mockReturnValue(null);

      const first = await fetchRegistry(db);
      const second = await fetchRegistry(db);
      const third = await fetchRegistry(db);

      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });
  });

  describe('request coalescing', () => {
    it('coalesces concurrent calls into a single fetch', async () => {
      const db = createFakeDb();
      mockGetCachedRegistry.mockReturnValue(null);
      clearRegistryMemoryCache();

      // Fire 5 concurrent requests
      const promises = Array.from({ length: 5 }, () => fetchRegistry(db));
      const results = await Promise.all(promises);

      // All should return the same data
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toEqual(results[0]);
      }

      // SQLite cache should only have been consulted once (the first request)
      // Others should coalesce on the pending promise
      expect(mockGetCachedRegistry.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('SQLite cache hit path', () => {
    it('uses SQLite cached data when available', async () => {
      const db = createFakeDb();
      const fakeRegistryData = JSON.stringify({
        version: '1.0.0',
        waves: [
          {
            name: 'cached-wave',
            description: 'From SQLite cache',
            author: 'test',
            source: 'github:test/cached',
            triggers: ['cached'],
            version: '1.0.0',
          },
        ],
      });

      mockGetCachedRegistry.mockReturnValue({
        data: fakeRegistryData,
        url: 'https://example.com/registry.json',
        fetchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        etag: null,
      });

      const result = await fetchRegistry(db);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('cached-wave');
    });
  });
});

describe('parseRegistryPayload', () => {
  it('parses v1 format (just waves array)', () => {
    const payload = {
      version: '1.0.0',
      waves: [
        { name: 'wave-a', description: 'A', author: 'test', source: 'github:t/a', triggers: ['a'], version: '1.0.0' },
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('wave-a');
  });

  it('parses v2 format and marks featured waves', () => {
    const payload = {
      version: '2.0.0',
      featured: ['wave-b'],
      categories: ['utilities'],
      waves: [
        { name: 'wave-a', description: 'A', author: 'test', source: 'github:t/a', triggers: ['a'], version: '1.0.0' },
        { name: 'wave-b', description: 'B', author: 'test', source: 'github:t/b', triggers: ['b'], version: '1.0.0' },
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result).toHaveLength(2);
    expect(result[0].featured).toBeFalsy();
    expect(result[1].featured).toBe(true);
  });

  it('throws on invalid payload (missing waves)', () => {
    expect(() => parseRegistryPayload({ version: '1.0.0' } as never)).toThrow(
      'Invalid registry format',
    );
  });

  it('preserves existing featured flag in v2 format', () => {
    const payload = {
      version: '2.0.0',
      featured: [],
      waves: [
        { name: 'already-featured', description: 'A', author: 'test', source: 'github:t/a', triggers: ['a'], version: '1.0.0', featured: true },
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result[0].featured).toBe(true);
  });
});

describe('isNewerVersion', () => {
  it('detects newer major version', () => {
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true);
  });

  it('detects newer minor version', () => {
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
  });

  it('detects newer patch version', () => {
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
  });

  it('returns false for same version', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns false for older version', () => {
    expect(isNewerVersion('2.0.0', '1.0.0')).toBe(false);
  });

  it('handles v prefix', () => {
    expect(isNewerVersion('v1.0.0', 'v1.1.0')).toBe(true);
  });

  it('handles different length versions', () => {
    expect(isNewerVersion('1.0', '1.0.1')).toBe(true);
  });
});
