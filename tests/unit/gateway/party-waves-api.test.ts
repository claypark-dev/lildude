/**
 * Tests for the party waves REST API routes.
 * Covers list, get, toggle, per-contact config, and stats endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerPartyWaveRoutes } from '../../../src/gateway/api/party-waves.js';

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

/** The 9 party waves seeded by migration 013. */
const SEEDED_WAVE_NAMES = [
  'auto-responder',
  'availability-check',
  'contact-share',
  'document-request',
  'event-rsvp',
  'faq-responder',
  'meeting-request',
  'message-relay',
  'task-delegation',
];

describe('party waves API', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);

    app = Fastify({ logger: false });
    registerPartyWaveRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  // ── GET /api/v1/party-waves ────────────────────────────────────

  describe('GET /api/v1/party-waves', () => {
    it('returns 200 with a list of party wave settings', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { partyWaves: unknown[] };
      expect(Array.isArray(body.partyWaves)).toBe(true);
    });

    it('returns all 9 seeded party waves', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { partyWaves: Array<{ waveName: string }> };
      expect(body.partyWaves).toHaveLength(9);
    });

    it('returns all expected wave names', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves',
      });

      const body = JSON.parse(response.body) as { partyWaves: Array<{ waveName: string }> };
      const names = body.partyWaves.map((w) => w.waveName).sort();
      expect(names).toEqual(SEEDED_WAVE_NAMES);
    });

    it('returns waves with enabled property', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves',
      });

      const body = JSON.parse(response.body) as { partyWaves: Array<{ enabled: boolean }> };
      for (const wave of body.partyWaves) {
        expect(typeof wave.enabled).toBe('boolean');
      }
    });
  });

  // ── GET /api/v1/party-waves/:name ─────────────────────────────

  describe('GET /api/v1/party-waves/:name', () => {
    it('returns 200 with the setting for a known wave', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/auto-responder',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { waveName: string; enabled: boolean };
      expect(body.waveName).toBe('auto-responder');
      expect(body.enabled).toBe(true);
    });

    it('returns 200 for task-delegation wave', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/task-delegation',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { waveName: string };
      expect(body.waveName).toBe('task-delegation');
    });

    it('returns 404 for an unknown wave name', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/nonexistent-wave',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Party wave setting not found');
    });
  });

  // ── PUT /api/v1/party-waves/:name/toggle ──────────────────────

  describe('PUT /api/v1/party-waves/:name/toggle', () => {
    it('disables an enabled wave', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/party-waves/auto-responder/toggle',
        payload: { enabled: false },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { waveName: string; enabled: boolean };
      expect(body.waveName).toBe('auto-responder');
      expect(body.enabled).toBe(false);
    });

    it('re-enables a disabled wave', async () => {
      // First disable it
      await app.inject({
        method: 'PUT',
        url: '/api/v1/party-waves/faq-responder/toggle',
        payload: { enabled: false },
      });

      // Then re-enable it
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/party-waves/faq-responder/toggle',
        payload: { enabled: true },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { enabled: boolean };
      expect(body.enabled).toBe(true);
    });

    it('persists the toggled state on subsequent GET', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/v1/party-waves/meeting-request/toggle',
        payload: { enabled: false },
      });

      const getResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/meeting-request',
      });

      const body = JSON.parse(getResponse.body) as { enabled: boolean };
      expect(body.enabled).toBe(false);
    });

    it('rejects non-boolean enabled value', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/party-waves/auto-responder/toggle',
        payload: { enabled: 'yes' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('boolean');
    });
  });

  // ── GET /api/v1/party-waves/:name/contacts/:contactId ─────────

  describe('GET /api/v1/party-waves/:name/contacts/:contactId', () => {
    it('returns 200 with empty config for a contact with no per-contact config', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/auto-responder/contacts/contact_abc',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { config: Record<string, unknown> };
      expect(body.config).toEqual({});
    });
  });

  // ── PUT /api/v1/party-waves/:name/contacts/:contactId ─────────

  describe('PUT /api/v1/party-waves/:name/contacts/:contactId', () => {
    it('saves per-contact config and returns success', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/party-waves/task-delegation/contacts/contact_xyz',
        payload: { enabled: false, customMessage: 'No task delegation for this contact.' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('saves config and can be retrieved with GET', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/v1/party-waves/event-rsvp/contacts/contact_get_test',
        payload: { enabled: false, customMessage: 'RSVP not allowed from this contact.' },
      });

      const getResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/event-rsvp/contacts/contact_get_test',
      });

      expect(getResponse.statusCode).toBe(200);
      const body = JSON.parse(getResponse.body) as {
        config: { enabled: boolean; customMessage: string };
      };
      expect(body.config.enabled).toBe(false);
      expect(body.config.customMessage).toBe('RSVP not allowed from this contact.');
    });
  });

  // ── GET /api/v1/party-waves/stats ─────────────────────────────

  describe('GET /api/v1/party-waves/stats', () => {
    it('returns 200 with a stats object', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/stats',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { stats: Record<string, unknown> };
      expect(body.stats).toBeDefined();
    });

    it('stats includes taskDelegations counts', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/stats',
      });

      const body = JSON.parse(response.body) as {
        stats: { taskDelegations: { pending: number; total: number } };
      };
      expect(typeof body.stats.taskDelegations.pending).toBe('number');
      expect(typeof body.stats.taskDelegations.total).toBe('number');
    });

    it('stats includes documentRequests counts', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/stats',
      });

      const body = JSON.parse(response.body) as {
        stats: { documentRequests: { pending: number; total: number } };
      };
      expect(typeof body.stats.documentRequests.pending).toBe('number');
      expect(typeof body.stats.documentRequests.total).toBe('number');
    });

    it('stats includes faqEntries counts', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/stats',
      });

      const body = JSON.parse(response.body) as {
        stats: { faqEntries: { total: number; enabled: number } };
      };
      expect(typeof body.stats.faqEntries.total).toBe('number');
      expect(typeof body.stats.faqEntries.enabled).toBe('number');
    });

    it('stats includes recentActivity counts', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/stats',
      });

      const body = JSON.parse(response.body) as {
        stats: { recentActivity: { rsvps: number; tasks: number; documentRequests: number } };
      };
      expect(typeof body.stats.recentActivity.rsvps).toBe('number');
      expect(typeof body.stats.recentActivity.tasks).toBe('number');
      expect(typeof body.stats.recentActivity.documentRequests).toBe('number');
    });

    it('returns zero counts for an empty database', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/party-waves/stats',
      });

      const body = JSON.parse(response.body) as {
        stats: {
          taskDelegations: { pending: number; total: number };
          documentRequests: { pending: number; total: number };
          faqEntries: { total: number };
        };
      };
      expect(body.stats.taskDelegations.total).toBe(0);
      expect(body.stats.documentRequests.total).toBe(0);
      expect(body.stats.faqEntries.total).toBe(0);
    });
  });
});
