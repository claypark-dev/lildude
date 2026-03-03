import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  recordInjectionAttempt,
  autoBlockContact,
  isBlocked,
  getAttemptCount,
  unblock,
  clearAllAbuseTrackers,
  getAbuseInfo,
} from '../../../src/security/abuse-detector.js';
import { createContact } from '../../../src/persistence/contacts.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = ['001_initial.sql', '009_contacts.sql'];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('abuse-detector', () => {
  let db: Database.Database;

  beforeEach(() => {
    clearAllAbuseTrackers();
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    clearAllAbuseTrackers();
  });

  describe('recordInjectionAttempt', () => {
    it('records an attempt and returns false when under threshold', () => {
      const blocked = recordInjectionAttempt('user1', 'bad input', 'injection-attempt');
      expect(blocked).toBe(false);
      expect(getAttemptCount('user1')).toBe(1);
    });

    it('returns true when threshold is reached', () => {
      recordInjectionAttempt('user1', 'attempt 1', 'injection-attempt');
      recordInjectionAttempt('user1', 'attempt 2', 'injection-attempt');
      const blocked = recordInjectionAttempt('user1', 'attempt 3', 'injection-attempt');
      expect(blocked).toBe(true);
    });

    it('respects custom max attempts', () => {
      recordInjectionAttempt('user1', 'attempt 1', 'injection-attempt', { maxAttempts: 2 });
      const blocked = recordInjectionAttempt('user1', 'attempt 2', 'injection-attempt', { maxAttempts: 2 });
      expect(blocked).toBe(true);
    });

    it('prunes events outside the window', () => {
      // Record with very short window
      recordInjectionAttempt('user1', 'old attempt', 'injection-attempt', { windowMs: 1 });

      // Wait for window to expire
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait
      }

      // New attempt — old one should be pruned
      expect(getAttemptCount('user1', { windowMs: 1 })).toBe(0);
    });

    it('truncates long input snippets', () => {
      const longInput = 'A'.repeat(200);
      recordInjectionAttempt('user1', longInput, 'injection-attempt');
      const info = getAbuseInfo('user1');
      expect(info!.recentEvents[0].inputSnippet.length).toBeLessThanOrEqual(100);
    });

    it('tracks separate identifiers independently', () => {
      recordInjectionAttempt('user1', 'bad', 'injection-attempt');
      recordInjectionAttempt('user2', 'bad', 'injection-attempt');

      expect(getAttemptCount('user1')).toBe(1);
      expect(getAttemptCount('user2')).toBe(1);
    });

    it('stays blocked after threshold even with more attempts', () => {
      recordInjectionAttempt('user1', '1', 'injection-attempt');
      recordInjectionAttempt('user1', '2', 'injection-attempt');
      recordInjectionAttempt('user1', '3', 'injection-attempt');
      const stillBlocked = recordInjectionAttempt('user1', '4', 'injection-attempt');
      expect(stillBlocked).toBe(true);
    });
  });

  describe('autoBlockContact', () => {
    it('downgrades contact trust level to unknown', () => {
      const contact = createContact(db, { name: 'Alice', trustLevel: 'trusted' });
      autoBlockContact(db, contact.id, 'Testing');

      const row = db.prepare('SELECT trust_level FROM contacts WHERE id = ?').get(contact.id) as { trust_level: string };
      expect(row.trust_level).toBe('unknown');
    });

    it('never blocks owner contacts', () => {
      const owner = createContact(db, { name: 'Owner', trustLevel: 'owner' });
      autoBlockContact(db, owner.id, 'Testing');

      const row = db.prepare('SELECT trust_level FROM contacts WHERE id = ?').get(owner.id) as { trust_level: string };
      expect(row.trust_level).toBe('owner');
    });

    it('handles non-existent contact gracefully', () => {
      expect(() => autoBlockContact(db, 'nonexistent', 'Testing')).not.toThrow();
    });

    it('logs the block to security log', () => {
      const contact = createContact(db, { name: 'Bob', trustLevel: 'known' });
      autoBlockContact(db, contact.id, 'Too many injection attempts');

      const logs = db.prepare(
        `SELECT * FROM security_log WHERE action_type = 'abuse_auto_block'`,
      ).all() as Array<{ action_detail: string }>;
      expect(logs).toHaveLength(1);
      expect(logs[0].action_detail).toContain(contact.id);
    });
  });

  describe('isBlocked', () => {
    it('returns false for unknown identifiers', () => {
      expect(isBlocked('unknown')).toBe(false);
    });

    it('returns true after threshold reached', () => {
      recordInjectionAttempt('user1', '1', 'injection-attempt');
      recordInjectionAttempt('user1', '2', 'injection-attempt');
      recordInjectionAttempt('user1', '3', 'injection-attempt');
      expect(isBlocked('user1')).toBe(true);
    });

    it('returns false when under threshold', () => {
      recordInjectionAttempt('user1', '1', 'injection-attempt');
      expect(isBlocked('user1')).toBe(false);
    });
  });

  describe('unblock', () => {
    it('unblocks a blocked identifier', () => {
      recordInjectionAttempt('user1', '1', 'injection-attempt');
      recordInjectionAttempt('user1', '2', 'injection-attempt');
      recordInjectionAttempt('user1', '3', 'injection-attempt');

      expect(isBlocked('user1')).toBe(true);
      const unblocked = unblock('user1');
      expect(unblocked).toBe(true);
      expect(isBlocked('user1')).toBe(false);
    });

    it('returns false for non-blocked identifier', () => {
      expect(unblock('user1')).toBe(false);
    });

    it('clears event history after unblocking', () => {
      recordInjectionAttempt('user1', '1', 'injection-attempt');
      recordInjectionAttempt('user1', '2', 'injection-attempt');
      recordInjectionAttempt('user1', '3', 'injection-attempt');

      unblock('user1');
      expect(getAttemptCount('user1')).toBe(0);
    });
  });

  describe('getAbuseInfo', () => {
    it('returns null for untracked identifier', () => {
      expect(getAbuseInfo('unknown')).toBeNull();
    });

    it('returns tracking info for tracked identifier', () => {
      recordInjectionAttempt('user1', 'bad input', 'injection-attempt');
      const info = getAbuseInfo('user1');

      expect(info).not.toBeNull();
      expect(info!.attemptCount).toBe(1);
      expect(info!.blocked).toBe(false);
      expect(info!.recentEvents).toHaveLength(1);
      expect(info!.recentEvents[0].inputSnippet).toBe('bad input');
    });

    it('includes blocked timestamp when blocked', () => {
      recordInjectionAttempt('user1', '1', 'injection-attempt');
      recordInjectionAttempt('user1', '2', 'injection-attempt');
      recordInjectionAttempt('user1', '3', 'injection-attempt');

      const info = getAbuseInfo('user1');
      expect(info!.blocked).toBe(true);
      expect(info!.blockedAt).toBeGreaterThan(0);
    });
  });

  describe('clearAllAbuseTrackers', () => {
    it('removes all tracking state', () => {
      recordInjectionAttempt('user1', '1', 'injection-attempt');
      recordInjectionAttempt('user2', '2', 'injection-attempt');

      clearAllAbuseTrackers();

      expect(getAbuseInfo('user1')).toBeNull();
      expect(getAbuseInfo('user2')).toBeNull();
    });
  });
});
