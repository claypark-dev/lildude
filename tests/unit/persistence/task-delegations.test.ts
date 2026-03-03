import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTaskDelegation,
  getTaskDelegation,
  listTaskDelegations,
  acceptTaskDelegation,
  declineTaskDelegation,
  completeTaskDelegation,
  countTaskDelegations,
  getTaskDelegationsByContact,
} from '../../../src/persistence/task-delegations.js';
import { createContact } from '../../../src/persistence/contacts.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '003_waves_foundation.sql',
    '009_contacts.sql',
    '010_contact_profiles.sql',
    '011_external_waves.sql',
    '013_party_waves.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('task delegations', () => {
  let db: Database.Database;
  let contactId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const contact = createContact(db, { name: 'Alice', trustLevel: 'known' });
    contactId = contact.id;
  });

  afterEach(() => {
    db.close();
  });

  describe('createTaskDelegation', () => {
    it('creates a task delegation with defaults', () => {
      const task = createTaskDelegation(db, { contactId, title: 'Book a flight' });

      expect(task.id).toMatch(/^task_/);
      expect(task.contactId).toBe(contactId);
      expect(task.title).toBe('Book a flight');
      expect(task.description).toBeNull();
      expect(task.priority).toBe('normal');
      expect(task.status).toBe('pending');
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.respondedAt).toBeNull();
    });

    it('creates a task delegation with priority', () => {
      const task = createTaskDelegation(db, {
        contactId,
        title: 'Fix the server',
        priority: 'urgent',
      });

      expect(task.priority).toBe('urgent');
    });

    it('creates a task delegation with description', () => {
      const task = createTaskDelegation(db, {
        contactId,
        title: 'Prepare report',
        description: 'Monthly revenue report for Q1',
      });

      expect(task.description).toBe('Monthly revenue report for Q1');
    });
  });

  describe('getTaskDelegation', () => {
    it('retrieves a task delegation by ID', () => {
      const created = createTaskDelegation(db, { contactId, title: 'Fetch groceries' });
      const fetched = getTaskDelegation(db, created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.title).toBe('Fetch groceries');
      expect(fetched!.id).toBe(created.id);
    });

    it('returns null for unknown ID', () => {
      expect(getTaskDelegation(db, 'task_nonexistent')).toBeNull();
    });
  });

  describe('listTaskDelegations', () => {
    it('returns all task delegations most recent first', () => {
      createTaskDelegation(db, { contactId, title: 'First task' });
      createTaskDelegation(db, { contactId, title: 'Second task' });
      createTaskDelegation(db, { contactId, title: 'Third task' });

      const tasks = listTaskDelegations(db);
      expect(tasks).toHaveLength(3);
      expect(tasks[0].title).toBe('Third task');
    });

    it('filters by status', () => {
      const task1 = createTaskDelegation(db, { contactId, title: 'Accepted task' });
      createTaskDelegation(db, { contactId, title: 'Pending task' });
      acceptTaskDelegation(db, task1.id);

      const accepted = listTaskDelegations(db, 'accepted');
      expect(accepted).toHaveLength(1);
      expect(accepted[0].title).toBe('Accepted task');

      const pending = listTaskDelegations(db, 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe('Pending task');
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        createTaskDelegation(db, { contactId, title: `Task ${i}` });
      }

      const limited = listTaskDelegations(db, undefined, 4);
      expect(limited).toHaveLength(4);
    });
  });

  describe('acceptTaskDelegation', () => {
    it('updates status to accepted and sets respondedAt', () => {
      const task = createTaskDelegation(db, { contactId, title: 'Please review this PR' });
      acceptTaskDelegation(db, task.id);

      const updated = getTaskDelegation(db, task.id);
      expect(updated!.status).toBe('accepted');
      expect(updated!.respondedAt).toBeInstanceOf(Date);
    });
  });

  describe('declineTaskDelegation', () => {
    it('updates status to declined', () => {
      const task = createTaskDelegation(db, { contactId, title: 'Organise filing' });
      declineTaskDelegation(db, task.id);

      const updated = getTaskDelegation(db, task.id);
      expect(updated!.status).toBe('declined');
      expect(updated!.respondedAt).toBeInstanceOf(Date);
    });
  });

  describe('completeTaskDelegation', () => {
    it('updates status to completed', () => {
      const task = createTaskDelegation(db, { contactId, title: 'Send invitations' });
      completeTaskDelegation(db, task.id);

      const updated = getTaskDelegation(db, task.id);
      expect(updated!.status).toBe('completed');
      expect(updated!.respondedAt).toBeInstanceOf(Date);
    });
  });

  describe('countTaskDelegations', () => {
    it('returns 0 when no tasks exist', () => {
      expect(countTaskDelegations(db)).toBe(0);
    });

    it('counts all task delegations', () => {
      createTaskDelegation(db, { contactId, title: 'Task A' });
      createTaskDelegation(db, { contactId, title: 'Task B' });
      createTaskDelegation(db, { contactId, title: 'Task C' });

      expect(countTaskDelegations(db)).toBe(3);
    });

    it('counts by status', () => {
      const task1 = createTaskDelegation(db, { contactId, title: 'Task A' });
      const task2 = createTaskDelegation(db, { contactId, title: 'Task B' });
      createTaskDelegation(db, { contactId, title: 'Task C' });
      acceptTaskDelegation(db, task1.id);
      declineTaskDelegation(db, task2.id);

      expect(countTaskDelegations(db, 'pending')).toBe(1);
      expect(countTaskDelegations(db, 'accepted')).toBe(1);
      expect(countTaskDelegations(db, 'declined')).toBe(1);
      expect(countTaskDelegations(db, 'completed')).toBe(0);
    });
  });

  describe('getTaskDelegationsByContact', () => {
    it('returns tasks delegated by a specific contact', () => {
      const contact2 = createContact(db, { name: 'Bob' });

      createTaskDelegation(db, { contactId, title: 'Alice task 1' });
      createTaskDelegation(db, { contactId: contact2.id, title: 'Bob task' });
      createTaskDelegation(db, { contactId, title: 'Alice task 2' });

      const aliceTasks = getTaskDelegationsByContact(db, contactId);
      expect(aliceTasks).toHaveLength(2);
      expect(aliceTasks.every((t) => t.contactId === contactId)).toBe(true);
    });

    it('returns empty array for contact with no delegations', () => {
      const contact2 = createContact(db, { name: 'Bob' });
      expect(getTaskDelegationsByContact(db, contact2.id)).toEqual([]);
    });
  });
});
