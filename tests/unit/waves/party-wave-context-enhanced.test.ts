/**
 * Tests for the enhanced party wave context module (Sprint 18B additions).
 * Validates new validateExtractedParams function, expanded blocked keys,
 * and enhanced sanitizePartyWaveOutput with additional sensitive patterns.
 */

import { describe, it, expect } from 'vitest';
import {
  validateExtractedParams,
  sanitizePartyWaveOutput,
  buildPartyWaveContext,
  getBlockedContextKeys,
} from '../../../src/waves/party-wave-context.js';

/** Contact fixture for buildPartyWaveContext tests. */
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

describe('party-wave-context enhanced (Sprint 18B)', () => {

  // ─── validateExtractedParams ──────────────────────────────────────────

  describe('validateExtractedParams', () => {
    it('strips params whose keys match blocked context keys', () => {
      const params: Record<string, unknown> = {
        query: 'What are the office hours?',
        ownerPreferences: 'dark mode, english',
        apiKeys: 'sk-secret123',
      };

      const cleaned = validateExtractedParams(params, 'faq-responder');

      expect(cleaned).toHaveProperty('query');
      expect(cleaned).not.toHaveProperty('ownerPreferences');
      expect(cleaned).not.toHaveProperty('apiKeys');
    });

    it('strips the new Sprint 18B blocked keys (knowledgeContext, userProfile, conversationSummary)', () => {
      const params: Record<string, unknown> = {
        question: 'Hello',
        knowledgeContext: 'all my private knowledge...',
        userProfile: 'owner personal details',
        conversationSummary: 'full conversation log',
      };

      const cleaned = validateExtractedParams(params, 'test-wave');

      expect(cleaned).toHaveProperty('question');
      expect(cleaned).not.toHaveProperty('knowledgeContext');
      expect(cleaned).not.toHaveProperty('userProfile');
      expect(cleaned).not.toHaveProperty('conversationSummary');
    });

    it('redacts SSN patterns in param values', () => {
      const params: Record<string, unknown> = {
        answer: 'My SSN is 123-45-6789, please use it.',
      };

      const cleaned = validateExtractedParams(params, 'test-wave');

      expect(cleaned['answer']).toBe('[redacted]');
    });

    it('redacts credit card patterns in param values', () => {
      const params: Record<string, unknown> = {
        payment: 'Card: 4111-1111-1111-1111',
      };

      const cleaned = validateExtractedParams(params, 'test-wave');

      expect(cleaned['payment']).toBe('[redacted]');
    });

    it('redacts API key patterns in param values', () => {
      const params: Record<string, unknown> = {
        token: 'sk-abcdefghijklmnopqrstuvwxyz',
      };

      const cleaned = validateExtractedParams(params, 'test-wave');

      expect(cleaned['token']).toBe('[redacted]');
    });

    it('redacts config path patterns in param values', () => {
      const params: Record<string, unknown> = {
        path: 'Look at ~/.lil-dude/settings.json',
      };

      const cleaned = validateExtractedParams(params, 'test-wave');

      expect(cleaned['path']).toBe('[redacted]');
    });

    it('redacts SQL patterns in param values', () => {
      const params: Record<string, unknown> = {
        query: 'SELECT * FROM knowledge WHERE category = "personal"',
      };

      const cleaned = validateExtractedParams(params, 'test-wave');

      expect(cleaned['query']).toBe('[redacted]');
    });

    it('passes through non-string values unmodified', () => {
      const params: Record<string, unknown> = {
        count: 42,
        active: true,
        nested: { a: 1 },
      };

      const cleaned = validateExtractedParams(params, 'test-wave');

      expect(cleaned['count']).toBe(42);
      expect(cleaned['active']).toBe(true);
      expect(cleaned['nested']).toEqual({ a: 1 });
    });

    it('passes through safe string values unmodified', () => {
      const params: Record<string, unknown> = {
        name: 'Alice',
        message: 'What are your office hours?',
      };

      const cleaned = validateExtractedParams(params, 'test-wave');

      expect(cleaned['name']).toBe('Alice');
      expect(cleaned['message']).toBe('What are your office hours?');
    });

    it('returns empty object when all params are blocked keys', () => {
      const params: Record<string, unknown> = {
        ownerPreferences: 'dark mode',
        providerKeys: 'sk-123',
        budgetDetails: '$500/month',
      };

      const cleaned = validateExtractedParams(params, 'test-wave');

      expect(Object.keys(cleaned)).toHaveLength(0);
    });
  });

  // ─── Enhanced sanitizePartyWaveOutput ─────────────────────────────────

  describe('sanitizePartyWaveOutput (enhanced patterns)', () => {
    it('redacts SSN patterns', () => {
      const output = 'The SSN is 123-45-6789 and should be protected.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('123-45-6789');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts home directory paths (/Users/username)', () => {
      const output = 'File located at /Users/claypark/Documents/secret.txt';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('/Users/claypark');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts home directory paths (/home/username)', () => {
      const output = 'File at /home/deploy/app/config.json';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('/home/deploy');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts localhost URLs with ports', () => {
      const output = 'API running at localhost:18421 for debug.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('localhost:18421');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts 127.0.0.1 URLs with ports', () => {
      const output = 'Connect to 127.0.0.1:3000 for the dashboard.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('127.0.0.1:3000');
      expect(sanitized).toContain('[redacted]');
    });

    it('redacts budget/financial references with dollar amounts', () => {
      const output = 'The monthly limit is set to budget $50.00 per month.';
      const sanitized = sanitizePartyWaveOutput(output);

      expect(sanitized).not.toContain('budget $50.00');
    });
  });

  // ─── buildPartyWaveContext (expanded blocked keys) ────────────────────

  describe('buildPartyWaveContext (Sprint 18B new blocked keys)', () => {
    it('strips knowledgeContext from context', () => {
      const fullContext: Record<string, unknown> = {
        knowledgeContext: 'all the private facts about the owner',
        publicData: 'safe value',
      };

      const result = buildPartyWaveContext(fullContext, makeContact());

      expect(result).not.toHaveProperty('knowledgeContext');
      expect(result['publicData']).toBe('safe value');
    });

    it('strips userProfile from context', () => {
      const fullContext: Record<string, unknown> = {
        userProfile: { name: 'Owner', preferences: { theme: 'dark' } },
        waveName: 'test-wave',
      };

      const result = buildPartyWaveContext(fullContext, makeContact());

      expect(result).not.toHaveProperty('userProfile');
      expect(result['waveName']).toBe('test-wave');
    });

    it('strips conversationSummary from context', () => {
      const fullContext: Record<string, unknown> = {
        conversationSummary: 'Owner discussed financial details...',
        taskInfo: 'public task data',
      };

      const result = buildPartyWaveContext(fullContext, makeContact());

      expect(result).not.toHaveProperty('conversationSummary');
      expect(result['taskInfo']).toBe('public task data');
    });
  });

  // ─── getBlockedContextKeys (expanded set) ─────────────────────────────

  describe('getBlockedContextKeys (expanded to 18)', () => {
    it('returns a set with 18 blocked keys', () => {
      const blockedKeys = getBlockedContextKeys();

      expect(blockedKeys.size).toBe(18);
    });

    it('contains all original 15 blocked keys', () => {
      const blockedKeys = getBlockedContextKeys();
      const original15 = [
        'ownerPreferences', 'ownerSchedule', 'ownerNotes',
        'privateKnowledge', 'apiKeys', 'systemPrompt',
        'conversationHistory', 'ownerEmail', 'ownerPhone',
        'ownerAddress', 'ownerCalendar', 'securityConfig',
        'providerKeys', 'tokenUsage', 'budgetDetails',
      ];

      for (const key of original15) {
        expect(blockedKeys.has(key)).toBe(true);
      }
    });

    it('contains the 3 new Sprint 18B blocked keys', () => {
      const blockedKeys = getBlockedContextKeys();

      expect(blockedKeys.has('knowledgeContext')).toBe(true);
      expect(blockedKeys.has('userProfile')).toBe(true);
      expect(blockedKeys.has('conversationSummary')).toBe(true);
    });

    it('does not contain non-blocked keys', () => {
      const blockedKeys = getBlockedContextKeys();

      expect(blockedKeys.has('contactName')).toBe(false);
      expect(blockedKeys.has('isPartyWave')).toBe(false);
      expect(blockedKeys.has('waveName')).toBe(false);
      expect(blockedKeys.has('publicData')).toBe(false);
    });
  });
});
