/**
 * Tests for wave manifest category field.
 * Verifies the category field is correctly handled in schema validation,
 * bundled wave manifests, and directory scanning.
 */

import { describe, it, expect } from 'vitest';
import { validateManifest } from '../../../src/waves/schema.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BUNDLED_WAVES_DIR = resolve('waves/bundled');

/** Create a minimal valid manifest for testing. */
function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'test-wave',
    version: '1.0.0',
    description: 'A test wave',
    author: 'test',
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

describe('wave manifest category field', () => {
  describe('schema validation', () => {
    it('accepts manifest with category field', () => {
      const result = validateManifest(baseManifest({ category: 'productivity' }));
      expect(result.valid).toBe(true);
      expect(result.manifest!.category).toBe('productivity');
    });

    it('accepts manifest without category field (optional)', () => {
      const result = validateManifest(baseManifest());
      expect(result.valid).toBe(true);
      expect(result.manifest!.category).toBeUndefined();
    });

    it('accepts any string for category', () => {
      const result = validateManifest(baseManifest({ category: 'custom-category-123' }));
      expect(result.valid).toBe(true);
      expect(result.manifest!.category).toBe('custom-category-123');
    });

    it('rejects non-string category values', () => {
      const result = validateManifest(baseManifest({ category: 42 }));
      expect(result.valid).toBe(false);
    });

    it('coexists with waveCategory field', () => {
      const result = validateManifest(baseManifest({
        category: 'communication',
        waveCategory: 'party',
      }));
      expect(result.valid).toBe(true);
      expect(result.manifest!.category).toBe('communication');
      expect(result.manifest!.waveCategory).toBe('party');
    });
  });

  describe('bundled wave manifests', () => {
    const EXPECTED_CATEGORIES: Record<string, string> = {
      'email-reader': 'communication',
      'email-sender': 'communication',
      'google-calendar': 'productivity',
      'google-flights': 'utilities',
      'reminders': 'productivity',
      'stock-monitor': 'finance',
      'web-search': 'utilities',
      'auto-responder': 'party',
      'availability-check': 'party',
      'contact-share': 'party',
      'meeting-request': 'party',
      'message-relay': 'party',
      'task-delegation': 'party',
      'faq-responder': 'party',
      'event-rsvp': 'party',
      'document-request': 'party',
    };

    it('all bundled waves have a category field', () => {
      const waveDirs = readdirSync(BUNDLED_WAVES_DIR);

      for (const dir of waveDirs) {
        const manifestPath = join(BUNDLED_WAVES_DIR, dir, 'wave.json');
        if (!existsSync(manifestPath)) continue;

        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        expect(raw.category, `Wave "${dir}" is missing a category field`).toBeDefined();
        expect(typeof raw.category, `Wave "${dir}" category should be a string`).toBe('string');
      }
    });

    for (const [waveName, expectedCategory] of Object.entries(EXPECTED_CATEGORIES)) {
      it(`${waveName} has category "${expectedCategory}"`, () => {
        const manifestPath = join(BUNDLED_WAVES_DIR, waveName, 'wave.json');
        if (!existsSync(manifestPath)) {
          // Skip if wave doesn't exist yet (stub)
          return;
        }

        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        expect(raw.category).toBe(expectedCategory);
      });
    }

    it('all bundled wave manifests pass schema validation with category', () => {
      const waveDirs = readdirSync(BUNDLED_WAVES_DIR);

      for (const dir of waveDirs) {
        const manifestPath = join(BUNDLED_WAVES_DIR, dir, 'wave.json');
        if (!existsSync(manifestPath)) continue;

        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const result = validateManifest(raw);
        expect(result.valid, `Wave "${dir}" failed validation: ${result.errors?.join(', ')}`).toBe(true);
      }
    });

    it('party waves have both waveCategory=party and category=party', () => {
      const partyWaves = Object.entries(EXPECTED_CATEGORIES)
        .filter(([, cat]) => cat === 'party')
        .map(([name]) => name);

      for (const waveName of partyWaves) {
        const manifestPath = join(BUNDLED_WAVES_DIR, waveName, 'wave.json');
        if (!existsSync(manifestPath)) continue;

        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        expect(raw.waveCategory, `Party wave "${waveName}" missing waveCategory`).toBe('party');
        expect(raw.category, `Party wave "${waveName}" missing category`).toBe('party');
      }
    });
  });
});
