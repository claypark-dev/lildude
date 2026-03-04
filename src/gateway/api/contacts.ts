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
import { createModuleLogger } from '../../utils/logger.js';
import type { TrustLevel, CreateContactInput, UpdateContactInput } from '../../types/index.js';

const contactApiLogger = createModuleLogger('contacts-api');

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
    try {
      const { trustLevel, limit, offset } = request.query;
      const contacts = listContacts(
        db,
        trustLevel,
        limit ? parseInt(limit, 10) : 100,
        offset ? parseInt(offset, 10) : 0,
      );
      const total = countContacts(db, trustLevel);
      return reply.send({ contacts, total });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      contactApiLogger.error({ error: message }, 'Failed to list contacts');
      return reply.status(500).send({ error: 'Failed to list contacts' } as never);
    }
  });

  // ── Get favorites ────────────────────────────────────────────────────
  app.get('/api/v1/contacts/favorites', async (_request, reply) => {
    try {
      const contacts = getFavoriteContacts(db);
      return reply.send({ contacts });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      contactApiLogger.error({ error: message }, 'Failed to get favorite contacts');
      return reply.status(500).send({ error: 'Failed to get favorite contacts' } as never);
    }
  });

  // ── Search contacts ──────────────────────────────────────────────────
  app.get<{
    Querystring: { q: string };
  }>('/api/v1/contacts/search', async (request, reply) => {
    try {
      const { q } = request.query;
      if (!q || q.trim().length === 0) {
        return reply.status(400).send({ error: 'Search query (q) is required' });
      }
      const contacts = searchContacts(db, q.trim());
      return reply.send({ contacts });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      contactApiLogger.error({ error: message }, 'Failed to search contacts');
      return reply.status(500).send({ error: 'Failed to search contacts' } as never);
    }
  });

  // ── Get single contact ──────────────────────────────────────────────
  app.get<{
    Params: { id: string };
  }>('/api/v1/contacts/:id', async (request, reply) => {
    try {
      const contact = getContact(db, request.params.id);
      if (!contact) {
        return reply.status(404).send({ error: 'Contact not found' });
      }
      return reply.send(contact);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      contactApiLogger.error({ error: message }, 'Failed to get contact');
      return reply.status(500).send({ error: 'Failed to get contact' } as never);
    }
  });

  // ── Create contact ──────────────────────────────────────────────────
  app.post<{
    Body: CreateContactInput;
  }>('/api/v1/contacts', async (request, reply) => {
    try {
      const input = request.body;
      if (!input.name || input.name.trim().length === 0) {
        return reply.status(400).send({ error: 'Contact name is required' });
      }

      // Cannot create an owner contact via API
      if (input.trustLevel === 'owner') {
        return reply.status(400).send({ error: 'Cannot create a contact with owner trust level' });
      }

      const contact = createContact(db, input);

      appendSecurityLog(db, {
        actionType: 'contact_created',
        actionDetail: `Contact "${contact.name}" created with trust level: ${contact.trustLevel}`,
        allowed: true,
        securityLevel: 3,
      });

      return reply.status(201).send(contact);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      contactApiLogger.error({ error: message }, 'Failed to create contact');
      return reply.status(500).send({ error: 'Failed to create contact' } as never);
    }
  });

  // ── Update contact ──────────────────────────────────────────────────
  app.put<{
    Params: { id: string };
    Body: UpdateContactInput;
  }>('/api/v1/contacts/:id', async (request, reply) => {
    try {
      const existing = getContact(db, request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: 'Contact not found' });
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
          return reply.status(403).send({ error: permission.reason });
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
      return reply.send(updated);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      contactApiLogger.error({ error: message }, 'Failed to update contact');
      return reply.status(500).send({ error: 'Failed to update contact' } as never);
    }
  });

  // ── Delete contact ──────────────────────────────────────────────────
  app.delete<{
    Params: { id: string };
  }>('/api/v1/contacts/:id', async (request, reply) => {
    try {
      const existing = getContact(db, request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: 'Contact not found' });
      }

      if (existing.trustLevel === 'owner') {
        return reply.status(403).send({ error: 'Cannot delete the owner contact' });
      }

      deleteContact(db, request.params.id);

      appendSecurityLog(db, {
        actionType: 'contact_deleted',
        actionDetail: `Contact "${existing.name}" (${existing.trustLevel}) deleted`,
        allowed: true,
        securityLevel: 3,
      });

      return reply.status(204).send();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      contactApiLogger.error({ error: message }, 'Failed to delete contact');
      return reply.status(500).send({ error: 'Failed to delete contact' } as never);
    }
  });
}
