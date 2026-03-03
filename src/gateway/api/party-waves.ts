/**
 * REST API routes for party wave management.
 * GET/PUT /api/v1/party-waves — list, toggle, per-contact config, stats.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import {
  listPartyWaveSettings,
  getPartyWaveSetting,
  togglePartyWave,
  getPerContactConfig,
  updatePerContactConfig,
} from '../../persistence/party-wave-settings.js';
import {
  listTaskDelegations,
  countTaskDelegations,
} from '../../persistence/task-delegations.js';
import {
  listFaqEntries,
} from '../../persistence/faq-entries.js';
import {
  listEventRsvps,
} from '../../persistence/event-rsvps.js';
import {
  listDocumentRequests,
  countDocumentRequests,
} from '../../persistence/document-requests.js';
import type { PerContactConfig } from '../../persistence/party-wave-settings.js';

/**
 * Register party wave management REST API routes.
 * @param app - The Fastify instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerPartyWaveRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  // ── List all party waves with settings ──────────────────────────────
  app.get('/api/v1/party-waves', async (_request, reply) => {
    const settings = listPartyWaveSettings(db);
    reply.send({ partyWaves: settings });
  });

  // ── Get a single party wave setting ─────────────────────────────────
  app.get<{
    Params: { name: string };
  }>('/api/v1/party-waves/:name', async (request, reply) => {
    const setting = getPartyWaveSetting(db, request.params.name);
    if (!setting) {
      reply.status(404).send({ error: 'Party wave setting not found' });
      return;
    }
    reply.send(setting);
  });

  // ── Toggle a party wave ─────────────────────────────────────────────
  app.put<{
    Params: { name: string };
    Body: { enabled: boolean };
  }>('/api/v1/party-waves/:name/toggle', async (request, reply) => {
    const { name } = request.params;
    const { enabled } = request.body;

    if (typeof enabled !== 'boolean') {
      reply.status(400).send({ error: 'enabled must be a boolean' });
      return;
    }

    togglePartyWave(db, name, enabled);
    const updated = getPartyWaveSetting(db, name);
    reply.send(updated);
  });

  // ── Get per-contact config for a party wave ─────────────────────────
  app.get<{
    Params: { name: string; contactId: string };
  }>('/api/v1/party-waves/:name/contacts/:contactId', async (request, reply) => {
    const { name, contactId } = request.params;
    const config = getPerContactConfig(db, name, contactId);
    reply.send({ config: config || {} });
  });

  // ── Update per-contact config for a party wave ──────────────────────
  app.put<{
    Params: { name: string; contactId: string };
    Body: PerContactConfig;
  }>('/api/v1/party-waves/:name/contacts/:contactId', async (request, reply) => {
    const { name, contactId } = request.params;
    const config = request.body;

    if (!config || typeof config !== 'object') {
      reply.status(400).send({ error: 'Config must be an object' });
      return;
    }

    updatePerContactConfig(db, name, contactId, { ...config, contactId });
    reply.send({ success: true });
  });

  // ── Party wave usage stats ──────────────────────────────────────────
  app.get('/api/v1/party-waves/stats', async (_request, reply) => {
    const taskDelegationsPending = countTaskDelegations(db, 'pending');
    const taskDelegationsTotal = countTaskDelegations(db);
    const documentRequestsPending = countDocumentRequests(db, 'pending');
    const documentRequestsTotal = countDocumentRequests(db);
    const faqEntries = listFaqEntries(db, undefined, false, 1000);
    const recentRsvps = listEventRsvps(db, undefined, 10);
    const recentTasks = listTaskDelegations(db, undefined, 10);
    const recentDocRequests = listDocumentRequests(db, undefined, 10);

    reply.send({
      stats: {
        taskDelegations: {
          pending: taskDelegationsPending,
          total: taskDelegationsTotal,
        },
        documentRequests: {
          pending: documentRequestsPending,
          total: documentRequestsTotal,
        },
        faqEntries: {
          total: faqEntries.length,
          enabled: faqEntries.filter((f) => f.enabled).length,
        },
        recentActivity: {
          rsvps: recentRsvps.length,
          tasks: recentTasks.length,
          documentRequests: recentDocRequests.length,
        },
      },
    });
  });
}
