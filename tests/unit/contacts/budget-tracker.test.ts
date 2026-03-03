import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkContactBudget,
  getContactSpending,
} from '../../../src/contacts/budget-tracker.js';
import { createContact } from '../../../src/persistence/contacts.js';
import type { Contact } from '../../../src/types/index.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = ['001_initial.sql', '009_contacts.sql', '010_contact_profiles.sql'];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('contact budget tracker', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('checkContactBudget', () => {
    it('returns within budget for owner', () => {
      const owner = createContact(db, { name: 'Owner', trustLevel: 'owner', budgetCapUsd: 1.0 });
      const result = checkContactBudget(db, owner);

      expect(result.withinBudget).toBe(true);
      expect(result.remainingUsd).toBe(Infinity);
    });

    it('returns within budget when no cap set', () => {
      const contact = createContact(db, { name: 'Alice', budgetCapUsd: 0 });
      const result = checkContactBudget(db, contact);

      expect(result.withinBudget).toBe(true);
      expect(result.remainingUsd).toBe(Infinity);
    });

    it('returns within budget when no spending', () => {
      const contact = createContact(db, { name: 'Alice', budgetCapUsd: 5.0 });
      const result = checkContactBudget(db, contact);

      expect(result.withinBudget).toBe(true);
      expect(result.totalSpentUsd).toBe(0);
      expect(result.remainingUsd).toBe(5.0);
    });

    it('tracks spending through conversations', () => {
      const contact = createContact(db, { name: 'Alice', budgetCapUsd: 1.0, trustLevel: 'known' });

      // Create task, conversation linked to contact, and token usage
      db.prepare(
        `INSERT INTO tasks (id, status, type) VALUES ('task1', 'completed', 'chat')`,
      ).run();
      db.prepare(
        `INSERT INTO conversations (id, task_id, channel_type, channel_id, contact_id)
         VALUES ('conv1', 'task1', 'discord', 'ch1', ?)`,
      ).run(contact.id);
      db.prepare(
        `INSERT INTO token_usage (task_id, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, round_trip_number)
         VALUES ('task1', 'anthropic', 'haiku', 100, 50, 0, 0.50, 1)`,
      ).run();

      const result = checkContactBudget(db, contact);
      expect(result.withinBudget).toBe(true);
      expect(result.totalSpentUsd).toBe(0.50);
      expect(result.remainingUsd).toBe(0.50);
    });

    it('detects budget exceeded', () => {
      const contact = createContact(db, { name: 'Alice', budgetCapUsd: 0.5, trustLevel: 'known' });

      // Exceed budget
      db.prepare(
        `INSERT INTO tasks (id, status, type) VALUES ('task1', 'completed', 'chat')`,
      ).run();
      db.prepare(
        `INSERT INTO conversations (id, task_id, channel_type, channel_id, contact_id)
         VALUES ('conv1', 'task1', 'discord', 'ch1', ?)`,
      ).run(contact.id);
      db.prepare(
        `INSERT INTO token_usage (task_id, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, round_trip_number)
         VALUES ('task1', 'anthropic', 'sonnet', 1000, 500, 0, 0.75, 1)`,
      ).run();

      const result = checkContactBudget(db, contact);
      expect(result.withinBudget).toBe(false);
      expect(result.totalSpentUsd).toBe(0.75);
      expect(result.remainingUsd).toBe(0);
    });
  });

  describe('getContactSpending', () => {
    it('returns 0 when no spending', () => {
      const contact = createContact(db, { name: 'Alice' });
      expect(getContactSpending(db, contact.id)).toBe(0);
    });

    it('sums across multiple conversations', () => {
      const contact = createContact(db, { name: 'Alice' });

      db.prepare(`INSERT INTO tasks (id, status, type) VALUES ('t1', 'completed', 'chat')`).run();
      db.prepare(`INSERT INTO tasks (id, status, type) VALUES ('t2', 'completed', 'chat')`).run();
      db.prepare(
        `INSERT INTO conversations (id, task_id, channel_type, channel_id, contact_id)
         VALUES ('c1', 't1', 'discord', 'ch1', ?)`,
      ).run(contact.id);
      db.prepare(
        `INSERT INTO conversations (id, task_id, channel_type, channel_id, contact_id)
         VALUES ('c2', 't2', 'discord', 'ch1', ?)`,
      ).run(contact.id);
      db.prepare(
        `INSERT INTO token_usage (task_id, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, round_trip_number)
         VALUES ('t1', 'anthropic', 'haiku', 100, 50, 0, 0.10, 1)`,
      ).run();
      db.prepare(
        `INSERT INTO token_usage (task_id, provider, model, input_tokens, output_tokens, cached_tokens, cost_usd, round_trip_number)
         VALUES ('t2', 'anthropic', 'haiku', 200, 100, 0, 0.20, 1)`,
      ).run();

      expect(getContactSpending(db, contact.id)).toBeCloseTo(0.30);
    });
  });
});
