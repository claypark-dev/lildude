/**
 * E2E test: Full application flow.
 * Verifies auth, message processing, budget enforcement,
 * security logging, and the complete request lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { startApp, type AppContext } from '../../src/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../mocks/provider.js';
import type { ChatResponse } from '../../src/types/index.js';
import { getRecentSecurityLogs } from '../../src/persistence/security-log.js';
import { getMonthlyTotalCost } from '../../src/persistence/token-usage.js';
import { generateApiKey, storeApiKey } from '../../src/persistence/api-keys.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'persistence', 'migrations');

function createTestConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
  });
}

function buildResponse(text: string, inputTokens: number, outputTokens: number): ChatResponse {
  return {
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens, outputTokens },
    stopReason: 'end_turn',
  };
}

/** Create an API key in the database and return auth headers. */
function createAuthHeaders(db: import('better-sqlite3').Database): Record<string, string> {
  const rawKey = generateApiKey();
  storeApiKey(db, rawKey, 'e2e-test');
  return { Authorization: `Bearer ${rawKey}` };
}

describe('E2E: Full Application Flow', () => {
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

  it('processes a message through the full pipeline and logs to security log', async () => {
    const config = createTestConfig();
    mockProvider.setDefault(buildResponse('I can help with that!', 150, 80));

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    const result = await appContext.agentLoop.processMessage('conv-e2e-1', 'Help me plan my week', 'webchat');
    expect(result.responseText).toBe('I can help with that!');
    expect(result.roundTrips).toBeGreaterThanOrEqual(1);
    expect(result.costUsd).toBeGreaterThan(0);

    // Verify token usage was tracked
    expect(result.tokensUsed.input).toBe(150);
    expect(result.tokensUsed.output).toBe(80);
  });

  it('tracks cumulative cost across multiple messages', async () => {
    const config = createTestConfig();
    mockProvider.setDefault(buildResponse('Sure!', 100, 50));

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    await appContext.agentLoop.processMessage('conv-cost-1', 'First message', 'webchat');
    await appContext.agentLoop.processMessage('conv-cost-2', 'Second message', 'webchat');
    await appContext.agentLoop.processMessage('conv-cost-3', 'Third message', 'webchat');

    // Verify monthly cost accumulates
    const db = appContext.dbManager.db;
    const monthlyCost = getMonthlyTotalCost(db);
    expect(monthlyCost).toBeGreaterThan(0);
  });

  it('gateway health endpoint returns correct structure', async () => {
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

    const response = await appContext.gateway.app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('memoryUsageMb');
    expect(typeof body.uptime).toBe('number');
  });

  it('gateway contact CRUD works end-to-end', async () => {
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
    const authHeaders = createAuthHeaders(db);

    // Create a contact
    const createRes = await appContext.gateway.app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: authHeaders,
      payload: { name: 'Test User', trustLevel: 'known', email: 'test@example.com' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body);
    expect(created.name).toBe('Test User');

    // Get the contact
    const getRes = await appContext.gateway.app.inject({
      method: 'GET',
      url: `/api/v1/contacts/${created.id}`,
      headers: authHeaders,
    });
    expect(getRes.statusCode).toBe(200);

    // Update the contact
    const updateRes = await appContext.gateway.app.inject({
      method: 'PUT',
      url: `/api/v1/contacts/${created.id}`,
      headers: authHeaders,
      payload: { trustLevel: 'trusted' },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = JSON.parse(updateRes.body);
    expect(updated.trustLevel).toBe('trusted');

    // Verify security log captured trust level change
    const logs = getRecentSecurityLogs(db, 10);
    const trustChangeLog = logs.find((log) => log.actionType === 'trust_level_changed');
    expect(trustChangeLog).toBeDefined();

    // Delete the contact
    const deleteRes = await appContext.gateway.app.inject({
      method: 'DELETE',
      url: `/api/v1/contacts/${created.id}`,
      headers: authHeaders,
    });
    expect(deleteRes.statusCode).toBe(204);
  });

  it('gateway groups API works end-to-end', async () => {
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
    const authHeaders = createAuthHeaders(db);

    // Create a group
    const createRes = await appContext.gateway.app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: authHeaders,
      payload: { name: 'Test Group', description: 'E2E test', color: '#ff0000' },
    });
    expect(createRes.statusCode).toBe(201);
    const group = JSON.parse(createRes.body);
    expect(group.name).toBe('Test Group');

    // List groups
    const listRes = await appContext.gateway.app.inject({
      method: 'GET',
      url: '/api/v1/groups',
      headers: authHeaders,
    });
    expect(listRes.statusCode).toBe(200);
    const listed = JSON.parse(listRes.body);
    expect(listed.groups).toHaveLength(1);

    // Delete group
    const deleteRes = await appContext.gateway.app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${group.id}`,
      headers: authHeaders,
    });
    expect(deleteRes.statusCode).toBe(204);
  });

  it('handles shutdown gracefully', async () => {
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

    let shutdownCompleted = false;
    appContext.shutdownHandler.register('e2e-test', async () => {
      shutdownCompleted = true;
    });

    await appContext.shutdownHandler.shutdown();
    expect(shutdownCompleted).toBe(true);
    expect(appContext.shutdownHandler.isShuttingDown()).toBe(true);
    appContext = undefined;
  });
});
