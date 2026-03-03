import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDocumentRequest,
  getDocumentRequest,
  listDocumentRequests,
  approveDocumentRequest,
  declineDocumentRequest,
  getDocumentRequestsByContact,
  countDocumentRequests,
} from '../../../src/persistence/document-requests.js';
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

describe('document requests', () => {
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

  describe('createDocumentRequest', () => {
    it('creates a document request with defaults', () => {
      const request = createDocumentRequest(db, {
        contactId,
        documentName: 'Q1 Financial Report',
      });

      expect(request.id).toMatch(/^doc_/);
      expect(request.contactId).toBe(contactId);
      expect(request.documentName).toBe('Q1 Financial Report');
      expect(request.reason).toBeNull();
      expect(request.status).toBe('pending');
      expect(request.createdAt).toBeInstanceOf(Date);
      expect(request.respondedAt).toBeNull();
    });

    it('creates a document request with a reason', () => {
      const request = createDocumentRequest(db, {
        contactId,
        documentName: 'NDA Template',
        reason: 'Needed before onboarding new vendor.',
      });

      expect(request.reason).toBe('Needed before onboarding new vendor.');
    });
  });

  describe('getDocumentRequest', () => {
    it('retrieves a document request by ID', () => {
      const created = createDocumentRequest(db, { contactId, documentName: 'Privacy Policy' });
      const fetched = getDocumentRequest(db, created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.documentName).toBe('Privacy Policy');
    });

    it('returns null for unknown ID', () => {
      expect(getDocumentRequest(db, 'doc_nonexistent')).toBeNull();
    });
  });

  describe('listDocumentRequests', () => {
    it('returns all document requests most recent first', () => {
      createDocumentRequest(db, { contactId, documentName: 'Doc A' });
      createDocumentRequest(db, { contactId, documentName: 'Doc B' });
      createDocumentRequest(db, { contactId, documentName: 'Doc C' });

      const requests = listDocumentRequests(db);
      expect(requests).toHaveLength(3);
      expect(requests[0].documentName).toBe('Doc C');
    });

    it('filters by status', () => {
      const req1 = createDocumentRequest(db, { contactId, documentName: 'Approved Doc' });
      createDocumentRequest(db, { contactId, documentName: 'Pending Doc' });
      approveDocumentRequest(db, req1.id);

      const approved = listDocumentRequests(db, 'approved');
      expect(approved).toHaveLength(1);
      expect(approved[0].documentName).toBe('Approved Doc');

      const pending = listDocumentRequests(db, 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].documentName).toBe('Pending Doc');
    });
  });

  describe('approveDocumentRequest', () => {
    it('updates status to approved and sets respondedAt', () => {
      const request = createDocumentRequest(db, { contactId, documentName: 'Contract Draft' });
      approveDocumentRequest(db, request.id);

      const updated = getDocumentRequest(db, request.id);
      expect(updated!.status).toBe('approved');
      expect(updated!.respondedAt).toBeInstanceOf(Date);
    });
  });

  describe('declineDocumentRequest', () => {
    it('updates status to declined and sets respondedAt', () => {
      const request = createDocumentRequest(db, { contactId, documentName: 'Confidential Memo' });
      declineDocumentRequest(db, request.id);

      const updated = getDocumentRequest(db, request.id);
      expect(updated!.status).toBe('declined');
      expect(updated!.respondedAt).toBeInstanceOf(Date);
    });
  });

  describe('getDocumentRequestsByContact', () => {
    it('returns document requests from a specific contact', () => {
      const contact2 = createContact(db, { name: 'Bob' });

      createDocumentRequest(db, { contactId, documentName: 'Alice doc 1' });
      createDocumentRequest(db, { contactId: contact2.id, documentName: 'Bob doc' });
      createDocumentRequest(db, { contactId, documentName: 'Alice doc 2' });

      const aliceRequests = getDocumentRequestsByContact(db, contactId);
      expect(aliceRequests).toHaveLength(2);
      expect(aliceRequests.every((r) => r.contactId === contactId)).toBe(true);
    });

    it('returns empty array for contact with no document requests', () => {
      const contact2 = createContact(db, { name: 'Bob' });
      expect(getDocumentRequestsByContact(db, contact2.id)).toEqual([]);
    });
  });

  describe('countDocumentRequests', () => {
    it('returns 0 when no requests exist', () => {
      expect(countDocumentRequests(db)).toBe(0);
    });

    it('counts all document requests', () => {
      createDocumentRequest(db, { contactId, documentName: 'Doc A' });
      createDocumentRequest(db, { contactId, documentName: 'Doc B' });

      expect(countDocumentRequests(db)).toBe(2);
    });

    it('counts by status', () => {
      const req1 = createDocumentRequest(db, { contactId, documentName: 'Doc A' });
      const req2 = createDocumentRequest(db, { contactId, documentName: 'Doc B' });
      createDocumentRequest(db, { contactId, documentName: 'Doc C' });
      approveDocumentRequest(db, req1.id);
      declineDocumentRequest(db, req2.id);

      expect(countDocumentRequests(db, 'pending')).toBe(1);
      expect(countDocumentRequests(db, 'approved')).toBe(1);
      expect(countDocumentRequests(db, 'declined')).toBe(1);
    });
  });
});
