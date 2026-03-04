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
import { createModuleLogger } from '../../utils/logger.js';
import type { PerContactConfig } from '../../persistence/party-wave-settings.js';

const partyWaveApiLogger = createModuleLogger('party-waves-api');

/**
 * Register party wave management REST API routes.
 * @param app - The Fastify instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerPartyWaveRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  // ── List all party waves with settings ──────────────────────────────
  app.get('/api/v1/party-waves', async (_request, reply) => {
    try {
      const settings = listPartyWaveSettings(db);
      return reply.send({ partyWaves: settings });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      partyWaveApiLogger.error({ error: message }, 'Failed to list party wave settings');
      return reply.status(500).send({ error: 'Failed to list party wave settings' } as never);
    }
  });

  // ── Get a single party wave setting ─────────────────────────────────
  app.get<{
    Params: { name: string };
  }>('/api/v1/party-waves/:name', async (request, reply) => {
    try {
      const setting = getPartyWaveSetting(db, request.params.name);
      if (!setting) {
        return reply.status(404).send({ error: 'Party wave setting not found' });
      }
      return reply.send(setting);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      partyWaveApiLogger.error({ error: message }, 'Failed to get party wave setting');
      return reply.status(500).send({ error: 'Failed to get party wave setting' } as never);
    }
  });

  // ── Toggle a party wave ─────────────────────────────────────────────
  app.put<{
    Params: { name: string };
    Body: { enabled: boolean };
  }>('/api/v1/party-waves/:name/toggle', async (request, reply) => {
    try {
      const { name } = request.params;
      const { enabled } = request.body;

      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({ error: 'enabled must be a boolean' });
      }

      togglePartyWave(db, name, enabled);
      const updated = getPartyWaveSetting(db, name);
      return reply.send(updated);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      partyWaveApiLogger.error({ error: message }, 'Failed to toggle party wave');
      return reply.status(500).send({ error: 'Failed to toggle party wave' } as never);
    }
  });

  // ── Get per-contact config for a party wave ─────────────────────────
  app.get<{
    Params: { name: string; contactId: string };
  }>('/api/v1/party-waves/:name/contacts/:contactId', async (request, reply) => {
    try {
      const { name, contactId } = request.params;
      const config = getPerContactConfig(db, name, contactId);
      return reply.send({ config: config || {} });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      partyWaveApiLogger.error({ error: message }, 'Failed to get per-contact config');
      return reply.status(500).send({ error: 'Failed to get per-contact config' } as never);
    }
  });

  // ── Update per-contact config for a party wave ──────────────────────
  app.put<{
    Params: { name: string; contactId: string };
    Body: PerContactConfig;
  }>('/api/v1/party-waves/:name/contacts/:contactId', async (request, reply) => {
    try {
      const { name, contactId } = request.params;
      const config = request.body;

      if (!config || typeof config !== 'object') {
        return reply.status(400).send({ error: 'Config must be an object' });
      }

      updatePerContactConfig(db, name, contactId, { ...config, contactId });
      return reply.send({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      partyWaveApiLogger.error({ error: message }, 'Failed to update per-contact config');
      return reply.status(500).send({ error: 'Failed to update per-contact config' } as never);
    }
  });

  // ── Party wave usage stats ──────────────────────────────────────────
  app.get('/api/v1/party-waves/stats', async (_request, reply) => {
    try {
      const taskDelegationsPending = countTaskDelegations(db, 'pending');
      const taskDelegationsTotal = countTaskDelegations(db);
      const documentRequestsPending = countDocumentRequests(db, 'pending');
      const documentRequestsTotal = countDocumentRequests(db);
      const faqEntries = listFaqEntries(db, undefined, false, 1000);
      const recentRsvps = listEventRsvps(db, undefined, 10);
      const recentTasks = listTaskDelegations(db, undefined, 10);
      const recentDocRequests = listDocumentRequests(db, undefined, 10);

      return reply.send({
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      partyWaveApiLogger.error({ error: message }, 'Failed to get party wave stats');
      return reply.status(500).send({ error: 'Failed to get party wave stats' } as never);
    }
  });
}
