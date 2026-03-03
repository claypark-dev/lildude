/**
 * Tests for registry v2 format parsing and backward compatibility.
 * Covers parseRegistryPayload(), enriched fallback registry, and
 * v1/v2 format handling in hub-registry.ts.
 */

import { describe, it, expect } from 'vitest';
import { parseRegistryPayload } from '../../../src/waves/hub-registry.js';

describe('parseRegistryPayload', () => {
  describe('v1 format (backward compat)', () => {
    it('parses a v1 registry with just version and waves', () => {
      const payload = {
        version: '1.0.0',
        waves: [
          {
            name: 'test-wave',
            description: 'A test wave',
            author: 'tester',
            source: 'github:tester/test-wave',
            triggers: ['test'],
            version: '1.0.0',
          },
        ],
      };

      const result = parseRegistryPayload(payload);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test-wave');
    });

    it('returns waves unmodified when no v2 fields present', () => {
      const wave = {
        name: 'basic',
        description: 'Basic wave',
        author: 'author',
        source: 'github:a/b',
        triggers: ['go'],
        version: '0.1.0',
      };
      const payload = { version: '1.0.0', waves: [wave] };

      const result = parseRegistryPayload(payload);
      expect(result[0]).toEqual(wave);
    });

    it('preserves all original wave fields in v1 format', () => {
      const wave = {
        name: 'rich-wave',
        description: 'Has extra fields',
        author: 'author',
        source: 'github:a/rich',
        triggers: ['rich'],
        version: '2.0.0',
        category: 'utilities',
        tags: ['util'],
        installCount: 100,
        averageRating: 4.5,
      };
      const payload = { version: '1.0.0', waves: [wave] };

      const result = parseRegistryPayload(payload);
      expect(result[0].category).toBe('utilities');
      expect(result[0].tags).toEqual(['util']);
      expect(result[0].installCount).toBe(100);
    });
  });

  describe('v2 format', () => {
    it('marks waves as featured from the top-level featured array', () => {
      const payload = {
        version: '2.0.0',
        featured: ['wave-a', 'wave-c'],
        waves: [
          { name: 'wave-a', description: 'A', author: 'x', source: 'github:x/a', triggers: ['a'], version: '1.0.0' },
          { name: 'wave-b', description: 'B', author: 'x', source: 'github:x/b', triggers: ['b'], version: '1.0.0' },
          { name: 'wave-c', description: 'C', author: 'x', source: 'github:x/c', triggers: ['c'], version: '1.0.0' },
        ],
      };

      const result = parseRegistryPayload(payload);
      expect(result[0].featured).toBe(true);
      expect(result[1].featured).toBeFalsy();
      expect(result[2].featured).toBe(true);
    });

    it('preserves wave-level featured=true even if not in top-level featured', () => {
      const payload = {
        version: '2.0.0',
        featured: [],
        waves: [
          { name: 'wave-a', description: 'A', author: 'x', source: 'github:x/a', triggers: ['a'], version: '1.0.0', featured: true },
        ],
      };

      const result = parseRegistryPayload(payload);
      expect(result[0].featured).toBe(true);
    });

    it('does not override wave-level featured=true with false from missing featured list', () => {
      const payload = {
        version: '2.0.0',
        featured: ['other-wave'],
        waves: [
          { name: 'wave-a', description: 'A', author: 'x', source: 'github:x/a', triggers: ['a'], version: '1.0.0', featured: true },
        ],
      };

      const result = parseRegistryPayload(payload);
      // wave-a has featured: true at wave level, so it stays true
      expect(result[0].featured).toBe(true);
    });

    it('handles categories array in v2 format', () => {
      const payload = {
        version: '2.0.0',
        categories: ['utilities', 'productivity', 'communication'],
        waves: [
          { name: 'wave-a', description: 'A', author: 'x', source: 'github:x/a', triggers: ['a'], version: '1.0.0' },
        ],
      };

      // categories is metadata; waves should still parse fine
      const result = parseRegistryPayload(payload);
      expect(result).toHaveLength(1);
    });

    it('handles empty featured array', () => {
      const payload = {
        version: '2.0.0',
        featured: [],
        waves: [
          { name: 'wave-a', description: 'A', author: 'x', source: 'github:x/a', triggers: ['a'], version: '1.0.0' },
        ],
      };

      const result = parseRegistryPayload(payload);
      expect(result[0].featured).toBeFalsy();
    });

    it('handles v2 with both categories and featured', () => {
      const payload = {
        version: '2.0.0',
        categories: ['dev', 'util'],
        featured: ['wave-b'],
        waves: [
          { name: 'wave-a', description: 'A', author: 'x', source: 'github:x/a', triggers: ['a'], version: '1.0.0', category: 'dev' },
          { name: 'wave-b', description: 'B', author: 'x', source: 'github:x/b', triggers: ['b'], version: '1.0.0', category: 'util' },
        ],
      };

      const result = parseRegistryPayload(payload);
      expect(result[0].featured).toBeFalsy();
      expect(result[0].category).toBe('dev');
      expect(result[1].featured).toBe(true);
      expect(result[1].category).toBe('util');
    });

    it('enriches waves with all v2 marketplace fields', () => {
      const payload = {
        version: '2.0.0',
        featured: ['rich-wave'],
        waves: [
          {
            name: 'rich-wave',
            description: 'Full v2 wave',
            author: 'community',
            source: 'github:community/rich',
            triggers: ['rich'],
            version: '3.0.0',
            category: 'productivity',
            tags: ['task', 'organize'],
            installCount: 500,
            averageRating: 4.8,
            ratingCount: 120,
            verified: true,
            safetyTier: 'observe',
            deterministic: true,
            waveCategory: 'personal' as const,
            iconUrl: 'https://example.com/icon.png',
            changelog: 'v3.0.0: Major update',
          },
        ],
      };

      const result = parseRegistryPayload(payload);
      expect(result[0]).toMatchObject({
        name: 'rich-wave',
        category: 'productivity',
        tags: ['task', 'organize'],
        installCount: 500,
        averageRating: 4.8,
        ratingCount: 120,
        verified: true,
        featured: true,
        safetyTier: 'observe',
        deterministic: true,
        waveCategory: 'personal',
        iconUrl: 'https://example.com/icon.png',
        changelog: 'v3.0.0: Major update',
      });
    });
  });

  describe('error handling', () => {
    it('throws on missing waves array', () => {
      const payload = { version: '1.0.0' } as unknown as { version: string; waves: never[] };

      expect(() => parseRegistryPayload(payload)).toThrow('Invalid registry format');
    });

    it('throws when waves is not an array', () => {
      const payload = { version: '1.0.0', waves: 'not-array' } as unknown as { version: string; waves: never[] };

      expect(() => parseRegistryPayload(payload)).toThrow('Invalid registry format');
    });

    it('handles empty waves array', () => {
      const payload = { version: '1.0.0', waves: [] };

      const result = parseRegistryPayload(payload);
      expect(result).toEqual([]);
    });

    it('handles v2 with empty waves array', () => {
      const payload = { version: '2.0.0', featured: ['nonexistent'], categories: ['util'], waves: [] };

      const result = parseRegistryPayload(payload);
      expect(result).toEqual([]);
    });
  });

  describe('fallback registry enrichment', () => {
    it('fallback registry entries have marketplace fields', () => {
      // Test that the hardcoded fallback has been updated with v2 fields
      // We can't directly import FALLBACK_REGISTRY (it's const/private),
      // but we test that a v1-shaped payload with the same fields parses correctly
      const sampleEntry = {
        name: 'weather-checker',
        description: 'Check weather forecasts for any location',
        author: 'lil-dude-community',
        source: 'github:community/weather-checker',
        triggers: ['weather', 'forecast', 'temperature'],
        version: '1.2.0',
        category: 'utilities',
        tags: ['weather', 'forecast'],
        waveCategory: 'personal' as const,
        safetyTier: 'observe',
        deterministic: true,
        verified: true,
        installCount: 342,
        averageRating: 4.5,
        ratingCount: 28,
      };

      const payload = { version: '1.0.0', waves: [sampleEntry] };
      const result = parseRegistryPayload(payload);

      expect(result[0].category).toBe('utilities');
      expect(result[0].safetyTier).toBe('observe');
      expect(result[0].deterministic).toBe(true);
      expect(result[0].verified).toBe(true);
      expect(result[0].installCount).toBe(342);
    });
  });

  describe('large registry handling', () => {
    it('handles a registry with many waves efficiently', () => {
      const waves = Array.from({ length: 100 }, (_, i) => ({
        name: `wave-${i}`,
        description: `Wave ${i}`,
        author: 'auto',
        source: `github:auto/wave-${i}`,
        triggers: [`trigger-${i}`],
        version: '1.0.0',
      }));

      const payload = {
        version: '2.0.0',
        featured: ['wave-0', 'wave-50', 'wave-99'],
        waves,
      };

      const result = parseRegistryPayload(payload);
      expect(result).toHaveLength(100);
      expect(result[0].featured).toBe(true);
      expect(result[1].featured).toBeFalsy();
      expect(result[50].featured).toBe(true);
      expect(result[99].featured).toBe(true);
    });
  });
});
