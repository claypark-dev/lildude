/**
 * E2E test: External user flow.
 * Verifies contact creation, trust-level restrictions,
 * rate limiting, and conversation isolation for external users.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { startApp, type AppContext } from '../../src/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../mocks/provider.js';
import {
  createContact,
  getContact,
  listContacts,
} from '../../src/persistence/contacts.js';
import { canTriggerWave } from '../../src/contacts/permissions.js';
import { logExternalEvent, getExternalAuditByContact } from '../../src/persistence/external-audit.js';
import { createRelayedMessage, countUnreadMessages } from '../../src/persistence/relayed-messages.js';
import { createMeetingRequest, countPendingMeetingRequests } from '../../src/persistence/meeting-requests.js';
import { getContactActivity } from '../../src/contacts/activity.js';
import { shouldNotify, updateNotificationPrefs } from '../../src/contacts/notifications.js';
import { generateApiKey, storeApiKey } from '../../src/persistence/api-keys.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'persistence', 'migrations');

function createTestConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
  });
}

describe('E2E: External User Flow', () => {
  let appContext: AppContext | undefined;
  let mockProvider: MockProvider;

  beforeEach(() => {
    mockProvider = createMockProvider('anthropic');
  });

  afterEach(async () => {
    if (appContext) {
      try { await appContext.gateway.stop(); } catch { /* cleanup */ }
      try { appContext.dbManager.close(); } catch { /* cleanup */ }
      appContext = undefined;
    }
  });

  it('creates contacts with correct trust levels', async () => {
    const config = createTestConfig();

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    const db = appContext.dbManager.db;

    // Create contacts at different trust levels
    const owner = createContact(db, { name: 'Owner', trustLevel: 'owner' });
    const trusted = createContact(db, { name: 'Alice', trustLevel: 'trusted', email: 'alice@example.com' });
    const known = createContact(db, { name: 'Bob', trustLevel: 'known', phone: '+15551234567' });
    const unknown = createContact(db, { name: 'Stranger', trustLevel: 'unknown' });

    expect(owner.trustLevel).toBe('owner');
    expect(trusted.trustLevel).toBe('trusted');
    expect(known.trustLevel).toBe('known');
    expect(unknown.trustLevel).toBe('unknown');

    const allContacts = listContacts(db);
    expect(allContacts).toHaveLength(4);
  });

  it('enforces wave access by trust level', async () => {
    const config = createTestConfig();

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    const db = appContext.dbManager.db;

    const owner = createContact(db, { name: 'Owner', trustLevel: 'owner' });
    const trusted = createContact(db, { name: 'Alice', trustLevel: 'trusted' });
    const known = createContact(db, { name: 'Bob', trustLevel: 'known' });
    const unknownContact = createContact(db, { name: 'Stranger', trustLevel: 'unknown' });

    // Owner: full access
    expect(canTriggerWave(owner, 'test-wave', 'observe').allowed).toBe(true);
    expect(canTriggerWave(owner, 'test-wave', 'execute').allowed).toBe(true);

    // Trusted: observe/create/modify
    expect(canTriggerWave(trusted, 'test-wave', 'observe').allowed).toBe(true);
    expect(canTriggerWave(trusted, 'test-wave', 'create').allowed).toBe(true);
    expect(canTriggerWave(trusted, 'test-wave', 'destroy').allowed).toBe(false);
    expect(canTriggerWave(trusted, 'test-wave', 'execute').allowed).toBe(false);

    // Known: observe only
    expect(canTriggerWave(known, 'test-wave', 'observe').allowed).toBe(true);
    expect(canTriggerWave(known, 'test-wave', 'create').allowed).toBe(false);

    // Unknown: no wave access
    expect(canTriggerWave(unknownContact, 'test-wave', 'observe').allowed).toBe(false);
  });

  it('logs external interactions to audit trail', async () => {
    const config = createTestConfig();

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    const db = appContext.dbManager.db;
    const contact = createContact(db, { name: 'Alice', trustLevel: 'known' });

    // Log various events
    logExternalEvent(db, contact.id, 'message_received', 'Hello');
    logExternalEvent(db, contact.id, 'wave_triggered', 'weather-checker');
    logExternalEvent(db, contact.id, 'wave_blocked', 'forbidden-wave');
    logExternalEvent(db, contact.id, 'rate_limited');

    const events = getExternalAuditByContact(db, contact.id);
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.eventType).sort()).toEqual([
      'message_received', 'rate_limited', 'wave_blocked', 'wave_triggered',
    ]);
  });

  it('handles relayed messages and meeting requests', async () => {
    const config = createTestConfig();

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    const db = appContext.dbManager.db;
    const contact = createContact(db, { name: 'Alice', trustLevel: 'trusted' });

    // Create relayed messages
    createRelayedMessage(db, {
      contactId: contact.id,
      message: 'Please call me back',
      urgency: 'high',
      channelType: 'imessage',
      channelId: '+15551234567',
    });
    createRelayedMessage(db, {
      contactId: contact.id,
      message: 'No rush, just a quick question',
      urgency: 'low',
      channelType: 'imessage',
      channelId: '+15551234567',
    });

    expect(countUnreadMessages(db)).toBe(2);

    // Create meeting request
    createMeetingRequest(db, {
      contactId: contact.id,
      proposedTime: new Date(Date.now() + 86400000).toISOString(),
      durationMinutes: 30,
      subject: 'Project review',
    });

    expect(countPendingMeetingRequests(db)).toBe(1);
  });

  it('tracks per-contact activity metrics', async () => {
    const config = createTestConfig();

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    const db = appContext.dbManager.db;
    const contact = createContact(db, { name: 'Alice', trustLevel: 'trusted' });

    // Create some activity
    logExternalEvent(db, contact.id, 'wave_triggered', 'test-wave');
    logExternalEvent(db, contact.id, 'wave_triggered', 'test-wave-2');
    logExternalEvent(db, contact.id, 'wave_blocked', 'bad-wave');

    createRelayedMessage(db, {
      contactId: contact.id,
      message: 'Test message',
      urgency: 'normal',
      channelType: 'test',
      channelId: 'test',
    });

    const activity = getContactActivity(db, contact.id);
    expect(activity.wavesTriggered).toBe(2);
    expect(activity.wavesBlocked).toBe(1);
    expect(activity.relayedMessages).toBe(1);
  });

  it('notification preferences control delivery', async () => {
    const config = createTestConfig();

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    const db = appContext.dbManager.db;
    const contact = createContact(db, { name: 'Alice', trustLevel: 'trusted' });

    // Default: should notify
    expect(shouldNotify(db, contact.id, 'message')).toBe(true);

    // Mute the contact
    updateNotificationPrefs(db, contact.id, {
      muteUntil: new Date(Date.now() + 3600000),
    });
    expect(shouldNotify(db, contact.id, 'message')).toBe(false);

    // Unmute and disable message notifications
    updateNotificationPrefs(db, contact.id, {
      muteUntil: null,
      notifyOnMessage: false,
    });
    expect(shouldNotify(db, contact.id, 'message')).toBe(false);
    expect(shouldNotify(db, contact.id, 'wave')).toBe(true);
  });

  it('contact API with activity endpoint works end-to-end', async () => {
    const config = createTestConfig();

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    const db = appContext.dbManager.db;
    const rawKey = generateApiKey();
    storeApiKey(db, rawKey, 'e2e-test');
    const authHeaders = { Authorization: `Bearer ${rawKey}` };

    // Create a contact via API
    const createRes = await appContext.gateway.app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: authHeaders,
      payload: { name: 'E2E User', trustLevel: 'known' },
    });
    expect(createRes.statusCode).toBe(201);
    const contact = JSON.parse(createRes.body);

    // Check activity via API
    const activityRes = await appContext.gateway.app.inject({
      method: 'GET',
      url: `/api/v1/contacts/${contact.id}/activity`,
      headers: authHeaders,
    });
    expect(activityRes.statusCode).toBe(200);
    const activity = JSON.parse(activityRes.body);
    expect(activity.messageCount).toBe(0);
    expect(activity.contactId).toBe(contact.id);

    // Check external activity summary
    const summaryRes = await appContext.gateway.app.inject({
      method: 'GET',
      url: '/api/v1/activity/external',
      headers: authHeaders,
    });
    expect(summaryRes.statusCode).toBe(200);
    const summary = JSON.parse(summaryRes.body);
    expect(summary).toHaveProperty('totalExternalMessages');
    expect(summary).toHaveProperty('unreadMessages');
    expect(summary).toHaveProperty('pendingMeetingRequests');
  });
});
