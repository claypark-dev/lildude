import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  featureWave,
  unfeatureWave,
  getFeaturedWaves,
  isWaveFeatured,
} from '../../../src/persistence/featured-waves.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '003_waves_foundation.sql',
    '007_wave_hub.sql',
    '014_waves_hub_enhanced.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('featured-waves DAL', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('featureWave', () => {
    it('adds a wave to the featured list', () => {
      featureWave(db, 'weather-checker');

      expect(isWaveFeatured(db, 'weather-checker')).toBe(true);
    });

    it('includes the reason when provided', () => {
      featureWave(db, 'email-reader', 'Editor choice');

      const featured = getFeaturedWaves(db);
      const entry = featured.find((f) => f.waveName === 'email-reader');
      expect(entry).not.toBeUndefined();
      expect(entry!.reason).toBe('Editor choice');
    });

    it('stores null reason when reason is not provided', () => {
      featureWave(db, 'code-reviewer');

      const featured = getFeaturedWaves(db);
      const entry = featured.find((f) => f.waveName === 'code-reviewer');
      expect(entry).not.toBeUndefined();
      expect(entry!.reason).toBeNull();
    });

    it('replaces the existing entry when featuring an already-featured wave', () => {
      featureWave(db, 'my-wave', 'First reason');
      featureWave(db, 'my-wave', 'Updated reason');

      const featured = getFeaturedWaves(db);
      const entries = featured.filter((f) => f.waveName === 'my-wave');
      expect(entries).toHaveLength(1);
      expect(entries[0].reason).toBe('Updated reason');
    });
  });

  describe('unfeatureWave', () => {
    it('removes a wave from the featured list', () => {
      featureWave(db, 'to-remove');
      expect(isWaveFeatured(db, 'to-remove')).toBe(true);

      unfeatureWave(db, 'to-remove');
      expect(isWaveFeatured(db, 'to-remove')).toBe(false);
    });

    it('does not throw when unfeaturing a wave that was never featured', () => {
      expect(() => unfeatureWave(db, 'never-featured')).not.toThrow();
    });
  });

  describe('getFeaturedWaves', () => {
    it('returns all currently featured waves', () => {
      featureWave(db, 'wave-one');
      featureWave(db, 'wave-two');
      featureWave(db, 'wave-three');

      const featured = getFeaturedWaves(db);
      expect(featured).toHaveLength(3);
    });

    it('returns an empty array when no waves are featured', () => {
      const featured = getFeaturedWaves(db);
      expect(featured).toHaveLength(0);
    });

    it('maps rows to camelCase application objects with Date fields', () => {
      featureWave(db, 'mapped-wave', 'Test');

      const featured = getFeaturedWaves(db);
      const entry = featured[0];

      expect(entry).toHaveProperty('waveName');
      expect(entry).toHaveProperty('featuredAt');
      expect(entry).toHaveProperty('reason');
      expect(entry.featuredAt).toBeInstanceOf(Date);
    });

    it('does not return a wave that was subsequently unfeatured', () => {
      featureWave(db, 'keep-wave');
      featureWave(db, 'remove-wave');
      unfeatureWave(db, 'remove-wave');

      const featured = getFeaturedWaves(db);
      expect(featured).toHaveLength(1);
      expect(featured[0].waveName).toBe('keep-wave');
    });
  });

  describe('isWaveFeatured', () => {
    it('returns true for a featured wave', () => {
      featureWave(db, 'featured-wave');
      expect(isWaveFeatured(db, 'featured-wave')).toBe(true);
    });

    it('returns false for a wave that has never been featured', () => {
      expect(isWaveFeatured(db, 'not-featured-wave')).toBe(false);
    });

    it('returns false after a wave is unfeatured', () => {
      featureWave(db, 'was-featured');
      unfeatureWave(db, 'was-featured');

      expect(isWaveFeatured(db, 'was-featured')).toBe(false);
    });
  });
});
