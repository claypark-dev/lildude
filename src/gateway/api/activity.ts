/**
 * REST API routes for contact activity, groups, and notifications.
 * Provides the data endpoints for the multi-user dashboard.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { getContactActivity, getExternalActivitySummary } from '../../contacts/activity.js';
import {
  getNotificationPrefs,
  updateNotificationPrefs,
  listCustomNotificationPrefs,
  type UpdateNotificationPrefsInput,
} from '../../contacts/notifications.js';
import {
  createContactGroup,
  getContactGroup,
  listContactGroups,
  updateContactGroup,
  deleteContactGroup,
  addContactToGroup,
  removeContactFromGroup,
  getGroupsForContact,
} from '../../persistence/contact-groups.js';
import { getContact } from '../../persistence/contacts.js';
import { createModuleLogger } from '../../utils/logger.js';

const activityApiLogger = createModuleLogger('activity-api');

/**
 * Register activity, groups, and notification REST API routes.
 * @param app - The Fastify instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerActivityRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  // ── Contact Activity ──────────────────────────────────────────────────

  /** Get activity metrics for a specific contact. */
  app.get<{
    Params: { id: string };
  }>('/api/v1/contacts/:id/activity', async (request, reply) => {
    try {
      const contact = getContact(db, request.params.id);
      if (!contact) {
        return reply.status(404).send({ error: 'Contact not found' });
      }
      const activity = getContactActivity(db, request.params.id);
      return reply.send(activity);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to get contact activity');
      return reply.status(500).send({ error: 'Failed to get contact activity' } as never);
    }
  });

  /** Get external activity summary for the dashboard. */
  app.get<{
    Querystring: { limit?: string };
  }>('/api/v1/activity/external', async (request, reply) => {
    try {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
      const summary = getExternalActivitySummary(db, limit);
      return reply.send(summary);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to get external activity summary');
      return reply.status(500).send({ error: 'Failed to get external activity summary' } as never);
    }
  });

  // ── Contact Groups ────────────────────────────────────────────────────

  /** List all contact groups. */
  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>('/api/v1/groups', async (request, reply) => {
    try {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
      const offset = request.query.offset ? parseInt(request.query.offset, 10) : 0;
      const groups = listContactGroups(db, limit, offset);
      return reply.send({ groups });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to list contact groups');
      return reply.status(500).send({ error: 'Failed to list contact groups' } as never);
    }
  });

  /** Get a single contact group. */
  app.get<{
    Params: { id: string };
  }>('/api/v1/groups/:id', async (request, reply) => {
    try {
      const group = getContactGroup(db, request.params.id);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }
      return reply.send(group);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to get contact group');
      return reply.status(500).send({ error: 'Failed to get contact group' } as never);
    }
  });

  /** Create a new contact group. */
  app.post<{
    Body: { name: string; description?: string; contactIds?: string[]; color?: string };
  }>('/api/v1/groups', async (request, reply) => {
    try {
      const { name, description, contactIds, color } = request.body;
      if (!name || name.trim().length === 0) {
        return reply.status(400).send({ error: 'Group name is required' });
      }
      const group = createContactGroup(db, { name: name.trim(), description, contactIds, color });
      return reply.status(201).send(group);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to create contact group');
      return reply.status(500).send({ error: 'Failed to create contact group' } as never);
    }
  });

  /** Update a contact group. */
  app.put<{
    Params: { id: string };
    Body: { name?: string; description?: string; contactIds?: string[]; color?: string };
  }>('/api/v1/groups/:id', async (request, reply) => {
    try {
      const existing = getContactGroup(db, request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: 'Group not found' });
      }
      const updated = updateContactGroup(db, request.params.id, request.body);
      return reply.send(updated);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to update contact group');
      return reply.status(500).send({ error: 'Failed to update contact group' } as never);
    }
  });

  /** Delete a contact group. */
  app.delete<{
    Params: { id: string };
  }>('/api/v1/groups/:id', async (request, reply) => {
    try {
      const existing = getContactGroup(db, request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: 'Group not found' });
      }
      deleteContactGroup(db, request.params.id);
      return reply.status(204).send();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to delete contact group');
      return reply.status(500).send({ error: 'Failed to delete contact group' } as never);
    }
  });

  /** Add a contact to a group. */
  app.post<{
    Params: { id: string };
    Body: { contactId: string };
  }>('/api/v1/groups/:id/contacts', async (request, reply) => {
    try {
      const { contactId } = request.body;
      if (!contactId) {
        return reply.status(400).send({ error: 'contactId is required' });
      }
      const group = addContactToGroup(db, request.params.id, contactId);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }
      return reply.send(group);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to add contact to group');
      return reply.status(500).send({ error: 'Failed to add contact to group' } as never);
    }
  });

  /** Remove a contact from a group. */
  app.delete<{
    Params: { id: string; contactId: string };
  }>('/api/v1/groups/:id/contacts/:contactId', async (request, reply) => {
    try {
      const group = removeContactFromGroup(db, request.params.id, request.params.contactId);
      if (!group) {
        return reply.status(404).send({ error: 'Group not found' });
      }
      return reply.send(group);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to remove contact from group');
      return reply.status(500).send({ error: 'Failed to remove contact from group' } as never);
    }
  });

  /** Get all groups a contact belongs to. */
  app.get<{
    Params: { id: string };
  }>('/api/v1/contacts/:id/groups', async (request, reply) => {
    try {
      const contact = getContact(db, request.params.id);
      if (!contact) {
        return reply.status(404).send({ error: 'Contact not found' });
      }
      const groups = getGroupsForContact(db, request.params.id);
      return reply.send({ groups });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to get groups for contact');
      return reply.status(500).send({ error: 'Failed to get groups for contact' } as never);
    }
  });

  // ── Notification Preferences ──────────────────────────────────────────

  /** Get notification preferences for a contact. */
  app.get<{
    Params: { id: string };
  }>('/api/v1/contacts/:id/notifications', async (request, reply) => {
    try {
      const contact = getContact(db, request.params.id);
      if (!contact) {
        return reply.status(404).send({ error: 'Contact not found' });
      }
      const prefs = getNotificationPrefs(db, request.params.id);
      return reply.send(prefs);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to get notification preferences');
      return reply.status(500).send({ error: 'Failed to get notification preferences' } as never);
    }
  });

  /** Update notification preferences for a contact. */
  app.put<{
    Params: { id: string };
    Body: UpdateNotificationPrefsInput;
  }>('/api/v1/contacts/:id/notifications', async (request, reply) => {
    try {
      const contact = getContact(db, request.params.id);
      if (!contact) {
        return reply.status(404).send({ error: 'Contact not found' });
      }
      const prefs = updateNotificationPrefs(db, request.params.id, request.body);
      return reply.send(prefs);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to update notification preferences');
      return reply.status(500).send({ error: 'Failed to update notification preferences' } as never);
    }
  });

  /** List all contacts with custom notification preferences. */
  app.get('/api/v1/notifications', async (_request, reply) => {
    try {
      const prefs = listCustomNotificationPrefs(db);
      return reply.send({ notifications: prefs });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      activityApiLogger.error({ error: message }, 'Failed to list notification preferences');
      return reply.status(500).send({ error: 'Failed to list notification preferences' } as never);
    }
  });
}
