/**
 * Tests for API route error handling (Sprint 18C audit fix).
 * Ensures all API routes properly catch errors and return structured JSON responses.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerContactRoutes } from '../../../src/gateway/api/contacts.js';
import { registerActivityRoutes } from '../../../src/gateway/api/activity.js';
import { registerPartyWaveRoutes } from '../../../src/gateway/api/party-waves.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '002_routing_history.sql',
    '003_waves_foundation.sql',
    '009_contacts.sql',
    '010_contact_profiles.sql',
    '011_external_waves.sql',
    '012_contact_groups.sql',
    '013_party_waves.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('API route error handling', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    app = Fastify({ logger: false });
    registerContactRoutes(app, db);
    registerActivityRoutes(app, db);
    registerPartyWaveRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  describe('contacts API error handling', () => {
    it('GET /api/v1/contacts returns 500 with JSON error on DB failure', async () => {
      // Close db to simulate a failure
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/contacts',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
      expect(typeof body.error).toBe('string');
    });

    it('GET /api/v1/contacts/favorites returns 500 with JSON error on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/contacts/favorites',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('GET /api/v1/contacts/search returns 500 with JSON error on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/contacts/search?q=test',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('GET /api/v1/contacts/:id returns 500 with JSON error on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/contacts/some-id',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('POST /api/v1/contacts returns 500 with JSON error on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { name: 'Test User', trustLevel: 'known' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('PUT /api/v1/contacts/:id returns 500 with JSON error on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/contacts/some-id',
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('DELETE /api/v1/contacts/:id returns 500 with JSON error on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/contacts/some-id',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('returns proper 400 errors for validation failures', async () => {
      // Missing name
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { name: '', trustLevel: 'known' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('name');
    });

    it('returns 400 when trying to create owner-level contact', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/contacts',
        payload: { name: 'Hacker', trustLevel: 'owner' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('owner');
    });
  });

  describe('activity API error handling', () => {
    it('GET /api/v1/contacts/:id/activity returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/contacts/some-id/activity',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('GET /api/v1/activity/external returns graceful fallback on DB failure', async () => {
      // getExternalActivitySummary catches errors internally and returns zero-state
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/activity/external',
      });

      // The DAL function returns a safe default — this is correct defensive behavior
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { totalExternalMessages: number };
      expect(body.totalExternalMessages).toBe(0);
    });

    it('GET /api/v1/groups returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/groups',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('POST /api/v1/groups returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/groups',
        payload: { name: 'Test Group' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('GET /api/v1/contacts/:id/notifications returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/contacts/some-id/notifications',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('GET /api/v1/notifications returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });
  });

  describe('party-waves API error handling', () => {
    it('GET /api/v1/party-waves returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('GET /api/v1/party-waves/:name returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/auto-responder',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('PUT /api/v1/party-waves/:name/toggle returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/party-waves/auto-responder/toggle',
        payload: { enabled: false },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('GET /api/v1/party-waves/stats returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/stats',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('GET /api/v1/party-waves/:name/contacts/:id returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/auto-responder/contacts/c1',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('PUT /api/v1/party-waves/:name/contacts/:id returns 500 on DB failure', async () => {
      db.close();

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/party-waves/auto-responder/contacts/c1',
        payload: { enabled: true },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBeDefined();
    });
  });
});
