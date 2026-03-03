import { describe, it, expect } from 'vitest';
import { canTriggerPartyWave } from '../../../src/contacts/permissions.js';
import type { Contact, WaveSafetyTier } from '../../../src/types/index.js';

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'test-contact',
    name: 'Test',
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

const ALL_TIERS: WaveSafetyTier[] = ['observe', 'create', 'modify', 'destroy', 'execute'];

describe('canTriggerPartyWave', () => {
  // ─── Owner access ───────────────────────────────────────────────────

  describe('owner access', () => {
    const owner = makeContact({ trustLevel: 'owner' });

    it('allows observe-tier party waves', () => {
      const result = canTriggerPartyWave(owner, 'auto-responder', 'observe');
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Owner');
    });

    it('allows create-tier party waves', () => {
      const result = canTriggerPartyWave(owner, 'meeting-request', 'create');
      expect(result.allowed).toBe(true);
    });

    it('allows modify-tier party waves', () => {
      const result = canTriggerPartyWave(owner, 'config-editor', 'modify');
      expect(result.allowed).toBe(true);
    });

    it('allows destroy-tier party waves', () => {
      const result = canTriggerPartyWave(owner, 'data-cleanup', 'destroy');
      expect(result.allowed).toBe(true);
    });

    it('allows execute-tier party waves', () => {
      const result = canTriggerPartyWave(owner, 'shell-runner', 'execute');
      expect(result.allowed).toBe(true);
    });

    it('allows all safety tiers regardless of wave name', () => {
      for (const tier of ALL_TIERS) {
        const result = canTriggerPartyWave(owner, `arbitrary-wave-${tier}`, tier);
        expect(result.allowed).toBe(true);
      }
    });

    it('bypasses permittedWaves allowlist', () => {
      const ownerWithAllowlist = makeContact({
        trustLevel: 'owner',
        permittedWaves: ['only-this-wave'],
      });
      const result = canTriggerPartyWave(ownerWithAllowlist, 'something-else', 'execute');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Trusted access ─────────────────────────────────────────────────

  describe('trusted access', () => {
    const trusted = makeContact({ trustLevel: 'trusted' });

    it('allows observe-tier party waves', () => {
      const result = canTriggerPartyWave(trusted, 'auto-responder', 'observe');
      expect(result.allowed).toBe(true);
    });

    it('allows create-tier party waves', () => {
      const result = canTriggerPartyWave(trusted, 'meeting-request', 'create');
      expect(result.allowed).toBe(true);
    });

    it('allows modify-tier party waves', () => {
      const result = canTriggerPartyWave(trusted, 'config-editor', 'modify');
      expect(result.allowed).toBe(true);
    });

    it('allows destroy-tier party waves', () => {
      const result = canTriggerPartyWave(trusted, 'data-cleanup', 'destroy');
      expect(result.allowed).toBe(true);
    });

    it('allows execute-tier party waves', () => {
      const result = canTriggerPartyWave(trusted, 'shell-runner', 'execute');
      expect(result.allowed).toBe(true);
    });

    it('respects permittedWaves allowlist when configured', () => {
      const trustedRestricted = makeContact({
        trustLevel: 'trusted',
        permittedWaves: ['auto-responder', 'contact-share'],
      });

      const allowed = canTriggerPartyWave(trustedRestricted, 'auto-responder', 'observe');
      expect(allowed.allowed).toBe(true);

      const blocked = canTriggerPartyWave(trustedRestricted, 'meeting-request', 'create');
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toContain('permitted list');
    });

    it('allows all waves when permittedWaves is empty (no restriction)', () => {
      const trustedNoRestriction = makeContact({
        trustLevel: 'trusted',
        permittedWaves: [],
      });

      const result = canTriggerPartyWave(trustedNoRestriction, 'any-wave-name', 'create');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Known access ───────────────────────────────────────────────────

  describe('known access', () => {
    const known = makeContact({ trustLevel: 'known' });

    it('allows observe-tier party waves', () => {
      const result = canTriggerPartyWave(known, 'auto-responder', 'observe');
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('observe');
    });

    it('blocks create-tier party waves', () => {
      const result = canTriggerPartyWave(known, 'meeting-request', 'create');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('observe');
    });

    it('blocks modify-tier party waves', () => {
      const result = canTriggerPartyWave(known, 'config-editor', 'modify');
      expect(result.allowed).toBe(false);
    });

    it('blocks destroy-tier party waves', () => {
      const result = canTriggerPartyWave(known, 'data-cleanup', 'destroy');
      expect(result.allowed).toBe(false);
    });

    it('blocks execute-tier party waves', () => {
      const result = canTriggerPartyWave(known, 'shell-runner', 'execute');
      expect(result.allowed).toBe(false);
    });

    it('respects permittedWaves allowlist for observe-tier waves', () => {
      const knownRestricted = makeContact({
        trustLevel: 'known',
        permittedWaves: ['auto-responder'],
      });

      const allowed = canTriggerPartyWave(knownRestricted, 'auto-responder', 'observe');
      expect(allowed.allowed).toBe(true);

      const blocked = canTriggerPartyWave(knownRestricted, 'contact-share', 'observe');
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toContain('permitted list');
    });

    it('allows any observe-tier wave when permittedWaves is empty', () => {
      const knownNoRestriction = makeContact({
        trustLevel: 'known',
        permittedWaves: [],
      });

      const result = canTriggerPartyWave(knownNoRestriction, 'any-observe-wave', 'observe');
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Unknown access ─────────────────────────────────────────────────

  describe('unknown access', () => {
    const unknown = makeContact({ trustLevel: 'unknown' });

    it('allows auto-responder (observe, allowlisted)', () => {
      const result = canTriggerPartyWave(unknown, 'auto-responder', 'observe');
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('allowlisted');
    });

    it('allows contact-share (observe, allowlisted)', () => {
      const result = canTriggerPartyWave(unknown, 'contact-share', 'observe');
      expect(result.allowed).toBe(true);
    });

    it('allows faq-responder (observe, allowlisted)', () => {
      const result = canTriggerPartyWave(unknown, 'faq-responder', 'observe');
      expect(result.allowed).toBe(true);
    });

    it('blocks meeting-request (create-tier)', () => {
      const result = canTriggerPartyWave(unknown, 'meeting-request', 'create');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('observe');
    });

    it('blocks message-relay (create-tier)', () => {
      const result = canTriggerPartyWave(unknown, 'message-relay', 'create');
      expect(result.allowed).toBe(false);
    });

    it('blocks availability-check (observe, NOT in allowlist)', () => {
      const result = canTriggerPartyWave(unknown, 'availability-check', 'observe');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not available to unknown');
    });

    it('blocks task-delegation (create-tier)', () => {
      const result = canTriggerPartyWave(unknown, 'task-delegation', 'create');
      expect(result.allowed).toBe(false);
    });

    it('blocks modify-tier party waves', () => {
      const result = canTriggerPartyWave(unknown, 'config-editor', 'modify');
      expect(result.allowed).toBe(false);
    });

    it('blocks destroy-tier party waves', () => {
      const result = canTriggerPartyWave(unknown, 'data-cleanup', 'destroy');
      expect(result.allowed).toBe(false);
    });

    it('blocks execute-tier party waves', () => {
      const result = canTriggerPartyWave(unknown, 'shell-runner', 'execute');
      expect(result.allowed).toBe(false);
    });
  });

  // ─── Security bypass attempts ───────────────────────────────────────

  describe('security bypass attempts', () => {
    it('blocks unknown contact from create-tier even with allowlisted wave name', () => {
      const unknown = makeContact({ trustLevel: 'unknown' });
      const result = canTriggerPartyWave(unknown, 'auto-responder', 'create');
      expect(result.allowed).toBe(false);
    });

    it('blocks unknown contact from non-allowlisted observe wave', () => {
      const unknown = makeContact({ trustLevel: 'unknown' });
      const result = canTriggerPartyWave(unknown, 'calendar-view', 'observe');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not available to unknown');
    });

    it('blocks known contact from destroy-tier party wave', () => {
      const known = makeContact({ trustLevel: 'known' });
      const result = canTriggerPartyWave(known, 'data-cleanup', 'destroy');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('observe');
    });

    it('blocks known contact from execute-tier party wave', () => {
      const known = makeContact({ trustLevel: 'known' });
      const result = canTriggerPartyWave(known, 'shell-runner', 'execute');
      expect(result.allowed).toBe(false);
    });

    it('blocks trusted contact from wave outside permittedWaves', () => {
      const trusted = makeContact({
        trustLevel: 'trusted',
        permittedWaves: ['auto-responder'],
      });
      const result = canTriggerPartyWave(trusted, 'data-cleanup', 'destroy');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('permitted list');
    });
  });
});
