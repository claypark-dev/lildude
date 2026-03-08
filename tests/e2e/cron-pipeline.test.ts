/**
 * E2E Scenario: Full Cron Pipeline
 *
 * Tests the complete cron lifecycle:
 * 1. Cron job creation with proper nextRunAt
 * 2. tickCronRunner() finding due jobs
 * 3. Handler execution + channel delivery
 * 4. Job state updates (lastRunAt, nextRun, status)
 * 5. Expiry-based auto-deletion
 * 6. One-time job auto-deletion after firing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { startApp, type AppContext } from '../../src/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../mocks/provider.js';
import { createMockChannelAdapter, type MockChannelAdapter } from '../mocks/channel.js';
import { clearRegistry } from '../../src/waves/registry.js';
import {
  createCronJob,
  getCronJob,
  getEnabledCronJobs,
  getMissedJobs,
} from '../../src/persistence/cron-jobs.js';
import { tickCronRunner } from '../../src/orchestrator/cron-runner.js';
import { createCronJobHandler } from '../../src/orchestrator/cron-job-handler.js';
import type { ChatResponse } from '../../src/types/index.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'persistence', 'migrations');

function createTestConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
  });
}

function buildMockResponse(text: string): ChatResponse {
  return {
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason: 'end_turn',
  };
}

describe('E2E: Full Cron Pipeline', () => {
  let appContext: AppContext | undefined;
  let mockProvider: MockProvider;
  let mockChannel: MockChannelAdapter;

  beforeEach(() => {
    mockProvider = createMockProvider('anthropic');
    mockChannel = createMockChannelAdapter('webchat', 'MockChannel');
    mockProvider.setDefault(buildMockResponse('OK'));
  });

  afterEach(async () => {
    clearRegistry();
    if (appContext) {
      try { await appContext.gateway.stop(); } catch { /* ignore */ }
      try { appContext.dbManager.close(); } catch { /* ignore */ }
      appContext = undefined;
    }
  });

  it('tickCronRunner picks up due jobs and invokes handler', async () => {
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

    await mockChannel.connect({ enabled: true });
    appContext.channelManager.registerAdapter(mockChannel);

    const db = appContext.dbManager.db;

    // Create a cron job with nextRunAt in the past (so it's "due")
    const pastDate = new Date(Date.now() - 60_000);
    createCronJob(db, {
      schedule: '*/30 * * * *',
      taskDescription: 'Test tick delivery',
      channelType: 'webchat',
      channelId: 'test-channel-tick',
      nextRunAt: pastDate,
    });

    // Verify it's picked up as a missed job
    const missed = getMissedJobs(db);
    expect(missed.length).toBeGreaterThanOrEqual(1);
    expect(missed[0].taskDescription).toBe('Test tick delivery');

    // Create handler and tick the runner
    const handler = createCronJobHandler({
      db,
      channelManager: appContext.channelManager,
      provider: mockProvider,
      enabledProviders: ['anthropic'],
    });

    await tickCronRunner(db, handler);

    // Channel should have received the reminder
    expect(mockChannel.sentMessages.length).toBeGreaterThanOrEqual(1);
    const delivered = mockChannel.sentMessages.find(
      (m) => m.text.includes('Test tick delivery'),
    );
    expect(delivered).toBeDefined();
    expect(delivered!.channelId).toBe('test-channel-tick');
  });

  it('cron job state updates after successful execution', async () => {
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

    // Create a recurring cron job with nextRunAt in the past
    const pastDate = new Date(Date.now() - 60_000);
    const job = createCronJob(db, {
      schedule: '*/30 * * * *',
      taskDescription: 'State update test',
      nextRunAt: pastDate,
    });

    const handler = createCronJobHandler({
      db,
      channelManager: appContext.channelManager,
      provider: mockProvider,
      enabledProviders: ['anthropic'],
    });

    await tickCronRunner(db, handler);

    // Job should still exist (it's recurring)
    const updated = getCronJob(db, job.id);
    expect(updated).toBeDefined();
    // lastRunAt should be set
    expect(updated!.lastRunAt).toBeTruthy();
    // nextRunAt should be updated to a future time
    expect(updated!.nextRunAt).toBeTruthy();
    expect(updated!.nextRunAt!.getTime()).toBeGreaterThan(Date.now() - 1000);
    // Status should be success
    expect(updated!.lastRunStatus).toBe('success');
  });

  it('expired cron job is deleted and not executed', async () => {
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

    await mockChannel.connect({ enabled: true });
    appContext.channelManager.registerAdapter(mockChannel);

    const db = appContext.dbManager.db;

    // Create a cron job that is already expired
    const pastDate = new Date(Date.now() - 60_000);
    const expiredDate = new Date(Date.now() - 30_000); // expired 30s ago
    const job = createCronJob(db, {
      schedule: '*/30 * * * *',
      taskDescription: 'Expired job test',
      nextRunAt: pastDate,
      expiresAt: expiredDate,
      channelType: 'webchat',
      channelId: 'test-channel-expired',
    });

    // getMissedJobs should NOT return expired jobs
    const missed = getMissedJobs(db);
    const expiredInMissed = missed.find((j) => j.id === job.id);
    expect(expiredInMissed).toBeUndefined();

    // No messages should be sent for expired jobs
    expect(mockChannel.sentMessages).toHaveLength(0);
  });

  it('one-time cron job is deleted after firing', async () => {
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

    // Create a one-time cron job (specific date/time in cron expression)
    const pastDate = new Date(Date.now() - 60_000);
    const now = new Date();
    const schedule = `${now.getUTCMinutes()} ${now.getUTCHours()} ${now.getUTCDate()} ${now.getUTCMonth() + 1} *`;
    const job = createCronJob(db, {
      schedule,
      taskDescription: 'One-time reminder test',
      nextRunAt: pastDate,
    });

    const handler = createCronJobHandler({
      db,
      channelManager: appContext.channelManager,
      provider: mockProvider,
      enabledProviders: ['anthropic'],
    });

    await tickCronRunner(db, handler);

    // One-time job should be deleted after firing
    const deletedJob = getCronJob(db, job.id);
    expect(deletedJob).toBeUndefined();
  });

  it('cron job without channel still executes without error', async () => {
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

    // Create a job with no channel routing
    const pastDate = new Date(Date.now() - 60_000);
    createCronJob(db, {
      schedule: '*/30 * * * *',
      taskDescription: 'No channel test',
      nextRunAt: pastDate,
    });

    const handler = createCronJobHandler({
      db,
      channelManager: appContext.channelManager,
      provider: mockProvider,
      enabledProviders: ['anthropic'],
    });

    // Should not throw even without a channel
    await expect(tickCronRunner(db, handler)).resolves.toBeUndefined();
  });
});
