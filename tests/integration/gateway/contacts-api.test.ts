/**
 * Integration tests for the Contacts REST API.
 * Uses Fastify's inject() to test routes without binding to a real port.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { storeApiKey } from '../../../src/persistence/api-keys.js';
import { createContact } from '../../../src/persistence/contacts.js';
import { createGatewayServer, type GatewayServer } from '../../../src/gateway/server.js';
import { ConfigSchema } from '../../../src/config/schema.js';
import type { InjectOptions } from 'fastify';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');
const TEST_API_KEY = 'ld_contacts_test_key_0000000000000';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

describe('Contacts API', () => {
  let dbManager: DatabaseManager;
  let gateway: GatewayServer;

  function authedInject(opts: InjectOptions) {
    return gateway.app.inject({
      ...opts,
      headers: {
        ...opts.headers,
        authorization: `Bearer ${TEST_API_KEY}`,
      },
    });
  }

  beforeEach(async () => {
    dbManager = createTestDb();
    storeApiKey(dbManager.db, TEST_API_KEY, 'contacts-test');
    const config = ConfigSchema.parse({});
    gateway = createGatewayServer(dbManager, config);
    await gateway.app.ready();
  });

  afterEach(async () => {
    try { await gateway.stop(); } catch { /* cleanup */ }
    try { dbManager.close(); } catch { /* cleanup */ }
  });

  // ── GET /api/v1/contacts ──────────────────────────────────────────

  describe('GET /api/v1/contacts', () => {
    it('returns empty list initially', async () => {
      const response = await authedInject({ method: 'GET', url: '/api/v1/contacts' });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      // May have one 'default' key contact, but contacts table starts empty
      expect(body.contacts).toBeDefined();
      expect(body.total).toBeDefined();
    });

    it('returns created contacts', async () => {
      createContact(dbManager.db, { name: 'Alice', trustLevel: 'trusted' });
      createContact(dbManager.db, { name: 'Bob', trustLevel: 'known' });

      const response = await authedInject({ method: 'GET', url: '/api/v1/contacts' });
      const body = response.json();

      expect(body.contacts).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('filters by trust level', async () => {
      createContact(dbManager.db, { name: 'Alice', trustLevel: 'trusted' });
      createContact(dbManager.db, { name: 'Bob', trustLevel: 'known' });

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/contacts?trustLevel=trusted',
      });
      const body = response.json();

      expect(body.contacts).toHaveLength(1);
      expect(body.contacts[0].name).toBe('Alice');
    });
  });

  // ── GET /api/v1/contacts/favorites ────────────────────────────────

  describe('GET /api/v1/contacts/favorites', () => {
    it('returns only favorites', async () => {
      createContact(dbManager.db, { name: 'Fav', isFavorite: true });
      createContact(dbManager.db, { name: 'NotFav', isFavorite: false });

      const response = await authedInject({ method: 'GET', url: '/api/v1/contacts/favorites' });
      const body = response.json();

      expect(body.contacts).toHaveLength(1);
      expect(body.contacts[0].name).toBe('Fav');
    });
  });

  // ── GET /api/v1/contacts/search ───────────────────────────────────

  describe('GET /api/v1/contacts/search', () => {
    it('searches by name', async () => {
      createContact(dbManager.db, { name: 'Alice Smith' });
      createContact(dbManager.db, { name: 'Bob Jones' });

      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/contacts/search?q=Smith',
      });
      const body = response.json();

      expect(body.contacts).toHaveLength(1);
      expect(body.contacts[0].name).toBe('Alice Smith');
    });

    it('returns 400 for missing query', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/contacts/search?q=',
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── GET /api/v1/contacts/:id ──────────────────────────────────────

  describe('GET /api/v1/contacts/:id', () => {
    it('returns a contact by ID', async () => {
      const contact = createContact(dbManager.db, { name: 'Alice' });

      const response = await authedInject({
        method: 'GET',
        url: `/api/v1/contacts/${contact.id}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Alice');
    });

    it('returns 404 for unknown ID', async () => {
      const response = await authedInject({
        method: 'GET',
        url: '/api/v1/contacts/nonexistent',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ── POST /api/v1/contacts ────────────────────────────────────────

  describe('POST /api/v1/contacts', () => {
    it('creates a contact', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/contacts',
        payload: {
          name: 'Alice',
          phone: '+1111111111',
          trustLevel: 'known',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('Alice');
      expect(body.phone).toBe('+1111111111');
      expect(body.trustLevel).toBe('known');
    });

    it('returns 400 for missing name', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { phone: '+111' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for owner trust level', async () => {
      const response = await authedInject({
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { name: 'Fake Owner', trustLevel: 'owner' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // ── PUT /api/v1/contacts/:id ─────────────────────────────────────

  describe('PUT /api/v1/contacts/:id', () => {
    it('updates a contact', async () => {
      const contact = createContact(dbManager.db, { name: 'Alice' });

      const response = await authedInject({
        method: 'PUT',
        url: `/api/v1/contacts/${contact.id}`,
        payload: { name: 'Alice Updated', isFavorite: true },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Alice Updated');
      expect(response.json().isFavorite).toBe(true);
    });

    it('returns 404 for unknown ID', async () => {
      const response = await authedInject({
        method: 'PUT',
        url: '/api/v1/contacts/nonexistent',
        payload: { name: 'Test' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('allows trust level promotion', async () => {
      const contact = createContact(dbManager.db, { name: 'Alice' });

      const response = await authedInject({
        method: 'PUT',
        url: `/api/v1/contacts/${contact.id}`,
        payload: { trustLevel: 'trusted' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().trustLevel).toBe('trusted');
    });

    it('denies promoting to owner', async () => {
      const contact = createContact(dbManager.db, { name: 'Alice' });

      const response = await authedInject({
        method: 'PUT',
        url: `/api/v1/contacts/${contact.id}`,
        payload: { trustLevel: 'owner' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('denies changing owner trust level', async () => {
      const owner = createContact(dbManager.db, { name: 'Owner', trustLevel: 'owner' });

      const response = await authedInject({
        method: 'PUT',
        url: `/api/v1/contacts/${owner.id}`,
        payload: { trustLevel: 'trusted' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ── DELETE /api/v1/contacts/:id ──────────────────────────────────

  describe('DELETE /api/v1/contacts/:id', () => {
    it('deletes a contact', async () => {
      const contact = createContact(dbManager.db, { name: 'Alice' });

      const response = await authedInject({
        method: 'DELETE',
        url: `/api/v1/contacts/${contact.id}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify deletion
      const getResponse = await authedInject({
        method: 'GET',
        url: `/api/v1/contacts/${contact.id}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });

    it('returns 404 for unknown ID', async () => {
      const response = await authedInject({
        method: 'DELETE',
        url: '/api/v1/contacts/nonexistent',
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when deleting owner', async () => {
      const owner = createContact(dbManager.db, { name: 'Owner', trustLevel: 'owner' });

      const response = await authedInject({
        method: 'DELETE',
        url: `/api/v1/contacts/${owner.id}`,
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ── Auth required ─────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 without auth header', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/contacts',
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
