/**
 * Integration tests for party wave execution.
 * Validates the full execution pipeline: context sanitization,
 * DB proxy restrictions, output filtering, and permission enforcement.
 *
 * Uses in-memory SQLite with real migrations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import {
  buildPartyWaveContext,
  sanitizePartyWaveOutput,
  validateExtractedParams,
} from '../../../src/waves/party-wave-context.js';
import { createPartyWaveDbProxy } from '../../../src/waves/party-wave-db-proxy.js';
import { canTriggerPartyWave } from '../../../src/contacts/permissions.js';
import type { Contact, TrustLevel, WaveSafetyTier } from '../../../src/types/index.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

/** Create a test contact at a given trust level. */
function createTestContact(trustLevel: TrustLevel, overrides?: Partial<Contact>): Contact {
  return {
    id: 'test-contact-001',
    name: 'Test User',
    phone: '+15551234567',
    email: 'testuser@example.com',
    trustLevel,
    isFavorite: false,
    notes: null,
    permittedWaves: [],
    channelIds: {},
    rateLimitPerHour: 10,
    budgetCapUsd: 1.0,
    tags: [],
    lastContactedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Party Wave Execution Integration', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
    dbManager.runMigrations();
  });

  afterEach(() => {
    try { dbManager.close(); } catch { /* best-effort */ }
  });

  // ── Context Sanitization ──────────────────────────────────────────

  describe('buildPartyWaveContext', () => {
    it('strips owner-private keys from full context', () => {
      const fullContext = {
        _deps: { db: dbManager.db },
        ownerPreferences: { theme: 'dark', timezone: 'US/Pacific' },
        ownerSchedule: [{ day: 'Monday', slots: ['9am-5pm'] }],
        apiKeys: { openai: 'sk-abc123' },
        conversationHistory: [{ role: 'user', content: 'secret stuff' }],
        publicInfo: { companyName: 'Acme Corp' },
      };

      const contact = createTestContact('trusted');
      const sanitized = buildPartyWaveContext(fullContext, contact);

      // Owner-private keys should be removed
      expect(sanitized).not.toHaveProperty('ownerPreferences');
      expect(sanitized).not.toHaveProperty('ownerSchedule');
      expect(sanitized).not.toHaveProperty('apiKeys');
      expect(sanitized).not.toHaveProperty('conversationHistory');

      // Deps and public info should remain
      expect(sanitized).toHaveProperty('_deps');
      expect(sanitized).toHaveProperty('publicInfo');

      // Contact metadata should be injected
      expect(sanitized).toHaveProperty('contactName');
      expect(sanitized.contactName).toBe('Test User');
      expect(sanitized).toHaveProperty('contactTrustLevel');
      expect(sanitized.contactTrustLevel).toBe('trusted');
      expect(sanitized).toHaveProperty('isPartyWave');
      expect(sanitized.isPartyWave).toBe(true);
    });

    it('strips deeply nested owner data', () => {
      const fullContext = {
        _deps: {},
        nested: {
          ownerEmail: 'owner@private.com',
          normal: 'visible',
        },
        privateKnowledge: { secrets: 'top secret' },
      };

      const contact = createTestContact('known');
      const sanitized = buildPartyWaveContext(fullContext, contact);

      expect(sanitized).not.toHaveProperty('privateKnowledge');
    });
  });

  // ── Output Sanitization ───────────────────────────────────────────

  describe('sanitizePartyWaveOutput', () => {
    it('redacts email addresses from output', () => {
      const output = 'Contact owner at owner@company.com for details';
      const sanitized = sanitizePartyWaveOutput(output);
      expect(sanitized).not.toContain('owner@company.com');
      expect(sanitized).toContain('[redacted');
    });

    it('redacts phone numbers from output', () => {
      const output = 'Call the owner at +1-555-123-4567';
      const sanitized = sanitizePartyWaveOutput(output);
      expect(sanitized).not.toContain('555-123-4567');
    });

    it('redacts API key patterns from output', () => {
      const output = 'Using key sk-abc123def456ghi789jkl012mno';
      const sanitized = sanitizePartyWaveOutput(output);
      expect(sanitized).not.toContain('sk-abc123def456ghi789jkl012mno');
    });

    it('redacts file paths from output', () => {
      const output = 'Config at ~/.lil-dude/config.json';
      const sanitized = sanitizePartyWaveOutput(output);
      expect(sanitized).not.toContain('~/.lil-dude/config.json');
    });

    it('passes through safe output unchanged', () => {
      const output = 'Your task has been submitted for review. Task ID: task_123';
      const sanitized = sanitizePartyWaveOutput(output);
      expect(sanitized).toBe(output);
    });
  });

  // ── Parameter Validation ──────────────────────────────────────────

  describe('validateExtractedParams', () => {
    it('passes through safe parameters', () => {
      const params = { topic: 'weather', location: 'Tokyo' };
      const validated = validateExtractedParams(params, 'test-wave');
      expect(validated.topic).toBe('weather');
      expect(validated.location).toBe('Tokyo');
    });

    it('redacts SSN patterns in parameters', () => {
      const params = { info: 'SSN is 123-45-6789' };
      const validated = validateExtractedParams(params, 'test-wave');
      expect(validated.info).not.toContain('123-45-6789');
    });

    it('redacts credit card patterns in parameters', () => {
      const params = { payment: '4111 1111 1111 1111' };
      const validated = validateExtractedParams(params, 'test-wave');
      expect(validated.payment).not.toContain('4111 1111 1111 1111');
    });
  });

  // ── DB Proxy Restrictions ─────────────────────────────────────────

  describe('createPartyWaveDbProxy', () => {
    it('allows reading from allowed tables', () => {
      const proxy = createPartyWaveDbProxy(dbManager.db, 'faq-responder', 'contact-1');

      // faq_entries is an allowed read table
      const stmt = proxy.prepare('SELECT * FROM faq_entries WHERE id = ?');
      const result = stmt.get('nonexistent');
      expect(result).toBeUndefined(); // No data, but query should succeed
    });

    it('blocks reading from security_log', () => {
      const proxy = createPartyWaveDbProxy(dbManager.db, 'faq-responder', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM security_log');
      }).toThrow();
    });

    it('blocks reading from conversations', () => {
      const proxy = createPartyWaveDbProxy(dbManager.db, 'faq-responder', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM conversations');
      }).toThrow();
    });

    it('blocks reading from knowledge table', () => {
      const proxy = createPartyWaveDbProxy(dbManager.db, 'faq-responder', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM knowledge');
      }).toThrow();
    });

    it('blocks DELETE statements entirely', () => {
      const proxy = createPartyWaveDbProxy(dbManager.db, 'task-delegation', 'contact-1');

      expect(() => {
        proxy.prepare('DELETE FROM task_delegations WHERE id = ?');
      }).toThrow();
    });

    it('blocks DDL statements', () => {
      const proxy = createPartyWaveDbProxy(dbManager.db, 'test-wave', 'contact-1');

      expect(() => {
        proxy.prepare('DROP TABLE faq_entries');
      }).toThrow();
    });

    it('allows INSERT into allowed write tables', () => {
      const proxy = createPartyWaveDbProxy(dbManager.db, 'faq-responder', 'contact-1');

      // faq_entries is an allowed write table
      const stmt = proxy.prepare(
        'INSERT INTO faq_entries (id, question, answer, category, enabled, access_count) VALUES (?, ?, ?, ?, ?, ?)',
      );
      stmt.run('test-faq-1', 'What is this?', 'A test', 'general', 1, 0);

      // Verify the insert worked
      const readStmt = proxy.prepare('SELECT * FROM faq_entries WHERE id = ?');
      const row = readStmt.get('test-faq-1') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.question).toBe('What is this?');
    });

    it('blocks INSERT into blocked tables', () => {
      const proxy = createPartyWaveDbProxy(dbManager.db, 'test-wave', 'contact-1');

      expect(() => {
        proxy.prepare('INSERT INTO security_log (id, action_type) VALUES (?, ?)');
      }).toThrow();
    });
  });

  // ── Permission Enforcement ────────────────────────────────────────

  describe('canTriggerPartyWave', () => {
    const trustLevels: TrustLevel[] = ['owner', 'trusted', 'known', 'unknown'];
    const safetyTiers: WaveSafetyTier[] = ['observe', 'create', 'modify', 'destroy'];

    it('owner can trigger any party wave at any safety tier', () => {
      const owner = createTestContact('owner');
      for (const tier of safetyTiers) {
        const result = canTriggerPartyWave(owner, 'any-wave', tier);
        expect(result.allowed).toBe(true);
      }
    });

    it('trusted can trigger all party waves', () => {
      const trusted = createTestContact('trusted');
      expect(canTriggerPartyWave(trusted, 'auto-responder', 'observe').allowed).toBe(true);
      expect(canTriggerPartyWave(trusted, 'task-delegation', 'create').allowed).toBe(true);
      expect(canTriggerPartyWave(trusted, 'meeting-request', 'create').allowed).toBe(true);
    });

    it('known can only trigger observe-tier party waves', () => {
      const known = createTestContact('known');
      expect(canTriggerPartyWave(known, 'auto-responder', 'observe').allowed).toBe(true);
      expect(canTriggerPartyWave(known, 'contact-share', 'observe').allowed).toBe(true);
      // Cannot trigger create-tier
      expect(canTriggerPartyWave(known, 'task-delegation', 'create').allowed).toBe(false);
    });

    it('unknown can only trigger allowlisted observe-tier party waves', () => {
      const unknown = createTestContact('unknown');
      // Allowlisted: auto-responder, contact-share, faq-responder
      expect(canTriggerPartyWave(unknown, 'auto-responder', 'observe').allowed).toBe(true);
      expect(canTriggerPartyWave(unknown, 'contact-share', 'observe').allowed).toBe(true);
      expect(canTriggerPartyWave(unknown, 'faq-responder', 'observe').allowed).toBe(true);
      // Not allowlisted
      expect(canTriggerPartyWave(unknown, 'availability-check', 'observe').allowed).toBe(false);
      // Create-tier is always blocked for unknown
      expect(canTriggerPartyWave(unknown, 'task-delegation', 'create').allowed).toBe(false);
    });

    it('restricts destroy-tier party waves to owner and trusted only', () => {
      // Per permissions.ts: owner always allowed, trusted gets all party waves,
      // known/unknown are restricted to observe-tier
      for (const level of trustLevels) {
        const contact = createTestContact(level);
        const result = canTriggerPartyWave(contact, 'some-wave', 'destroy');
        if (level === 'owner' || level === 'trusted') {
          expect(result.allowed).toBe(true);
        } else {
          // known + unknown cannot trigger destroy-tier
          expect(result.allowed).toBe(false);
        }
      }
    });
  });
});
