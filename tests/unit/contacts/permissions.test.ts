import { describe, it, expect } from 'vitest';
import {
  canTriggerWave,
  canSendMessage,
  getAllowedTiers,
  canChangeTrustLevel,
} from '../../../src/contacts/permissions.js';
import type { Contact, WaveSafetyTier } from '../../../src/types/index.js';

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'test-id',
    name: 'Test User',
    phone: null,
    email: null,
    trustLevel: 'unknown',
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

describe('contact permissions', () => {
  describe('canTriggerWave', () => {
    describe('owner', () => {
      const owner = makeContact({ trustLevel: 'owner' });

      it('allows all safety tiers', () => {
        const tiers: WaveSafetyTier[] = ['observe', 'create', 'modify', 'destroy', 'execute'];
        for (const tier of tiers) {
          const result = canTriggerWave(owner, 'any-wave', tier);
          expect(result.allowed).toBe(true);
        }
      });
    });

    describe('trusted', () => {
      const trusted = makeContact({ trustLevel: 'trusted' });

      it('allows observe, create, modify tiers', () => {
        expect(canTriggerWave(trusted, 'wave-a', 'observe').allowed).toBe(true);
        expect(canTriggerWave(trusted, 'wave-a', 'create').allowed).toBe(true);
        expect(canTriggerWave(trusted, 'wave-a', 'modify').allowed).toBe(true);
      });

      it('denies destroy and execute tiers', () => {
        expect(canTriggerWave(trusted, 'wave-a', 'destroy').allowed).toBe(false);
        expect(canTriggerWave(trusted, 'wave-a', 'execute').allowed).toBe(false);
      });
    });

    describe('known', () => {
      const known = makeContact({ trustLevel: 'known' });

      it('allows only observe tier', () => {
        expect(canTriggerWave(known, 'wave-a', 'observe').allowed).toBe(true);
      });

      it('denies create, modify, destroy, execute tiers', () => {
        expect(canTriggerWave(known, 'wave-a', 'create').allowed).toBe(false);
        expect(canTriggerWave(known, 'wave-a', 'modify').allowed).toBe(false);
        expect(canTriggerWave(known, 'wave-a', 'destroy').allowed).toBe(false);
        expect(canTriggerWave(known, 'wave-a', 'execute').allowed).toBe(false);
      });
    });

    describe('unknown', () => {
      const unknown = makeContact({ trustLevel: 'unknown' });

      it('denies all tiers', () => {
        const tiers: WaveSafetyTier[] = ['observe', 'create', 'modify', 'destroy', 'execute'];
        for (const tier of tiers) {
          expect(canTriggerWave(unknown, 'wave-a', tier).allowed).toBe(false);
        }
      });
    });

    describe('per-contact wave allowlist', () => {
      it('allows wave in permitted list', () => {
        const contact = makeContact({
          trustLevel: 'trusted',
          permittedWaves: ['google-calendar', 'reminders'],
        });

        expect(canTriggerWave(contact, 'google-calendar', 'observe').allowed).toBe(true);
      });

      it('denies wave not in permitted list', () => {
        const contact = makeContact({
          trustLevel: 'trusted',
          permittedWaves: ['google-calendar'],
        });

        const result = canTriggerWave(contact, 'stock-monitor', 'observe');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('permitted list');
      });

      it('allows any wave when permitted list is empty (no restriction)', () => {
        const contact = makeContact({
          trustLevel: 'trusted',
          permittedWaves: [],
        });

        expect(canTriggerWave(contact, 'any-wave', 'observe').allowed).toBe(true);
      });

      it('owner bypasses permitted list', () => {
        const owner = makeContact({
          trustLevel: 'owner',
          permittedWaves: ['only-this'],
        });

        expect(canTriggerWave(owner, 'something-else', 'execute').allowed).toBe(true);
      });
    });
  });

  describe('canSendMessage', () => {
    it('allows messages from all trust levels', () => {
      const levels = ['owner', 'trusted', 'known', 'unknown'] as const;
      for (const level of levels) {
        const contact = makeContact({ trustLevel: level });
        expect(canSendMessage(contact).allowed).toBe(true);
      }
    });
  });

  describe('getAllowedTiers', () => {
    it('returns all tiers for owner', () => {
      expect(getAllowedTiers('owner')).toEqual(['observe', 'create', 'modify', 'destroy', 'execute']);
    });

    it('returns observe/create/modify for trusted', () => {
      expect(getAllowedTiers('trusted')).toEqual(['observe', 'create', 'modify']);
    });

    it('returns observe only for known', () => {
      expect(getAllowedTiers('known')).toEqual(['observe']);
    });

    it('returns empty for unknown', () => {
      expect(getAllowedTiers('unknown')).toEqual([]);
    });

    it('returns a copy (not the original array)', () => {
      const tiers = getAllowedTiers('owner');
      tiers.push('observe');
      expect(getAllowedTiers('owner')).toHaveLength(5);
    });
  });

  describe('canChangeTrustLevel', () => {
    it('allows owner to promote unknown to known', () => {
      const result = canChangeTrustLevel('unknown', 'known', true);
      expect(result.allowed).toBe(true);
    });

    it('allows owner to promote known to trusted', () => {
      const result = canChangeTrustLevel('known', 'trusted', true);
      expect(result.allowed).toBe(true);
    });

    it('allows owner to demote trusted to unknown', () => {
      const result = canChangeTrustLevel('trusted', 'unknown', true);
      expect(result.allowed).toBe(true);
    });

    it('denies changing owner trust level', () => {
      const result = canChangeTrustLevel('owner', 'trusted', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('owner');
    });

    it('denies promoting anyone to owner', () => {
      const result = canChangeTrustLevel('trusted', 'owner', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('owner');
    });

    it('denies non-owner from changing trust levels', () => {
      const result = canChangeTrustLevel('unknown', 'known', false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('owner');
    });
  });
});
