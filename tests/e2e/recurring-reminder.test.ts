/**
 * E2E Scenario: Recurring Reminder
 *
 * Tests the full pipeline: user says "Remind me to take medication at 8am every day"
 * → reminders wave matches → extracts schedule → returns cron metadata →
 * agent loop creates cron job → cron runner ticks → handler fires → channel delivery.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { startApp, type AppContext } from '../../src/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../mocks/provider.js';
import { createMockChannelAdapter, type MockChannelAdapter } from '../mocks/channel.js';
import { clearRegistry } from '../../src/waves/registry.js';
import { getCronJob, getEnabledCronJobs } from '../../src/persistence/cron-jobs.js';
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

describe('E2E: Recurring Reminder', () => {
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

  it('creates a cron job from "remind me every day at 8am to take medication"', async () => {
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

    // Process a reminder message through the agent loop
    const result = await appContext.agentLoop.processMessage(
      'test-conv-reminder',
      'remind me every day at 8am to take medication',
      'webchat',
    );

    // The response should confirm the reminder was set
    expect(result.responseText).toBeTruthy();

    // A cron job should have been created in the database
    const cronJobs = getEnabledCronJobs(appContext.dbManager.db);
    const reminderJob = cronJobs.find(
      (j) => j.taskDescription.toLowerCase().includes('medication'),
    );

    expect(reminderJob).toBeDefined();
    expect(reminderJob!.schedule).toBe('0 8 * * *');
    expect(reminderJob!.waveId).toBe('reminders');
    expect(reminderJob!.channelType).toBe('webchat');
    expect(reminderJob!.channelId).toBe('test-conv-reminder');
    expect(reminderJob!.nextRunAt).toBeTruthy();
    // No expiry for recurring reminders without "for the next..."
    expect(reminderJob!.expiresAt).toBeNull();
  });

  it('creates a one-time reminder from "remind me in 5 minutes to check the oven"', async () => {
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

    const result = await appContext.agentLoop.processMessage(
      'test-conv-onetime',
      'remind me in 5 minutes to check the oven',
      'webchat',
    );

    expect(result.responseText).toBeTruthy();

    const cronJobs = getEnabledCronJobs(appContext.dbManager.db);
    const ovenJob = cronJobs.find(
      (j) => j.taskDescription.toLowerCase().includes('oven'),
    );

    expect(ovenJob).toBeDefined();
    // One-time reminders have a specific date/time cron schedule
    expect(ovenJob!.schedule).toBeTruthy();
    expect(ovenJob!.waveId).toBe('reminders');
    expect(ovenJob!.nextRunAt).toBeTruthy();
  });

  it('cron handler delivers plain reminder text to the channel', async () => {
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

    // Connect mock channel
    await mockChannel.connect({ enabled: true });
    appContext.channelManager.registerAdapter(mockChannel);

    // Process a reminder to create a cron job
    await appContext.agentLoop.processMessage(
      'test-conv-delivery',
      'remind me every day at 8am to drink water',
      'webchat',
    );

    const cronJobs = getEnabledCronJobs(appContext.dbManager.db);
    const waterJob = cronJobs.find(
      (j) => j.taskDescription.toLowerCase().includes('water'),
    );
    expect(waterJob).toBeDefined();

    // Now simulate the cron runner ticking with a handler that delivers to channels
    const handler = createCronJobHandler({
      db: appContext.dbManager.db,
      channelManager: appContext.channelManager,
      provider: mockProvider,
      enabledProviders: ['anthropic'],
    });

    // Manually invoke the handler with the job (simulating what tickCronRunner does)
    await handler(waterJob!);

    // The mock channel should have received the reminder
    expect(mockChannel.sentMessages.length).toBeGreaterThanOrEqual(1);
    const delivered = mockChannel.sentMessages.find(
      (m) => m.text.includes('water') || m.text.includes('Reminder'),
    );
    expect(delivered).toBeDefined();
    expect(delivered!.channelId).toBe('test-conv-delivery');
  });

  it('time-bounded reminder includes expiresAt', async () => {
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

    await appContext.agentLoop.processMessage(
      'test-conv-expiry',
      'remind me every 30 minutes to stretch for the next 3 hours',
      'webchat',
    );

    const cronJobs = getEnabledCronJobs(appContext.dbManager.db);
    const stretchJob = cronJobs.find(
      (j) => j.taskDescription.toLowerCase().includes('stretch'),
    );

    expect(stretchJob).toBeDefined();
    expect(stretchJob!.schedule).toBe('*/30 * * * *');
    expect(stretchJob!.expiresAt).toBeTruthy();

    // Expiry should be ~3 hours from now
    const expiryDiff = stretchJob!.expiresAt!.getTime() - Date.now();
    expect(expiryDiff).toBeGreaterThan(2.8 * 3_600_000); // > 2.8h
    expect(expiryDiff).toBeLessThan(3.2 * 3_600_000);    // < 3.2h
  });
});
