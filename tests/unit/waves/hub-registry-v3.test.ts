/**
 * Tests for v3 registry format parsing in hub-registry.ts.
 * Covers detectRegistryVersion() and parseRegistryPayload() for the v3
 * format which adds generatedAt, typed category definitions, and per-wave
 * community trust metadata (publishedAt, packageHash, communityTrust, etc.).
 */

import { describe, it, expect } from 'vitest';
import { parseRegistryPayload, detectRegistryVersion } from '../../../src/waves/hub-registry.js';
import type { WaveRegistryEntry } from '../../../src/waves/hub-helpers.js';

/** Helper to build a minimal valid wave entry for tests. */
function makeWave(overrides: Partial<WaveRegistryEntry> & { name: string }): WaveRegistryEntry {
  return {
    description: `${overrides.name} description`,
    author: 'test-author',
    source: `github:test/${overrides.name}`,
    triggers: [overrides.name],
    version: '1.0.0',
    ...overrides,
  };
}

describe('detectRegistryVersion', () => {
  it('returns 1 for a v1 format payload (version + waves only)', () => {
    const payload = {
      version: '1.0.0',
      waves: [makeWave({ name: 'alpha' })],
    };

    expect(detectRegistryVersion(payload)).toBe(1);
  });

  it('returns 2 for a v2 format payload (has featured array)', () => {
    const payload = {
      version: '2.0.0',
      featured: ['alpha'],
      waves: [makeWave({ name: 'alpha' })],
    };

    expect(detectRegistryVersion(payload)).toBe(2);
  });

  it('returns 2 for a payload with categories but no generatedAt', () => {
    const payload = {
      version: '2.1.0',
      categories: ['utilities', 'productivity'],
      waves: [makeWave({ name: 'alpha' })],
    };

    expect(detectRegistryVersion(payload)).toBe(2);
  });

  it('returns 3 for a v3 format payload (has generatedAt and version 3.x)', () => {
    const payload = {
      version: '3.0.0',
      generatedAt: '2026-03-01T00:00:00Z',
      categories: [{ name: 'utilities', displayName: 'Utilities', description: 'Utility waves' }],
      featured: ['alpha'],
      waves: [makeWave({ name: 'alpha' })],
    };

    expect(detectRegistryVersion(payload)).toBe(3);
  });

  it('returns 3 for version "3.1.0" with generatedAt (minor version bump)', () => {
    const payload = {
      version: '3.1.0',
      generatedAt: '2026-03-04T12:00:00Z',
      categories: [],
      featured: [],
      waves: [],
    };

    expect(detectRegistryVersion(payload)).toBe(3);
  });
});

describe('parseRegistryPayload — v3 format', () => {
  it('handles v1 format and returns waves as-is (no enrichment)', () => {
    const wave = makeWave({ name: 'basic-v1' });
    const payload = { version: '1.0.0', waves: [wave] };

    const result = parseRegistryPayload(payload);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(wave);
    // v1 waves should not gain a featured property
    expect(result[0].featured).toBeUndefined();
  });

  it('handles v2 format and merges featured flags onto waves', () => {
    const payload = {
      version: '2.0.0',
      featured: ['wave-b'],
      waves: [
        makeWave({ name: 'wave-a' }),
        makeWave({ name: 'wave-b' }),
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result[0].featured).toBe(false);
    expect(result[1].featured).toBe(true);
  });

  it('handles v3 format and preserves all v3-specific fields', () => {
    const payload = {
      version: '3.0.0',
      generatedAt: '2026-03-01T00:00:00Z',
      categories: [{ name: 'dev', displayName: 'Developer', description: 'Dev tools' }],
      featured: ['scanner'],
      waves: [
        makeWave({
          name: 'scanner',
          publishedAt: '2026-02-15T10:00:00Z',
          updatedAt: '2026-02-28T14:00:00Z',
          packageHash: 'sha256:abc123def456',
          communityTrust: 85,
          scanPassed: true,
          sandboxPassed: true,
          dependencies: ['core-lib'],
          minLilDudeVersion: '0.9.0',
          repositoryUrl: 'https://github.com/test/scanner',
          license: 'MIT',
          screenshots: ['https://example.com/screenshot1.png'],
        }),
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('scanner');
    expect(result[0].publishedAt).toBe('2026-02-15T10:00:00Z');
    expect(result[0].updatedAt).toBe('2026-02-28T14:00:00Z');
    expect(result[0].packageHash).toBe('sha256:abc123def456');
    expect(result[0].communityTrust).toBe(85);
    expect(result[0].scanPassed).toBe(true);
    expect(result[0].sandboxPassed).toBe(true);
    expect(result[0].dependencies).toEqual(['core-lib']);
    expect(result[0].minLilDudeVersion).toBe('0.9.0');
    expect(result[0].repositoryUrl).toBe('https://github.com/test/scanner');
    expect(result[0].license).toBe('MIT');
    expect(result[0].screenshots).toEqual(['https://example.com/screenshot1.png']);
  });

  it('preserves publishedAt, updatedAt, and packageHash on v3 entries', () => {
    const payload = {
      version: '3.0.0',
      generatedAt: '2026-03-01T00:00:00Z',
      categories: [],
      featured: [],
      waves: [
        makeWave({
          name: 'timestamped',
          publishedAt: '2025-12-01T08:30:00Z',
          updatedAt: '2026-01-15T16:45:00Z',
          packageHash: 'sha256:deadbeef',
        }),
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result[0].publishedAt).toBe('2025-12-01T08:30:00Z');
    expect(result[0].updatedAt).toBe('2026-01-15T16:45:00Z');
    expect(result[0].packageHash).toBe('sha256:deadbeef');
  });

  it('preserves communityTrust scores across multiple waves', () => {
    const payload = {
      version: '3.0.0',
      generatedAt: '2026-03-01T00:00:00Z',
      categories: [],
      featured: [],
      waves: [
        makeWave({ name: 'trusted-wave', communityTrust: 92 }),
        makeWave({ name: 'mid-trust-wave', communityTrust: 55 }),
        makeWave({ name: 'new-wave', communityTrust: 10 }),
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result[0].communityTrust).toBe(92);
    expect(result[1].communityTrust).toBe(55);
    expect(result[2].communityTrust).toBe(10);
  });

  it('preserves scanPassed and sandboxPassed booleans', () => {
    const payload = {
      version: '3.0.0',
      generatedAt: '2026-03-01T00:00:00Z',
      categories: [],
      featured: [],
      waves: [
        makeWave({ name: 'fully-scanned', scanPassed: true, sandboxPassed: true }),
        makeWave({ name: 'scan-failed', scanPassed: false, sandboxPassed: false }),
        makeWave({ name: 'partial', scanPassed: true, sandboxPassed: false }),
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result[0].scanPassed).toBe(true);
    expect(result[0].sandboxPassed).toBe(true);
    expect(result[1].scanPassed).toBe(false);
    expect(result[1].sandboxPassed).toBe(false);
    expect(result[2].scanPassed).toBe(true);
    expect(result[2].sandboxPassed).toBe(false);
  });

  it('marks waves as featured from the v3 top-level featured array', () => {
    const payload = {
      version: '3.0.0',
      generatedAt: '2026-03-01T00:00:00Z',
      categories: [{ name: 'tools', displayName: 'Tools', description: 'Tool waves' }],
      featured: ['wave-alpha', 'wave-gamma'],
      waves: [
        makeWave({ name: 'wave-alpha' }),
        makeWave({ name: 'wave-beta' }),
        makeWave({ name: 'wave-gamma' }),
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result[0].featured).toBe(true);
    expect(result[1].featured).toBe(false);
    expect(result[2].featured).toBe(true);
  });

  it('throws on a payload missing the waves array', () => {
    const payload = {
      version: '3.0.0',
      generatedAt: '2026-03-01T00:00:00Z',
      categories: [],
      featured: [],
    } as unknown as { version: string; waves: never[] };

    expect(() => parseRegistryPayload(payload)).toThrow('Invalid registry format: missing waves array');
  });

  it('handles v3 with an empty waves array', () => {
    const payload = {
      version: '3.0.0',
      generatedAt: '2026-03-01T00:00:00Z',
      categories: [{ name: 'empty-cat', displayName: 'Empty', description: 'No waves here' }],
      featured: ['nonexistent-wave'],
      waves: [],
    };

    const result = parseRegistryPayload(payload);
    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it('works when v3-specific fields are absent from individual wave entries (backward compat)', () => {
    const payload = {
      version: '3.0.0',
      generatedAt: '2026-03-01T00:00:00Z',
      categories: [],
      featured: [],
      waves: [
        makeWave({ name: 'minimal-v3-wave' }),
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('minimal-v3-wave');
    // v3-specific fields should be undefined but not cause errors
    expect(result[0].publishedAt).toBeUndefined();
    expect(result[0].packageHash).toBeUndefined();
    expect(result[0].communityTrust).toBeUndefined();
    expect(result[0].scanPassed).toBeUndefined();
    expect(result[0].sandboxPassed).toBeUndefined();
  });

  it('preserves wave-level featured=true even when not in the v3 featured array', () => {
    const payload = {
      version: '3.0.0',
      generatedAt: '2026-03-01T00:00:00Z',
      categories: [],
      featured: [],
      waves: [
        makeWave({ name: 'self-featured', featured: true, communityTrust: 90 }),
      ],
    };

    const result = parseRegistryPayload(payload);
    expect(result[0].featured).toBe(true);
    expect(result[0].communityTrust).toBe(90);
  });
});
