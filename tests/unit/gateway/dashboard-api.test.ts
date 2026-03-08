/**
 * Unit tests for the consolidated Dashboard API endpoint.
 * GET /api/v1/dashboard — returns all widget data in a single call.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { startApp, type AppContext } from '../../../src/index.js';
import { ConfigSchema } from '../../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../../mocks/provider.js';
import { clearRegistry } from '../../../src/waves/registry.js';
import { createCronJob } from '../../../src/persistence/cron-jobs.js';
import { createTask } from '../../../src/persistence/tasks.js';
import { storeApiKey } from '../../../src/persistence/api-keys.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');
const TEST_API_KEY = 'test-dashboard-api-key-12345';

function createTestConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
  });
}

function authHeaders() {
  return { authorization: `Bearer ${TEST_API_KEY}` };
}

describe('Dashboard API', () => {
  let appContext: AppContext | undefined;
  let mockProvider: MockProvider;

  beforeEach(() => {
    mockProvider = createMockProvider('anthropic');
  });

  afterEach(async () => {
    clearRegistry();
    if (appContext) {
      try { await appContext.gateway.stop(); } catch { /* ignore */ }
      try { appContext.dbManager.close(); } catch { /* ignore */ }
      appContext = undefined;
    }
  });

  it('returns consolidated dashboard data at GET /api/v1/dashboard', async () => {
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

    // Store a test API key for auth
    storeApiKey(appContext.dbManager.db, TEST_API_KEY, 'test');

    const response = await appContext.gateway.app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;

    // Verify all top-level sections exist
    expect(body).toHaveProperty('health');
    expect(body).toHaveProperty('budget');
    expect(body).toHaveProperty('tasks');
    expect(body).toHaveProperty('cron');

    // Verify health data
    const health = body.health as Record<string, unknown>;
    expect(health.status).toBe('ok');
    expect(typeof health.uptime).toBe('number');
    expect(typeof health.memoryMb).toBe('number');

    // Verify budget data
    const budget = body.budget as Record<string, unknown>;
    expect(typeof budget.monthlyCostUsd).toBe('number');
    expect(typeof budget.dailyCostUsd).toBe('number');

    // Verify tasks data
    const tasks = body.tasks as Record<string, unknown>;
    expect(typeof tasks.active).toBe('number');
    expect(typeof tasks.recent24h).toBe('number');
    expect(Array.isArray(tasks.items)).toBe(true);

    // Verify cron data
    const cron = body.cron as Record<string, unknown>;
    expect(typeof cron.count).toBe('number');
    expect(Array.isArray(cron.jobs)).toBe(true);
  });

  it('includes cron jobs in the dashboard response', async () => {
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
    storeApiKey(db, TEST_API_KEY, 'test');

    // Create some cron jobs
    createCronJob(db, {
      schedule: '*/30 * * * *',
      taskDescription: 'Weather check Seattle',
      waveId: 'weather',
      nextRunAt: new Date(Date.now() + 1800_000),
    });

    createCronJob(db, {
      schedule: '0 8 * * *',
      taskDescription: 'Daily reminder',
      waveId: 'reminders',
      nextRunAt: new Date(Date.now() + 3600_000),
    });

    const response = await appContext.gateway.app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    const cron = body.cron as { jobs: Array<Record<string, unknown>>; count: number };

    expect(cron.count).toBe(2);
    expect(cron.jobs).toHaveLength(2);

    // Verify job shape
    const weatherJob = cron.jobs.find((j) => j.waveId === 'weather');
    expect(weatherJob).toBeDefined();
    expect(weatherJob!.schedule).toBe('*/30 * * * *');
    expect(weatherJob!.taskDescription).toBe('Weather check Seattle');
    expect(weatherJob!.nextRunAt).toBeTruthy();
  });

  it('includes active tasks in the dashboard response', async () => {
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
    storeApiKey(db, TEST_API_KEY, 'test');

    // Create a running task
    createTask(db, {
      type: 'chat',
      description: 'Test running task',
      channelType: 'webchat',
      channelId: 'test',
    });

    const response = await appContext.gateway.app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    const tasks = body.tasks as { active: number; recent24h: number; items: Array<Record<string, unknown>> };

    // The task should appear in recent24h count
    expect(tasks.recent24h).toBeGreaterThanOrEqual(1);
  });

  it('returns 401 without auth header', async () => {
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
      url: '/api/v1/dashboard',
    });

    expect(response.statusCode).toBe(401);
  });
});
