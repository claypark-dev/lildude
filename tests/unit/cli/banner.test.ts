import { describe, it, expect } from 'vitest';
import { getAsciiBanner, getVersionString, getVersion } from '../../../src/cli/banner.js';

describe('banner', () => {
  describe('getAsciiBanner', () => {
    it('returns a non-empty string', () => {
      const banner = getAsciiBanner();
      expect(banner).toBeTruthy();
      expect(banner.length).toBeGreaterThan(0);
    });

    it('contains ASCII art characters', () => {
      const banner = getAsciiBanner();
      // The ASCII art uses pipe, underscore, and backslash characters
      expect(banner).toContain('|');
      expect(banner).toContain('_');
      expect(banner).toContain('\\');
    });

    it('contains the tagline', () => {
      const banner = getAsciiBanner();
      expect(banner).toContain('Your personal AI executive assistant');
    });

    it('is multi-line', () => {
      const banner = getAsciiBanner();
      const lines = banner.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('getVersionString', () => {
    it('returns a string starting with lil-dude', () => {
      const version = getVersionString();
      expect(version).toMatch(/^lil-dude v\d+\.\d+\.\d+$/);
    });

    it('contains the version number', () => {
      const version = getVersionString();
      expect(version).toContain(getVersion());
    });
  });

  describe('getVersion', () => {
    it('returns a semantic version string', () => {
      const version = getVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
