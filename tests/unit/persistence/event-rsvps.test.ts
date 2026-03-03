import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createEventRsvp,
  getEventRsvp,
  listEventRsvps,
  updateRsvpStatus,
  getRsvpsByContact,
  countRsvpsByEvent,
} from '../../../src/persistence/event-rsvps.js';
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

describe('event rsvps', () => {
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

  describe('createEventRsvp', () => {
    it('creates an RSVP with defaults', () => {
      const rsvp = createEventRsvp(db, {
        contactId,
        eventName: 'Annual Meetup 2026',
      });

      expect(rsvp.id).toMatch(/^rsvp_/);
      expect(rsvp.contactId).toBe(contactId);
      expect(rsvp.eventName).toBe('Annual Meetup 2026');
      expect(rsvp.eventDate).toBeNull();
      expect(rsvp.rsvpStatus).toBe('pending');
      expect(rsvp.message).toBeNull();
      expect(rsvp.createdAt).toBeInstanceOf(Date);
      expect(rsvp.updatedAt).toBeInstanceOf(Date);
    });

    it('creates an RSVP with a status', () => {
      const rsvp = createEventRsvp(db, {
        contactId,
        eventName: 'Team Lunch',
        rsvpStatus: 'attending',
      });

      expect(rsvp.rsvpStatus).toBe('attending');
    });

    it('creates an RSVP with a message', () => {
      const rsvp = createEventRsvp(db, {
        contactId,
        eventName: 'Product Launch',
        rsvpStatus: 'maybe',
        message: 'Will try to make it but not 100% sure yet.',
      });

      expect(rsvp.message).toBe('Will try to make it but not 100% sure yet.');
      expect(rsvp.rsvpStatus).toBe('maybe');
    });
  });

  describe('getEventRsvp', () => {
    it('retrieves an RSVP by ID', () => {
      const created = createEventRsvp(db, { contactId, eventName: 'Hackathon' });
      const fetched = getEventRsvp(db, created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.eventName).toBe('Hackathon');
    });

    it('returns null for unknown ID', () => {
      expect(getEventRsvp(db, 'rsvp_nonexistent')).toBeNull();
    });
  });

  describe('listEventRsvps', () => {
    it('returns all RSVPs most recent first', () => {
      createEventRsvp(db, { contactId, eventName: 'Event A' });
      createEventRsvp(db, { contactId, eventName: 'Event B' });
      createEventRsvp(db, { contactId, eventName: 'Event C' });

      const rsvps = listEventRsvps(db);
      expect(rsvps).toHaveLength(3);
      expect(rsvps[0].eventName).toBe('Event C');
    });

    it('filters by event name', () => {
      createEventRsvp(db, { contactId, eventName: 'Conference 2026' });
      createEventRsvp(db, { contactId, eventName: 'Workshop' });
      createEventRsvp(db, { contactId, eventName: 'Conference 2026' });

      const rsvps = listEventRsvps(db, 'Conference 2026');
      expect(rsvps).toHaveLength(2);
      expect(rsvps.every((r) => r.eventName === 'Conference 2026')).toBe(true);
    });
  });

  describe('updateRsvpStatus', () => {
    it('changes the RSVP status', () => {
      const rsvp = createEventRsvp(db, { contactId, eventName: 'Sprint Demo' });
      expect(rsvp.rsvpStatus).toBe('pending');

      updateRsvpStatus(db, rsvp.id, 'attending');

      const updated = getEventRsvp(db, rsvp.id);
      expect(updated!.rsvpStatus).toBe('attending');
    });
  });

  describe('getRsvpsByContact', () => {
    it('returns RSVPs for a specific contact', () => {
      const contact2 = createContact(db, { name: 'Bob' });

      createEventRsvp(db, { contactId, eventName: 'Event for Alice' });
      createEventRsvp(db, { contactId: contact2.id, eventName: 'Event for Bob' });
      createEventRsvp(db, { contactId, eventName: 'Another event for Alice' });

      const aliceRsvps = getRsvpsByContact(db, contactId);
      expect(aliceRsvps).toHaveLength(2);
      expect(aliceRsvps.every((r) => r.contactId === contactId)).toBe(true);
    });

    it('returns empty array for contact with no RSVPs', () => {
      const contact2 = createContact(db, { name: 'Bob' });
      expect(getRsvpsByContact(db, contact2.id)).toEqual([]);
    });
  });

  describe('countRsvpsByEvent', () => {
    it('counts RSVPs per status for a given event', () => {
      const contact2 = createContact(db, { name: 'Bob' });
      const contact3 = createContact(db, { name: 'Carol' });

      createEventRsvp(db, { contactId, eventName: 'Big Party', rsvpStatus: 'attending' });
      createEventRsvp(db, { contactId: contact2.id, eventName: 'Big Party', rsvpStatus: 'attending' });
      createEventRsvp(db, { contactId: contact3.id, eventName: 'Big Party', rsvpStatus: 'declined' });

      const counts = countRsvpsByEvent(db, 'Big Party');
      expect(counts.attending).toBe(2);
      expect(counts.declined).toBe(1);
      expect(counts.pending).toBe(0);
      expect(counts.maybe).toBe(0);
    });

    it('returns all zeros for an event with no RSVPs', () => {
      const counts = countRsvpsByEvent(db, 'Unknown Event');
      expect(counts).toEqual({ pending: 0, attending: 0, declined: 0, maybe: 0 });
    });
  });
});
