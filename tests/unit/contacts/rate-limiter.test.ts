import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkContactRateLimit,
  resetContactRateLimit,
  clearAllRateLimits,
  getRateLimitCount,
} from '../../../src/contacts/rate-limiter.js';
import type { Contact } from '../../../src/types/index.js';

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'test-contact',
    name: 'Test User',
    phone: null,
    email: null,
    trustLevel: 'known',
    isFavorite: false,
    notes: null,
    permittedWaves: [],
    channelIds: {},
    rateLimitPerHour: 5,
    budgetCapUsd: 0,
    tags: [],
    lastContactedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('contact rate limiter', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  describe('checkContactRateLimit', () => {
    it('allows requests within limit', () => {
      const contact = makeContact({ rateLimitPerHour: 5 });

      const result = checkContactRateLimit(contact);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('blocks requests over limit', () => {
      const contact = makeContact({ rateLimitPerHour: 3 });

      checkContactRateLimit(contact);
      checkContactRateLimit(contact);
      checkContactRateLimit(contact);

      const result = checkContactRateLimit(contact);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('never rate limits owner', () => {
      const owner = makeContact({ trustLevel: 'owner', rateLimitPerHour: 1 });

      for (let i = 0; i < 100; i++) {
        const result = checkContactRateLimit(owner);
        expect(result.allowed).toBe(true);
      }
    });

    it('tracks different contacts independently', () => {
      const alice = makeContact({ id: 'alice', rateLimitPerHour: 2 });
      const bob = makeContact({ id: 'bob', rateLimitPerHour: 2 });

      checkContactRateLimit(alice);
      checkContactRateLimit(alice);

      // Alice is at limit
      expect(checkContactRateLimit(alice).allowed).toBe(false);
      // Bob is still free
      expect(checkContactRateLimit(bob).allowed).toBe(true);
    });

    it('decrements remaining correctly', () => {
      const contact = makeContact({ rateLimitPerHour: 5 });

      expect(checkContactRateLimit(contact).remaining).toBe(4);
      expect(checkContactRateLimit(contact).remaining).toBe(3);
      expect(checkContactRateLimit(contact).remaining).toBe(2);
      expect(checkContactRateLimit(contact).remaining).toBe(1);
      expect(checkContactRateLimit(contact).remaining).toBe(0);
    });
  });

  describe('resetContactRateLimit', () => {
    it('resets a contact rate limit window', () => {
      const contact = makeContact({ rateLimitPerHour: 2 });

      checkContactRateLimit(contact);
      checkContactRateLimit(contact);
      expect(checkContactRateLimit(contact).allowed).toBe(false);

      resetContactRateLimit(contact.id);
      expect(checkContactRateLimit(contact).allowed).toBe(true);
    });
  });

  describe('getRateLimitCount', () => {
    it('returns 0 for unknown contact', () => {
      expect(getRateLimitCount('nobody')).toBe(0);
    });

    it('returns current request count', () => {
      const contact = makeContact({ rateLimitPerHour: 10 });

      checkContactRateLimit(contact);
      checkContactRateLimit(contact);
      checkContactRateLimit(contact);

      expect(getRateLimitCount(contact.id)).toBe(3);
    });
  });

  describe('clearAllRateLimits', () => {
    it('clears all windows', () => {
      const alice = makeContact({ id: 'alice' });
      const bob = makeContact({ id: 'bob' });

      checkContactRateLimit(alice);
      checkContactRateLimit(bob);

      clearAllRateLimits();

      expect(getRateLimitCount('alice')).toBe(0);
      expect(getRateLimitCount('bob')).toBe(0);
    });
  });
});
