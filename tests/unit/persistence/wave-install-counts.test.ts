import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  incrementInstallCount,
  getInstallCount,
  getTopInstalled,
  getInstallCountEntry,
} from '../../../src/persistence/wave-install-counts.js';

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

describe('wave-install-counts DAL', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('incrementInstallCount', () => {
    it('creates a new entry with count 1 for a previously unseen wave', () => {
      incrementInstallCount(db, 'weather-checker');

      const count = getInstallCount(db, 'weather-checker');
      expect(count).toBe(1);
    });

    it('increments the count for an existing wave', () => {
      incrementInstallCount(db, 'email-reader');
      incrementInstallCount(db, 'email-reader');
      incrementInstallCount(db, 'email-reader');

      const count = getInstallCount(db, 'email-reader');
      expect(count).toBe(3);
    });

    it('tracks multiple waves independently', () => {
      incrementInstallCount(db, 'wave-a');
      incrementInstallCount(db, 'wave-a');
      incrementInstallCount(db, 'wave-b');

      expect(getInstallCount(db, 'wave-a')).toBe(2);
      expect(getInstallCount(db, 'wave-b')).toBe(1);
    });

    it('updates last_installed_at on each increment', () => {
      incrementInstallCount(db, 'timed-wave');
      const entryFirst = getInstallCountEntry(db, 'timed-wave');

      incrementInstallCount(db, 'timed-wave');
      const entrySecond = getInstallCountEntry(db, 'timed-wave');

      expect(entrySecond).not.toBeNull();
      expect(entrySecond!.lastInstalledAt).toBeInstanceOf(Date);
      expect(entryFirst).not.toBeNull();
      expect(entryFirst!.firstInstalledAt).toBeInstanceOf(Date);
    });
  });

  describe('getInstallCount', () => {
    it('returns the current install count for a tracked wave', () => {
      incrementInstallCount(db, 'my-wave');
      incrementInstallCount(db, 'my-wave');

      expect(getInstallCount(db, 'my-wave')).toBe(2);
    });

    it('returns 0 for a wave that has never been installed', () => {
      expect(getInstallCount(db, 'totally-unknown-wave')).toBe(0);
    });
  });

  describe('getTopInstalled', () => {
    it('returns waves sorted by install count descending', () => {
      incrementInstallCount(db, 'low-wave');
      for (let idx = 0; idx < 5; idx++) incrementInstallCount(db, 'high-wave');
      for (let idx = 0; idx < 3; idx++) incrementInstallCount(db, 'mid-wave');

      const top = getTopInstalled(db);
      expect(top[0].waveName).toBe('high-wave');
      expect(top[0].installCount).toBe(5);
      expect(top[1].waveName).toBe('mid-wave');
      expect(top[1].installCount).toBe(3);
      expect(top[2].waveName).toBe('low-wave');
      expect(top[2].installCount).toBe(1);
    });

    it('respects the limit parameter', () => {
      for (let idx = 0; idx < 6; idx++) {
        incrementInstallCount(db, `wave-${idx}`);
      }

      const top = getTopInstalled(db, 3);
      expect(top).toHaveLength(3);
    });

    it('returns empty array when no waves have been installed', () => {
      const top = getTopInstalled(db);
      expect(top).toHaveLength(0);
    });
  });

  describe('getInstallCountEntry', () => {
    it('returns the full entry including date fields', () => {
      incrementInstallCount(db, 'full-entry-wave');

      const entry = getInstallCountEntry(db, 'full-entry-wave');
      expect(entry).not.toBeNull();
      expect(entry!.waveName).toBe('full-entry-wave');
      expect(entry!.installCount).toBe(1);
      expect(entry!.firstInstalledAt).toBeInstanceOf(Date);
      expect(entry!.lastInstalledAt).toBeInstanceOf(Date);
    });

    it('returns null for a wave that has never been installed', () => {
      const entry = getInstallCountEntry(db, 'no-such-wave');
      expect(entry).toBeNull();
    });
  });
});
