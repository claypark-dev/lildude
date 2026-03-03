import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isPartyWaveEnabled,
  getPartyWaveSetting,
  listPartyWaveSettings,
  togglePartyWave,
  getPerContactConfig,
  updatePerContactConfig,
} from '../../../src/persistence/party-wave-settings.js';
import { createContact } from '../../../src/persistence/contacts.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '003_waves_foundation.sql',
    '009_contacts.sql',
    '010_contact_profiles.sql',
    '011_external_waves.sql',
    '013_party_waves.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('party wave settings', () => {
  let db: Database.Database;
  let contactId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const contact = createContact(db, { name: 'Alice', trustLevel: 'known' });
    contactId = contact.id;
  });

  afterEach(() => {
    db.close();
  });

  describe('isPartyWaveEnabled', () => {
    it('returns true for a wave that is seeded as enabled', () => {
      expect(isPartyWaveEnabled(db, 'auto-responder')).toBe(true);
    });

    it('returns false after disabling a wave', () => {
      togglePartyWave(db, 'message-relay', false);
      expect(isPartyWaveEnabled(db, 'message-relay')).toBe(false);
    });

    it('returns true (default) for a wave that does not exist in the table', () => {
      expect(isPartyWaveEnabled(db, 'wave_that_does_not_exist')).toBe(true);
    });
  });

  describe('getPartyWaveSetting', () => {
    it('retrieves an existing setting by wave name', () => {
      const setting = getPartyWaveSetting(db, 'meeting-request');

      expect(setting).not.toBeNull();
      expect(setting!.waveName).toBe('meeting-request');
      expect(setting!.enabled).toBe(true);
      expect(setting!.perContactConfig).toEqual({});
      expect(setting!.updatedAt).toBeInstanceOf(Date);
    });

    it('returns null for an unknown wave name', () => {
      expect(getPartyWaveSetting(db, 'totally_unknown_wave')).toBeNull();
    });
  });

  describe('listPartyWaveSettings', () => {
    it('returns all 9 seeded party wave settings', () => {
      const settings = listPartyWaveSettings(db);
      expect(settings).toHaveLength(9);
    });

    it('returns settings ordered by wave name', () => {
      const settings = listPartyWaveSettings(db);
      const names = settings.map((s) => s.waveName);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });
  });

  describe('togglePartyWave', () => {
    it('disables an existing wave', () => {
      expect(isPartyWaveEnabled(db, 'contact-share')).toBe(true);

      togglePartyWave(db, 'contact-share', false);
      expect(isPartyWaveEnabled(db, 'contact-share')).toBe(false);
    });

    it('enables a previously disabled wave', () => {
      togglePartyWave(db, 'faq-responder', false);
      expect(isPartyWaveEnabled(db, 'faq-responder')).toBe(false);

      togglePartyWave(db, 'faq-responder', true);
      expect(isPartyWaveEnabled(db, 'faq-responder')).toBe(true);
    });

    it('creates a new setting row when the wave is not yet in the table', () => {
      const waveName = 'brand-new-wave';
      expect(getPartyWaveSetting(db, waveName)).toBeNull();

      togglePartyWave(db, waveName, false);

      const setting = getPartyWaveSetting(db, waveName);
      expect(setting).not.toBeNull();
      expect(setting!.enabled).toBe(false);
    });
  });

  describe('getPerContactConfig', () => {
    it('returns null when no per-contact config has been set', () => {
      const config = getPerContactConfig(db, 'auto-responder', contactId);
      expect(config).toBeNull();
    });

    it('returns null for an unknown wave', () => {
      const config = getPerContactConfig(db, 'unknown_wave', contactId);
      expect(config).toBeNull();
    });
  });

  describe('updatePerContactConfig', () => {
    it('sets a per-contact config and retrieves it back', () => {
      updatePerContactConfig(db, 'auto-responder', contactId, {
        contactId,
        enabled: false,
        customMessage: 'Alice is currently unavailable.',
      });

      const config = getPerContactConfig(db, 'auto-responder', contactId);
      expect(config).not.toBeNull();
      expect(config!.contactId).toBe(contactId);
      expect(config!.enabled).toBe(false);
      expect(config!.customMessage).toBe('Alice is currently unavailable.');
    });

    it('merges configs for multiple contacts under the same wave', () => {
      const contact2 = createContact(db, { name: 'Bob' });

      updatePerContactConfig(db, 'message-relay', contactId, {
        contactId,
        customMessage: 'Alice override.',
      });
      updatePerContactConfig(db, 'message-relay', contact2.id, {
        contactId: contact2.id,
        customMessage: 'Bob override.',
      });

      const aliceConfig = getPerContactConfig(db, 'message-relay', contactId);
      const bobConfig = getPerContactConfig(db, 'message-relay', contact2.id);

      expect(aliceConfig!.customMessage).toBe('Alice override.');
      expect(bobConfig!.customMessage).toBe('Bob override.');
    });

    it('creates a new setting row for a wave that is not yet in the table', () => {
      const waveName = 'brand-new-wave-for-config';
      expect(getPartyWaveSetting(db, waveName)).toBeNull();

      updatePerContactConfig(db, waveName, contactId, { contactId, enabled: true });

      const config = getPerContactConfig(db, waveName, contactId);
      expect(config).not.toBeNull();
      expect(config!.enabled).toBe(true);
    });
  });
});
