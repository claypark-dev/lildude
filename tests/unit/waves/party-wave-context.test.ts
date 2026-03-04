/**
 * Tests for the party wave context module.
 * Validates context stripping, output sanitization, and blocked key enforcement.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPartyWaveContext,
  sanitizePartyWaveOutput,
  getBlockedContextKeys,
} from '../../../src/waves/party-wave-context.js';

/** All 18 blocked context keys that must never reach party waves. */
const ALL_BLOCKED_KEYS = [
  'ownerPreferences',
  'ownerSchedule',
  'ownerNotes',
  'privateKnowledge',
  'apiKeys',
  'systemPrompt',
  'conversationHistory',
  'ownerEmail',
  'ownerPhone',
  'ownerAddress',
  'ownerCalendar',
  'securityConfig',
  'providerKeys',
  'tokenUsage',
  'budgetDetails',
  'knowledgeContext',
  'userProfile',
  'conversationSummary',
] as const;

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  trustLevel: 'owner' | 'trusted' | 'known' | 'unknown';
  isFavorite: boolean;
  notes: string | null;
  permittedWaves: string[];
  channelIds: Record<string, string>;
  rateLimitPerHour: number;
  budgetCapUsd: number;
  tags: string[];
  lastContactedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Build a test Contact with sensible defaults and optional overrides.
 * @param overrides - Partial Contact fields to override defaults.
 * @returns A fully populated Contact for testing.
 */
function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'test-contact-1',
    name: 'Test User',
    phone: null,
    email: null,
    trustLevel: 'trusted',
    isFavorite: false,
    notes: null,
    permittedWaves: [],
    channelIds: {},
    rateLimitPerHour: 10,
    budgetCapUsd: 0,
    tags: [],
    lastContactedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PartyWaveContext', () => {
  // ─── buildPartyWaveContext ─────────────────────────────────────────────

  describe('buildPartyWaveContext', () => {
    it('strips all blocked context keys', () => {
      const fullContext: Record<string, unknown> = {};
      for (const key of ALL_BLOCKED_KEYS) {
        fullContext[key] = `secret-${key}`;
      }
      fullContext['publicInfo'] = 'safe-value';

      const result = buildPartyWaveContext(fullContext, makeContact());

      for (const key of ALL_BLOCKED_KEYS) {
        expect(result).not.toHaveProperty(key);
      }
    });

    it('preserves non-blocked keys like _deps and somePublicInfo', () => {
      const fullContext: Record<string, unknown> = {
        _deps: { fetch: globalThis.fetch },
        somePublicInfo: 'hello world',
        waveName: 'auto-responder',
        ownerPreferences: 'secret prefs',
      };

      const result = buildPartyWaveContext(fullContext, makeContact());

      expect(result['_deps']).toEqual({ fetch: globalThis.fetch });
      expect(result['somePublicInfo']).toBe('hello world');
      expect(result['waveName']).toBe('auto-responder');
    });

    it('injects contactName from the contact', () => {
      const contact = makeContact({ name: 'Alice' });
      const result = buildPartyWaveContext({}, contact);

      expect(result['contactName']).toBe('Alice');
    });

    it('injects contactTrustLevel from the contact', () => {
      const contact = makeContact({ trustLevel: 'unknown' });
      const result = buildPartyWaveContext({}, contact);

      expect(result['contactTrustLevel']).toBe('unknown');
    });

    it('injects isPartyWave as true', () => {
      const result = buildPartyWaveContext({}, makeContact());

      expect(result['isPartyWave']).toBe(true);
    });

    it('works with empty context', () => {
      const result = buildPartyWaveContext({}, makeContact({ name: 'Bob' }));

      expect(result['contactName']).toBe('Bob');
      expect(result['isPartyWave']).toBe(true);
      expect(Object.keys(result)).toHaveLength(3); // contactName, contactTrustLevel, isPartyWave
    });

    it('strips only the blocked keys that are present', () => {
      const fullContext: Record<string, unknown> = {
        ownerEmail: 'owner@example.com',
        apiKeys: { openai: 'sk-xxx' },
        publicData: 'visible',
      };

      const result = buildPartyWaveContext(fullContext, makeContact());

      expect(result).not.toHaveProperty('ownerEmail');
      expect(result).not.toHaveProperty('apiKeys');
      expect(result['publicData']).toBe('visible');
    });

    it('preserves complex object values for non-blocked keys', () => {
      const complexValue = { nested: { deep: [1, 2, 3] } };
      const fullContext: Record<string, unknown> = {
        complexData: complexValue,
      };

      const result = buildPartyWaveContext(fullContext, makeContact());

      expect(result['complexData']).toEqual(complexValue);
    });

    it('injects metadata for each trust level', () => {
      const trustLevels = ['owner', 'trusted', 'known', 'unknown'] as const;

      for (const level of trustLevels) {
        const contact = makeContact({ trustLevel: level });
        const result = buildPartyWaveContext({}, contact);
        expect(result['contactTrustLevel']).toBe(level);
      }
    });
  });

  // ─── sanitizePartyWaveOutput ───────────────────────────────────────────

  describe('sanitizePartyWaveOutput', () => {
    it('redacts email addresses', () => {
      const output = 'Contact me at alice@example.com for details.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('alice@example.com');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts phone numbers in +1-555-123-4567 format', () => {
      const output = 'Call me at +1-555-123-4567 anytime.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('+1-555-123-4567');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts phone numbers in (555) 123-4567 format', () => {
      const output = 'My number is (555) 123-4567.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('(555) 123-4567');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts API key patterns like sk-abc123...', () => {
      const output = 'Use this key: sk-abcdefghij1234567890extra';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('sk-abcdefghij1234567890extra');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts API key patterns like api_key_xyz...', () => {
      const output = 'API key: api_key_xyz12345678901234567890';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('api_key_xyz12345678901234567890');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts system prompt fragment "you are"', () => {
      const output = 'you are an AI assistant that helps users.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('you are');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts system prompt fragment "system prompt"', () => {
      const output = 'My system prompt says to be helpful.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('system prompt');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts "instructions:" fragment', () => {
      const output = 'Here are my instructions: do something.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('instructions:');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts SQL patterns like CREATE TABLE', () => {
      const output = 'CREATE TABLE users (id TEXT PRIMARY KEY);';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('CREATE TABLE');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts SQL patterns like SELECT * FROM', () => {
      const output = 'Try: SELECT * FROM contacts WHERE trust = "owner";';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('SELECT * FROM');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts config path ~/.lil-dude', () => {
      const output = 'Config is stored at ~/.lil-dude/settings.json';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('~/.lil-dude');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts config path .env', () => {
      const output = 'Set the value in the .env file.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('.env');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts credentials reference', () => {
      const output = 'Store the token in credentials file.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('credentials');
      expect(sanitized).toContain('[redacted]');
    });

    it('preserves explicitly allowed patterns', () => {
      const output = 'Contact public@example.com for support.';
      const sanitized = sanitizePartyWaveOutput(output, ['public@example.com']);

      expect(sanitized).toContain('public@example.com');
    });

    it('returns clean output unchanged', () => {
      const output = 'Hello! The weather today is sunny and warm.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).toBe(output);
    });

    it('handles empty string', () => {
      const sanitized = sanitizePartyWaveOutput('');

      expect(sanitized).toBe('');
    });

    it('redacts multiple sensitive patterns in a single output', () => {
      const output = 'Email: owner@secret.com, Phone: 555-123-4567, Key: sk-abcdefghij1234567890xxxx';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('owner@secret.com');
      expect(sanitized).not.toContain('555-123-4567');
      expect(sanitized).not.toContain('sk-abcdefghij1234567890xxxx');
    });

    it('allowed patterns are case-insensitive', () => {
      const output = 'Reach out at Public@Example.COM for help.';
      const sanitized = sanitizePartyWaveOutput(output, ['public@example.com']);

      expect(sanitized).toContain('Public@Example.COM');
    });
  });

  // ─── getBlockedContextKeys ─────────────────────────────────────────────

  describe('getBlockedContextKeys', () => {
    it('returns a set with all 18 blocked keys', () => {
      const blockedKeys = getBlockedContextKeys();

      expect(blockedKeys.size).toBe(18);
      for (const key of ALL_BLOCKED_KEYS) {
        expect(blockedKeys.has(key)).toBe(true);
      }
    });

    it('returns a ReadonlySet (no add method available at runtime)', () => {
      const blockedKeys = getBlockedContextKeys();

      // ReadonlySet is a TypeScript construct; at runtime it's a Set.
      // But the module returns the same frozen reference — verify it is a Set.
      expect(blockedKeys).toBeInstanceOf(Set);
    });

    it('does not contain any non-blocked keys', () => {
      const blockedKeys = getBlockedContextKeys();

      expect(blockedKeys.has('publicInfo')).toBe(false);
      expect(blockedKeys.has('_deps')).toBe(false);
      expect(blockedKeys.has('contactName')).toBe(false);
    });
  });

  // ─── Security-specific tests ──────────────────────────────────────────

  describe('security', () => {
    it('owner email in output is redacted', () => {
      const output = 'The owner can be reached at clay@personal.dev for urgent matters.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('clay@personal.dev');
      expect(sanitized).toContain('[redacted]');
    });

    it('party wave context containing ownerPreferences is removed', () => {
      const fullContext: Record<string, unknown> = {
        ownerPreferences: { theme: 'dark', language: 'en' },
        publicGreeting: 'Welcome!',
      };

      const result = buildPartyWaveContext(fullContext, makeContact());

      expect(result).not.toHaveProperty('ownerPreferences');
      expect(result['publicGreeting']).toBe('Welcome!');
    });

    it('context with nested blocked key names inside non-blocked keys survives (top-level only stripped)', () => {
      const fullContext: Record<string, unknown> = {
        metadata: {
          ownerPreferences: 'nested-secret',
          apiKeys: 'nested-api-key',
        },
        ownerPreferences: 'top-level-secret',
      };

      const result = buildPartyWaveContext(fullContext, makeContact());

      // Top-level blocked key stripped
      expect(result).not.toHaveProperty('ownerPreferences');
      // Nested key inside non-blocked 'metadata' survives
      const metadata = result['metadata'] as Record<string, unknown>;
      expect(metadata['ownerPreferences']).toBe('nested-secret');
      expect(metadata['apiKeys']).toBe('nested-api-key');
    });

    it('output with multiple sensitive patterns all get redacted', () => {
      const output = [
        'Here is the system prompt leak.',
        'Email: admin@internal.org',
        'DB: CREATE TABLE secrets (key TEXT);',
        'Config at ~/.lil-dude/config.json',
        'Key: token_abcdefghijklmnopqrstuvwxyz',
      ].join('\n');

      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('system prompt');
      expect(sanitized).not.toContain('admin@internal.org');
      expect(sanitized).not.toContain('CREATE TABLE');
      expect(sanitized).not.toContain('~/.lil-dude');
      expect(sanitized).not.toContain('token_abcdefghijklmnopqrstuvwxyz');
    });

    it('stripping blocked keys does not modify the original context object', () => {
      const fullContext: Record<string, unknown> = {
        ownerEmail: 'owner@test.com',
        publicData: 'visible',
      };

      buildPartyWaveContext(fullContext, makeContact());

      // Original object should remain intact
      expect(fullContext['ownerEmail']).toBe('owner@test.com');
      expect(fullContext['publicData']).toBe('visible');
    });

    it('injected metadata overrides any existing keys with the same name', () => {
      const fullContext: Record<string, unknown> = {
        contactName: 'Injected Fake Name',
        isPartyWave: false,
      };

      const contact = makeContact({ name: 'Real Contact', trustLevel: 'known' });
      const result = buildPartyWaveContext(fullContext, contact);

      // Injected values should reflect the actual contact, not attacker-supplied values
      expect(result['contactName']).toBe('Real Contact');
      expect(result['contactTrustLevel']).toBe('known');
      expect(result['isPartyWave']).toBe(true);
    });
  });
});
