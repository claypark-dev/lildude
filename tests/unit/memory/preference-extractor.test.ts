import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import {
  extractAndStorePreferences,
  upsertPreference,
  loadUserProfile,
} from '../../../src/memory/preference-extractor.js';

/** SQL to create the user_profile table matching the project schema. */
const CREATE_USER_PROFILE_TABLE = `
  CREATE TABLE user_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'inferred',
    confidence REAL NOT NULL DEFAULT 0.5,
    access_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

describe('preference-extractor', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(CREATE_USER_PROFILE_TABLE);
  });

  afterEach(() => {
    db.close();
  });

  describe('extractAndStorePreferences', () => {
    it('extracts preferred_name from "call me Clay"', () => {
      extractAndStorePreferences(db, ['call me Clay']);

      const profile = loadUserProfile(db);
      const nameEntry = profile.find((p) => p.key === 'preferred_name');
      expect(nameEntry).toBeDefined();
      expect(nameEntry!.value).toBe('Clay');
    });

    it('extracts preferred_name from "my name is Alice"', () => {
      extractAndStorePreferences(db, ['my name is Alice']);

      const profile = loadUserProfile(db);
      const nameEntry = profile.find((p) => p.key === 'preferred_name');
      expect(nameEntry).toBeDefined();
      expect(nameEntry!.value).toBe('Alice');
    });

    it('extracts communication_style from "I prefer brief responses"', () => {
      extractAndStorePreferences(db, ['I prefer brief responses']);

      const profile = loadUserProfile(db);
      const styleEntry = profile.find((p) => p.key === 'communication_style');
      expect(styleEntry).toBeDefined();
      expect(styleEntry!.value).toBe('brief');
    });

    it('extracts communication_style "detailed" from "please use detailed responses"', () => {
      extractAndStorePreferences(db, ['please use detailed responses']);

      const profile = loadUserProfile(db);
      const styleEntry = profile.find((p) => p.key === 'communication_style');
      expect(styleEntry).toBeDefined();
      expect(styleEntry!.value).toBe('detailed');
    });

    it('extracts timezone_hint from "I live in New York"', () => {
      extractAndStorePreferences(db, ["I live in New York"]);

      const profile = loadUserProfile(db);
      const tzEntry = profile.find((p) => p.key === 'timezone_hint');
      expect(tzEntry).toBeDefined();
      expect(tzEntry!.value).toBe('New York');
    });

    it('extracts response_length = "concise" from messages with short-response cues', () => {
      extractAndStorePreferences(db, [
        'Can you be shorter in your answers?',
        'Please be more concise.',
      ]);

      const profile = loadUserProfile(db);
      const lengthEntry = profile.find((p) => p.key === 'response_length');
      expect(lengthEntry).toBeDefined();
      expect(lengthEntry!.value).toBe('concise');
    });

    it('extracts response_length = "detailed" from messages asking for more detail', () => {
      extractAndStorePreferences(db, [
        'Can you elaborate on this topic?',
        'I need more detail please.',
      ]);

      const profile = loadUserProfile(db);
      const lengthEntry = profile.find((p) => p.key === 'response_length');
      expect(lengthEntry).toBeDefined();
      expect(lengthEntry!.value).toBe('detailed');
    });

    it('extracts common_request patterns from messages', () => {
      extractAndStorePreferences(db, ['check my email please']);

      const profile = loadUserProfile(db);
      const emailEntry = profile.find((p) => p.key === 'common_request:email_check');
      expect(emailEntry).toBeDefined();
      expect(emailEntry!.value).toBe('email_check');
    });

    it('extracts multiple preferences from a single conversation', () => {
      extractAndStorePreferences(db, [
        'Call me Clay',
        'I prefer brief responses',
        'What is the weather like?',
      ]);

      const profile = loadUserProfile(db);
      expect(profile.length).toBeGreaterThanOrEqual(2);

      const nameEntry = profile.find((p) => p.key === 'preferred_name');
      expect(nameEntry).toBeDefined();
      expect(nameEntry!.value).toBe('Clay');

      const styleEntry = profile.find((p) => p.key === 'communication_style');
      expect(styleEntry).toBeDefined();
      expect(styleEntry!.value).toBe('brief');
    });

    it('does not crash on empty messages', () => {
      expect(() => extractAndStorePreferences(db, [])).not.toThrow();
      const profile = loadUserProfile(db);
      expect(profile).toEqual([]);
    });

    it('does not extract preferences from unrelated text', () => {
      extractAndStorePreferences(db, ['The quick brown fox jumps over the lazy dog.']);
      const profile = loadUserProfile(db);
      expect(profile).toEqual([]);
    });
  });

  describe('upsertPreference', () => {
    it('inserts a new preference', () => {
      upsertPreference(db, 'preferred_name', 'Clay', 'inferred', 0.7);

      const profile = loadUserProfile(db);
      expect(profile).toHaveLength(1);
      expect(profile[0].key).toBe('preferred_name');
      expect(profile[0].value).toBe('Clay');
      expect(profile[0].confidence).toBe(0.7);
    });

    it('updates existing preference when new confidence is higher (same source rank)', () => {
      upsertPreference(db, 'preferred_name', 'Clay', 'inferred', 0.5);
      upsertPreference(db, 'preferred_name', 'Clayton', 'inferred', 0.8);

      const profile = loadUserProfile(db);
      expect(profile).toHaveLength(1);
      expect(profile[0].value).toBe('Clayton');
      expect(profile[0].confidence).toBe(0.8);
    });

    it('does not downgrade preference when new confidence is lower (same source rank)', () => {
      upsertPreference(db, 'preferred_name', 'Clay', 'inferred', 0.9);
      upsertPreference(db, 'preferred_name', 'Clayton', 'inferred', 0.3);

      const profile = loadUserProfile(db);
      expect(profile).toHaveLength(1);
      // Should keep the original since the new confidence is lower
      expect(profile[0].value).toBe('Clay');
      expect(profile[0].confidence).toBe(0.9);
    });

    it('explicit source always overrides inferred source', () => {
      upsertPreference(db, 'preferred_name', 'Clay', 'inferred', 0.9);
      upsertPreference(db, 'preferred_name', 'Clayton', 'explicit', 0.5);

      const profile = loadUserProfile(db);
      expect(profile).toHaveLength(1);
      // Explicit wins over inferred regardless of confidence
      expect(profile[0].value).toBe('Clayton');
    });

    it('system source overrides explicit source', () => {
      upsertPreference(db, 'preferred_name', 'Clay', 'explicit', 0.9);
      upsertPreference(db, 'preferred_name', 'Admin', 'system', 0.5);

      const profile = loadUserProfile(db);
      expect(profile).toHaveLength(1);
      expect(profile[0].value).toBe('Admin');
    });

    it('boosts confidence when same value is upserted again (lower confidence, same rank)', () => {
      upsertPreference(db, 'communication_style', 'brief', 'inferred', 0.6);
      upsertPreference(db, 'communication_style', 'brief', 'inferred', 0.5);

      const profile = loadUserProfile(db);
      expect(profile).toHaveLength(1);
      expect(profile[0].value).toBe('brief');
      // Confidence should be boosted by 0.05 from original 0.6
      expect(profile[0].confidence).toBeCloseTo(0.65, 5);
    });

    it('caps boosted confidence at 1.0', () => {
      upsertPreference(db, 'communication_style', 'brief', 'inferred', 0.98);
      upsertPreference(db, 'communication_style', 'brief', 'inferred', 0.5);

      const profile = loadUserProfile(db);
      expect(profile).toHaveLength(1);
      // 0.98 + 0.05 = 1.03 -> capped at 1.0
      expect(profile[0].confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe('loadUserProfile', () => {
    it('returns empty array when no preferences exist', () => {
      const profile = loadUserProfile(db);
      expect(profile).toEqual([]);
    });

    it('returns preferences sorted by confidence descending', () => {
      upsertPreference(db, 'low_conf', 'a', 'inferred', 0.3);
      upsertPreference(db, 'mid_conf', 'b', 'inferred', 0.6);
      upsertPreference(db, 'high_conf', 'c', 'inferred', 0.9);

      const profile = loadUserProfile(db);
      expect(profile).toHaveLength(3);
      expect(profile[0].key).toBe('high_conf');
      expect(profile[1].key).toBe('mid_conf');
      expect(profile[2].key).toBe('low_conf');
    });

    it('returns entries with key, value, and confidence fields', () => {
      upsertPreference(db, 'preferred_name', 'Clay', 'inferred', 0.7);

      const profile = loadUserProfile(db);
      expect(profile).toHaveLength(1);
      expect(profile[0]).toEqual({
        key: 'preferred_name',
        value: 'Clay',
        confidence: 0.7,
      });
    });

    it('returns all entries regardless of source', () => {
      upsertPreference(db, 'a', 'val_a', 'inferred', 0.5);
      upsertPreference(db, 'b', 'val_b', 'explicit', 0.7);
      upsertPreference(db, 'c', 'val_c', 'system', 0.9);

      const profile = loadUserProfile(db);
      expect(profile).toHaveLength(3);
    });
  });
});
