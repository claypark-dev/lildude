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
    const contact = getContact(db, request.params.id);
    if (!contact) {
      reply.status(404).send({ error: 'Contact not found' });
      return;
    }
    const activity = getContactActivity(db, request.params.id);
    reply.send(activity);
  });

  /** Get external activity summary for the dashboard. */
  app.get<{
    Querystring: { limit?: string };
  }>('/api/v1/activity/external', async (request, reply) => {
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
    const summary = getExternalActivitySummary(db, limit);
    reply.send(summary);
  });

  // ── Contact Groups ────────────────────────────────────────────────────

  /** List all contact groups. */
  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>('/api/v1/groups', async (request, reply) => {
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
    const offset = request.query.offset ? parseInt(request.query.offset, 10) : 0;
    const groups = listContactGroups(db, limit, offset);
    reply.send({ groups });
  });

  /** Get a single contact group. */
  app.get<{
    Params: { id: string };
  }>('/api/v1/groups/:id', async (request, reply) => {
    const group = getContactGroup(db, request.params.id);
    if (!group) {
      reply.status(404).send({ error: 'Group not found' });
      return;
    }
    reply.send(group);
  });

  /** Create a new contact group. */
  app.post<{
    Body: { name: string; description?: string; contactIds?: string[]; color?: string };
  }>('/api/v1/groups', async (request, reply) => {
    const { name, description, contactIds, color } = request.body;
    if (!name || name.trim().length === 0) {
      reply.status(400).send({ error: 'Group name is required' });
      return;
    }
    const group = createContactGroup(db, { name: name.trim(), description, contactIds, color });
    reply.status(201).send(group);
  });

  /** Update a contact group. */
  app.put<{
    Params: { id: string };
    Body: { name?: string; description?: string; contactIds?: string[]; color?: string };
  }>('/api/v1/groups/:id', async (request, reply) => {
    const existing = getContactGroup(db, request.params.id);
    if (!existing) {
      reply.status(404).send({ error: 'Group not found' });
      return;
    }
    const updated = updateContactGroup(db, request.params.id, request.body);
    reply.send(updated);
  });

  /** Delete a contact group. */
  app.delete<{
    Params: { id: string };
  }>('/api/v1/groups/:id', async (request, reply) => {
    const existing = getContactGroup(db, request.params.id);
    if (!existing) {
      reply.status(404).send({ error: 'Group not found' });
      return;
    }
    deleteContactGroup(db, request.params.id);
    reply.status(204).send();
  });

  /** Add a contact to a group. */
  app.post<{
    Params: { id: string };
    Body: { contactId: string };
  }>('/api/v1/groups/:id/contacts', async (request, reply) => {
    const { contactId } = request.body;
    if (!contactId) {
      reply.status(400).send({ error: 'contactId is required' });
      return;
    }
    const group = addContactToGroup(db, request.params.id, contactId);
    if (!group) {
      reply.status(404).send({ error: 'Group not found' });
      return;
    }
    reply.send(group);
  });

  /** Remove a contact from a group. */
  app.delete<{
    Params: { id: string; contactId: string };
  }>('/api/v1/groups/:id/contacts/:contactId', async (request, reply) => {
    const group = removeContactFromGroup(db, request.params.id, request.params.contactId);
    if (!group) {
      reply.status(404).send({ error: 'Group not found' });
      return;
    }
    reply.send(group);
  });

  /** Get all groups a contact belongs to. */
  app.get<{
    Params: { id: string };
  }>('/api/v1/contacts/:id/groups', async (request, reply) => {
    const contact = getContact(db, request.params.id);
    if (!contact) {
      reply.status(404).send({ error: 'Contact not found' });
      return;
    }
    const groups = getGroupsForContact(db, request.params.id);
    reply.send({ groups });
  });

  // ── Notification Preferences ──────────────────────────────────────────

  /** Get notification preferences for a contact. */
  app.get<{
    Params: { id: string };
  }>('/api/v1/contacts/:id/notifications', async (request, reply) => {
    const contact = getContact(db, request.params.id);
    if (!contact) {
      reply.status(404).send({ error: 'Contact not found' });
      return;
    }
    const prefs = getNotificationPrefs(db, request.params.id);
    reply.send(prefs);
  });

  /** Update notification preferences for a contact. */
  app.put<{
    Params: { id: string };
    Body: UpdateNotificationPrefsInput;
  }>('/api/v1/contacts/:id/notifications', async (request, reply) => {
    const contact = getContact(db, request.params.id);
    if (!contact) {
      reply.status(404).send({ error: 'Contact not found' });
      return;
    }
    const prefs = updateNotificationPrefs(db, request.params.id, request.body);
    reply.send(prefs);
  });

  /** List all contacts with custom notification preferences. */
  app.get('/api/v1/notifications', async (_request, reply) => {
    const prefs = listCustomNotificationPrefs(db);
    reply.send({ notifications: prefs });
  });
}
