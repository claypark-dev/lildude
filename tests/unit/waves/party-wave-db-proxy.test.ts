/**
 * Tests for the party wave database proxy.
 * Validates that party waves are restricted to safe tables and operations,
 * preventing access to owner-private data via SQL.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPartyWaveDbProxy,
  extractTableNames,
  getAllowedReadTables,
  getAllowedWriteTables,
  getBlockedTables,
} from '../../../src/waves/party-wave-db-proxy.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '003_waves_foundation.sql',
    '009_contacts.sql',
    '013_party_waves.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('party-wave-db-proxy', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── createPartyWaveDbProxy ────────────────────────────────────────────

  describe('createPartyWaveDbProxy', () => {
    it('returns a proxy object with a prepare method', () => {
      const proxy = createPartyWaveDbProxy(db, 'test-wave', 'contact-1');

      expect(proxy).toBeDefined();
      expect(typeof proxy.prepare).toBe('function');
    });

    it('proxy prepare returns an object with all, get, run methods', () => {
      const proxy = createPartyWaveDbProxy(db, 'test-wave', 'contact-1');
      const stmt = proxy.prepare('SELECT * FROM faq_entries');

      expect(typeof stmt.all).toBe('function');
      expect(typeof stmt.get).toBe('function');
      expect(typeof stmt.run).toBe('function');
    });
  });

  // ─── extractTableNames ────────────────────────────────────────────────

  describe('extractTableNames', () => {
    it('extracts table name from SELECT ... FROM', () => {
      const tables = extractTableNames('SELECT * FROM faq_entries WHERE id = ?');

      expect(tables.has('faq_entries')).toBe(true);
    });

    it('extracts table name from INSERT INTO', () => {
      const tables = extractTableNames('INSERT INTO task_delegations (id, contact_id) VALUES (?, ?)');

      expect(tables.has('task_delegations')).toBe(true);
    });

    it('extracts table name from UPDATE', () => {
      const tables = extractTableNames('UPDATE event_rsvps SET rsvp_status = ? WHERE id = ?');

      expect(tables.has('event_rsvps')).toBe(true);
    });

    it('extracts table name from JOIN', () => {
      const tables = extractTableNames(
        'SELECT t.* FROM task_delegations t JOIN contacts c ON t.contact_id = c.id',
      );

      expect(tables.has('task_delegations')).toBe(true);
      expect(tables.has('contacts')).toBe(true);
    });

    it('extracts table names case-insensitively and normalizes to lowercase', () => {
      const tables = extractTableNames('SELECT * FROM FAQ_ENTRIES');

      expect(tables.has('faq_entries')).toBe(true);
    });

    it('extracts table name from CREATE TABLE', () => {
      const tables = extractTableNames('CREATE TABLE evil_table (id INTEGER)');

      expect(tables.has('evil_table')).toBe(true);
    });
  });

  // ─── Allowed reads ────────────────────────────────────────────────────

  describe('allowed read operations', () => {
    it('allows SELECT from task_delegations', () => {
      const proxy = createPartyWaveDbProxy(db, 'task-delegation', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM task_delegations').all();
      }).not.toThrow();
    });

    it('allows SELECT from faq_entries', () => {
      const proxy = createPartyWaveDbProxy(db, 'faq-responder', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM faq_entries').all();
      }).not.toThrow();
    });

    it('allows SELECT from event_rsvps', () => {
      const proxy = createPartyWaveDbProxy(db, 'event-rsvp', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM event_rsvps').all();
      }).not.toThrow();
    });

    it('allows SELECT from contacts', () => {
      const proxy = createPartyWaveDbProxy(db, 'contact-share', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT id, name FROM contacts').all();
      }).not.toThrow();
    });

    it('allows SELECT from party_wave_settings', () => {
      const proxy = createPartyWaveDbProxy(db, 'test-wave', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM party_wave_settings').all();
      }).not.toThrow();
    });
  });

  // ─── Allowed writes ───────────────────────────────────────────────────

  describe('allowed write operations', () => {
    it('allows INSERT into task_delegations', () => {
      const proxy = createPartyWaveDbProxy(db, 'task-delegation', 'contact-1');

      // First create a contact so the foreign key is satisfied
      db.prepare(
        `INSERT INTO contacts (id, name, trust_level) VALUES (?, ?, ?)`,
      ).run('contact-1', 'Alice', 'trusted');

      expect(() => {
        proxy.prepare(
          `INSERT INTO task_delegations (id, contact_id, title) VALUES (?, ?, ?)`,
        ).run('td-1', 'contact-1', 'Test Task');
      }).not.toThrow();
    });

    it('allows UPDATE on faq_entries', () => {
      const proxy = createPartyWaveDbProxy(db, 'faq-responder', 'contact-1');

      // Insert a test entry directly
      db.prepare(
        `INSERT INTO faq_entries (id, question, answer) VALUES (?, ?, ?)`,
      ).run('faq-1', 'What time?', '9 AM');

      expect(() => {
        proxy.prepare(
          `UPDATE faq_entries SET access_count = access_count + 1 WHERE id = ?`,
        ).run('faq-1');
      }).not.toThrow();
    });
  });

  // ─── Blocked table reads ──────────────────────────────────────────────

  describe('blocked read operations', () => {
    it('blocks SELECT from conversation_logs', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM conversation_logs');
      }).toThrow(/cannot access table "conversation_logs"/i);
    });

    it('blocks SELECT from knowledge', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM knowledge');
      }).toThrow(/cannot access table "knowledge"/i);
    });

    it('blocks SELECT from user_profile', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM user_profile');
      }).toThrow(/cannot access table "user_profile"/i);
    });

    it('blocks SELECT from config_store', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM config_store');
      }).toThrow(/cannot access table "config_store"/i);
    });

    it('blocks SELECT from security_log', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM security_log');
      }).toThrow(/cannot access table "security_log"/i);
    });

    it('blocks SELECT from api_keys', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM api_keys');
      }).toThrow(/cannot access table "api_keys"/i);
    });

    it('blocks SELECT from token_usage', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('SELECT * FROM token_usage');
      }).toThrow(/cannot access table "token_usage"/i);
    });
  });

  // ─── Blocked DELETE ───────────────────────────────────────────────────

  describe('blocked DELETE', () => {
    it('blocks DELETE even on allowed write tables', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('DELETE FROM task_delegations WHERE id = ?');
      }).toThrow(/cannot delete/i);
    });

    it('blocks DELETE on any table', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('DELETE FROM faq_entries');
      }).toThrow(/cannot delete/i);
    });
  });

  // ─── Blocked DDL ──────────────────────────────────────────────────────

  describe('blocked DDL', () => {
    it('blocks CREATE TABLE', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('CREATE TABLE evil_table (id INTEGER PRIMARY KEY)');
      }).toThrow(/only execute SELECT, INSERT, UPDATE/i);
    });

    it('blocks ALTER TABLE', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('ALTER TABLE faq_entries ADD COLUMN malicious TEXT');
      }).toThrow(/only execute SELECT, INSERT, UPDATE/i);
    });

    it('blocks DROP TABLE', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('DROP TABLE faq_entries');
      }).toThrow(/only execute SELECT, INSERT, UPDATE/i);
    });
  });

  // ─── Tables not on any allowlist ──────────────────────────────────────

  describe('unknown tables (not on any list)', () => {
    it('blocks writes to a read-only allowed table like contacts', () => {
      const proxy = createPartyWaveDbProxy(db, 'evil-wave', 'contact-1');

      expect(() => {
        proxy.prepare('INSERT INTO contacts (id, name) VALUES (?, ?)');
      }).toThrow(/cannot write to table "contacts"/i);
    });
  });

  // ─── Accessor functions ───────────────────────────────────────────────

  describe('accessor functions', () => {
    it('getAllowedReadTables returns the correct set', () => {
      const readTables = getAllowedReadTables();

      expect(readTables).toBeInstanceOf(Set);
      expect(readTables.has('task_delegations')).toBe(true);
      expect(readTables.has('faq_entries')).toBe(true);
      expect(readTables.has('event_rsvps')).toBe(true);
      expect(readTables.has('document_requests')).toBe(true);
      expect(readTables.has('party_wave_settings')).toBe(true);
      expect(readTables.has('contacts')).toBe(true);
      expect(readTables.has('contact_profiles')).toBe(true);
      expect(readTables.has('waves_registry')).toBe(true);
      expect(readTables.has('wave_categories')).toBe(true);
    });

    it('getAllowedWriteTables returns the correct set', () => {
      const writeTables = getAllowedWriteTables();

      expect(writeTables).toBeInstanceOf(Set);
      expect(writeTables.has('task_delegations')).toBe(true);
      expect(writeTables.has('faq_entries')).toBe(true);
      expect(writeTables.has('event_rsvps')).toBe(true);
      expect(writeTables.has('document_requests')).toBe(true);
      // Should NOT include read-only tables
      expect(writeTables.has('contacts')).toBe(false);
      expect(writeTables.has('party_wave_settings')).toBe(false);
    });

    it('getBlockedTables returns all blocked table names', () => {
      const blockedTables = getBlockedTables();

      expect(blockedTables).toBeInstanceOf(Set);
      const expectedBlocked = [
        'conversation_logs', 'conversations', 'knowledge',
        'knowledge_embeddings', 'knowledge_fts', 'user_profile',
        'config_store', 'security_log', 'approval_queue',
        'token_usage', 'tasks', 'api_keys', 'oauth_tokens', 'cron_jobs',
      ];
      for (const table of expectedBlocked) {
        expect(blockedTables.has(table)).toBe(true);
      }
      expect(blockedTables.size).toBe(expectedBlocked.length);
    });
  });
});
