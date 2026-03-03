/**
 * REST API routes for contact management.
 * GET/POST/PUT/DELETE /api/v1/contacts and related endpoints.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import {
  createContact,
  getContact,
  updateContact,
  deleteContact,
  listContacts,
  getFavoriteContacts,
  searchContacts,
  countContacts,
} from '../../persistence/contacts.js';
import { appendSecurityLog } from '../../persistence/security-log.js';
import { canChangeTrustLevel } from '../../contacts/permissions.js';
import type { TrustLevel, CreateContactInput, UpdateContactInput } from '../../types/index.js';

/**
 * Register contact management REST API routes.
 * @param app - The Fastify instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerContactRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  // ── List contacts ────────────────────────────────────────────────────
  app.get<{
    Querystring: { trustLevel?: TrustLevel; limit?: string; offset?: string };
  }>('/api/v1/contacts', async (request, reply) => {
    const { trustLevel, limit, offset } = request.query;
    const contacts = listContacts(
      db,
      trustLevel,
      limit ? parseInt(limit, 10) : 100,
      offset ? parseInt(offset, 10) : 0,
    );
    const total = countContacts(db, trustLevel);
    reply.send({ contacts, total });
  });

  // ── Get favorites ────────────────────────────────────────────────────
  app.get('/api/v1/contacts/favorites', async (_request, reply) => {
    const contacts = getFavoriteContacts(db);
    reply.send({ contacts });
  });

  // ── Search contacts ──────────────────────────────────────────────────
  app.get<{
    Querystring: { q: string };
  }>('/api/v1/contacts/search', async (request, reply) => {
    const { q } = request.query;
    if (!q || q.trim().length === 0) {
      reply.status(400).send({ error: 'Search query (q) is required' });
      return;
    }
    const contacts = searchContacts(db, q.trim());
    reply.send({ contacts });
  });

  // ── Get single contact ──────────────────────────────────────────────
  app.get<{
    Params: { id: string };
  }>('/api/v1/contacts/:id', async (request, reply) => {
    const contact = getContact(db, request.params.id);
    if (!contact) {
      reply.status(404).send({ error: 'Contact not found' });
      return;
    }
    reply.send(contact);
  });

  // ── Create contact ──────────────────────────────────────────────────
  app.post<{
    Body: CreateContactInput;
  }>('/api/v1/contacts', async (request, reply) => {
    const input = request.body;
    if (!input.name || input.name.trim().length === 0) {
      reply.status(400).send({ error: 'Contact name is required' });
      return;
    }

    // Cannot create an owner contact via API
    if (input.trustLevel === 'owner') {
      reply.status(400).send({ error: 'Cannot create a contact with owner trust level' });
      return;
    }

    const contact = createContact(db, input);

    appendSecurityLog(db, {
      actionType: 'contact_created',
      actionDetail: `Contact "${contact.name}" created with trust level: ${contact.trustLevel}`,
      allowed: true,
      securityLevel: 3,
    });

    reply.status(201).send(contact);
  });

  // ── Update contact ──────────────────────────────────────────────────
  app.put<{
    Params: { id: string };
    Body: UpdateContactInput;
  }>('/api/v1/contacts/:id', async (request, reply) => {
    const existing = getContact(db, request.params.id);
    if (!existing) {
      reply.status(404).send({ error: 'Contact not found' });
      return;
    }

    const input = request.body;

    // Validate trust level changes
    if (input.trustLevel !== undefined && input.trustLevel !== existing.trustLevel) {
      const permission = canChangeTrustLevel(
        existing.trustLevel,
        input.trustLevel,
        true, // API calls are from owner (authenticated via bearer token)
      );
      if (!permission.allowed) {
        appendSecurityLog(db, {
          actionType: 'trust_level_change_denied',
          actionDetail: `Denied: ${existing.trustLevel} -> ${input.trustLevel} for "${existing.name}": ${permission.reason}`,
          allowed: false,
          securityLevel: 3,
        });
        reply.status(403).send({ error: permission.reason });
        return;
      }

      // Log trust level change
      appendSecurityLog(db, {
        actionType: 'trust_level_changed',
        actionDetail: `Contact "${existing.name}" trust level: ${existing.trustLevel} -> ${input.trustLevel}`,
        allowed: true,
        securityLevel: 3,
      });
    }

    const updated = updateContact(db, request.params.id, input);
    reply.send(updated);
  });

  // ── Delete contact ──────────────────────────────────────────────────
  app.delete<{
    Params: { id: string };
  }>('/api/v1/contacts/:id', async (request, reply) => {
    const existing = getContact(db, request.params.id);
    if (!existing) {
      reply.status(404).send({ error: 'Contact not found' });
      return;
    }

    if (existing.trustLevel === 'owner') {
      reply.status(403).send({ error: 'Cannot delete the owner contact' });
      return;
    }

    deleteContact(db, request.params.id);

    appendSecurityLog(db, {
      actionType: 'contact_deleted',
      actionDetail: `Contact "${existing.name}" (${existing.trustLevel}) deleted`,
      allowed: true,
      securityLevel: 3,
    });

    reply.status(204).send();
  });
}
