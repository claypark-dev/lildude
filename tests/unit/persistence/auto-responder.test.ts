import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getAutoResponderConfig,
  updateAutoResponderConfig,
} from '../../../src/persistence/auto-responder.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = ['001_initial.sql', '009_contacts.sql', '010_contact_profiles.sql', '011_external_waves.sql'];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('auto-responder config', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getAutoResponderConfig', () => {
    it('returns default config', () => {
      const config = getAutoResponderConfig(db);

      expect(config.enabled).toBe(false);
      expect(config.status).toBe('available');
      expect(config.customMessage).toBeNull();
      expect(config.returnDate).toBeNull();
      expect(config.alternateContact).toBeNull();
      expect(config.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('updateAutoResponderConfig', () => {
    it('enables auto-responder', () => {
      const config = updateAutoResponderConfig(db, { enabled: true });
      expect(config.enabled).toBe(true);
    });

    it('updates status', () => {
      const config = updateAutoResponderConfig(db, { status: 'busy' });
      expect(config.status).toBe('busy');
    });

    it('sets custom message', () => {
      const config = updateAutoResponderConfig(db, {
        customMessage: 'In meetings until 3pm.',
      });
      expect(config.customMessage).toBe('In meetings until 3pm.');
    });

    it('sets return date', () => {
      const config = updateAutoResponderConfig(db, {
        returnDate: '2025-03-10',
      });
      expect(config.returnDate).toBe('2025-03-10');
    });

    it('sets alternate contact', () => {
      const config = updateAutoResponderConfig(db, {
        alternateContact: 'jane@example.com',
      });
      expect(config.alternateContact).toBe('jane@example.com');
    });

    it('updates multiple fields at once', () => {
      const config = updateAutoResponderConfig(db, {
        enabled: true,
        status: 'vacation',
        customMessage: 'On vacation!',
        returnDate: 'April 1',
        alternateContact: 'bob@example.com',
      });

      expect(config.enabled).toBe(true);
      expect(config.status).toBe('vacation');
      expect(config.customMessage).toBe('On vacation!');
      expect(config.returnDate).toBe('April 1');
      expect(config.alternateContact).toBe('bob@example.com');
    });

    it('clears fields with null', () => {
      updateAutoResponderConfig(db, { customMessage: 'Old message' });
      const config = updateAutoResponderConfig(db, { customMessage: null });
      expect(config.customMessage).toBeNull();
    });

    it('returns current config when no fields provided', () => {
      const config = updateAutoResponderConfig(db, {});
      expect(config.enabled).toBe(false);
      expect(config.status).toBe('available');
    });

    it('persists changes across reads', () => {
      updateAutoResponderConfig(db, { enabled: true, status: 'dnd' });
      const config = getAutoResponderConfig(db);
      expect(config.enabled).toBe(true);
      expect(config.status).toBe('dnd');
    });
  });
});
