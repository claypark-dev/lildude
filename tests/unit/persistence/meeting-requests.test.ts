import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createMeetingRequest,
  getMeetingRequest,
  listMeetingRequests,
  approveMeetingRequest,
  declineMeetingRequest,
  countPendingMeetingRequests,
  getMeetingRequestsByContact,
} from '../../../src/persistence/meeting-requests.js';
import { createContact } from '../../../src/persistence/contacts.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = ['001_initial.sql', '009_contacts.sql', '010_contact_profiles.sql', '011_external_waves.sql'];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('meeting requests', () => {
  let db: Database.Database;
  let contactId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const contact = createContact(db, { name: 'Alice', trustLevel: 'trusted' });
    contactId = contact.id;
  });

  afterEach(() => {
    db.close();
  });

  describe('createMeetingRequest', () => {
    it('creates a request with defaults', () => {
      const req = createMeetingRequest(db, {
        contactId,
        subject: 'Project Review',
      });

      expect(req.id).toMatch(/^mtg_/);
      expect(req.contactId).toBe(contactId);
      expect(req.subject).toBe('Project Review');
      expect(req.durationMinutes).toBe(30);
      expect(req.status).toBe('pending');
      expect(req.proposedTime).toBeNull();
      expect(req.message).toBeNull();
      expect(req.createdAt).toBeInstanceOf(Date);
    });

    it('creates a request with all fields', () => {
      const req = createMeetingRequest(db, {
        contactId,
        subject: 'Strategy Session',
        proposedTime: 'Tuesday at 2pm',
        durationMinutes: 60,
        message: 'Looking forward to this!',
      });

      expect(req.proposedTime).toBe('Tuesday at 2pm');
      expect(req.durationMinutes).toBe(60);
      expect(req.message).toBe('Looking forward to this!');
    });
  });

  describe('getMeetingRequest', () => {
    it('retrieves a request by ID', () => {
      const created = createMeetingRequest(db, { contactId, subject: 'Test' });
      const fetched = getMeetingRequest(db, created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.subject).toBe('Test');
    });

    it('returns null for unknown ID', () => {
      expect(getMeetingRequest(db, 'mtg_nonexistent')).toBeNull();
    });
  });

  describe('listMeetingRequests', () => {
    it('lists requests most recent first', () => {
      createMeetingRequest(db, { contactId, subject: 'First' });
      createMeetingRequest(db, { contactId, subject: 'Second' });
      createMeetingRequest(db, { contactId, subject: 'Third' });

      const requests = listMeetingRequests(db);
      expect(requests).toHaveLength(3);
      expect(requests[0].subject).toBe('Third');
    });

    it('filters by status', () => {
      const req1 = createMeetingRequest(db, { contactId, subject: 'Approved' });
      createMeetingRequest(db, { contactId, subject: 'Pending' });
      approveMeetingRequest(db, req1.id);

      const pending = listMeetingRequests(db, 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].subject).toBe('Pending');
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        createMeetingRequest(db, { contactId, subject: `Meeting ${i}` });
      }

      const limited = listMeetingRequests(db, undefined, 3);
      expect(limited).toHaveLength(3);
    });
  });

  describe('approveMeetingRequest', () => {
    it('approves a request', () => {
      const req = createMeetingRequest(db, { contactId, subject: 'Approve me' });
      approveMeetingRequest(db, req.id, 'See you then!');

      const updated = getMeetingRequest(db, req.id);
      expect(updated!.status).toBe('approved');
      expect(updated!.ownerResponse).toBe('See you then!');
      expect(updated!.respondedAt).toBeInstanceOf(Date);
    });

    it('approves without response message', () => {
      const req = createMeetingRequest(db, { contactId, subject: 'Quick' });
      approveMeetingRequest(db, req.id);

      const updated = getMeetingRequest(db, req.id);
      expect(updated!.status).toBe('approved');
      expect(updated!.ownerResponse).toBeNull();
    });
  });

  describe('declineMeetingRequest', () => {
    it('declines a request', () => {
      const req = createMeetingRequest(db, { contactId, subject: 'Decline me' });
      declineMeetingRequest(db, req.id, 'Sorry, not available.');

      const updated = getMeetingRequest(db, req.id);
      expect(updated!.status).toBe('declined');
      expect(updated!.ownerResponse).toBe('Sorry, not available.');
      expect(updated!.respondedAt).toBeInstanceOf(Date);
    });
  });

  describe('countPendingMeetingRequests', () => {
    it('returns 0 when no requests', () => {
      expect(countPendingMeetingRequests(db)).toBe(0);
    });

    it('counts only pending requests', () => {
      const req1 = createMeetingRequest(db, { contactId, subject: 'One' });
      createMeetingRequest(db, { contactId, subject: 'Two' });
      createMeetingRequest(db, { contactId, subject: 'Three' });
      approveMeetingRequest(db, req1.id);

      expect(countPendingMeetingRequests(db)).toBe(2);
    });
  });

  describe('getMeetingRequestsByContact', () => {
    it('returns requests for a specific contact', () => {
      const contact2 = createContact(db, { name: 'Bob' });

      createMeetingRequest(db, { contactId, subject: 'From Alice' });
      createMeetingRequest(db, { contactId: contact2.id, subject: 'From Bob' });

      const aliceRequests = getMeetingRequestsByContact(db, contactId);
      expect(aliceRequests).toHaveLength(1);
      expect(aliceRequests[0].subject).toBe('From Alice');
    });

    it('returns empty for contact with no requests', () => {
      const contact2 = createContact(db, { name: 'Bob' });
      expect(getMeetingRequestsByContact(db, contact2.id)).toEqual([]);
    });
  });
});
