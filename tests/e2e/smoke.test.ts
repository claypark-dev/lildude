/**
 * End-to-end smoke test for Lil Dude.
 * Verifies the full startup, message processing, cost tracking,
 * graceful shutdown, and onboarding check.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { startApp, isOnboarded, type AppContext } from '../../src/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../mocks/provider.js';
import { createMockChannelAdapter, type MockChannelAdapter } from '../mocks/channel.js';
import type { ChatResponse, ChannelMessage } from '../../src/types/index.js';
import { nanoid } from 'nanoid';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'persistence', 'migrations');

/** Create a minimal test config with defaults. */
function createTestConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
  });
}

/** Build a mock ChatResponse with non-zero token usage. */
function buildMockResponse(text: string, inputTokens: number, outputTokens: number): ChatResponse {
  return {
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens, outputTokens },
    stopReason: 'end_turn',
  };
}

/** Build a simulated ChannelMessage. */
function buildChannelMessage(text: string): ChannelMessage {
  return {
    id: nanoid(),
    channelType: 'webchat',
    channelId: `test-channel-${nanoid(8)}`,
    userId: 'test-user',
    text,
    attachments: [],
    timestamp: new Date(),
  };
}

describe('Smoke Test — Full App Lifecycle', () => {
  let appContext: AppContext | undefined;
  let mockProvider: MockProvider;
  let mockChannel: MockChannelAdapter;

  beforeEach(() => {
    mockProvider = createMockProvider('anthropic');
    mockChannel = createMockChannelAdapter('webchat', 'MockChannel');
  });

  afterEach(async () => {
    if (appContext) {
      try {
        await appContext.gateway.stop();
      } catch {
        // best-effort cleanup
      }
      try {
        appContext.dbManager.close();
      } catch {
        // best-effort cleanup
      }
      appContext = undefined;
    }
  });

  it('starts the app with mock provider and all subsystems initialized', async () => {
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

    expect(appContext.config).toBeDefined();
    expect(appContext.dbManager).toBeDefined();
    expect(appContext.providerManager).toBeDefined();
    expect(appContext.channelManager).toBeDefined();
    expect(appContext.agentLoop).toBeDefined();
    expect(appContext.gateway).toBeDefined();
    expect(appContext.shutdownHandler).toBeDefined();
  });

  it('sends a message through the agent loop and receives a response', async () => {
    const config = createTestConfig();

    mockProvider.setDefault(
      buildMockResponse('Hello from Lil Dude!', 100, 50),
    );

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    // Process a message directly through the agent loop
    const result = await appContext.agentLoop.processMessage(
      'test-conv-1',
      'Hello!',
      'webchat',
    );

    expect(result.responseText).toBe('Hello from Lil Dude!');
    expect(result.roundTrips).toBeGreaterThanOrEqual(1);

    // Verify the mock provider was called
    const calls = mockProvider.getCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('tracks cost for processed messages', async () => {
    const config = createTestConfig();

    mockProvider.setDefault(
      buildMockResponse('Cost-tracked response', 200, 100),
    );

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
      'test-conv-cost',
      'Tell me something',
      'webchat',
    );

    // The mock response uses model 'claude-haiku-4-5-20251001' which has non-zero pricing
    // inputPer1k: 0.001, outputPer1k: 0.005
    // So for 200 input + 100 output tokens:
    // cost = (200/1000)*0.001 + (100/1000)*0.005 = 0.0002 + 0.0005 = 0.0007
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.tokensUsed.input).toBe(200);
    expect(result.tokensUsed.output).toBe(100);
  });

  it('wires mock channel adapter and processes messages end-to-end', async () => {
    const config = createTestConfig();

    mockProvider.setDefault(
      buildMockResponse('Channel response!', 80, 40),
    );

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    // Manually register and wire the mock channel adapter
    await mockChannel.connect({ enabled: true });
    appContext.channelManager.registerAdapter(mockChannel);

    // Wire the mock channel to the agent loop
    mockChannel.onMessage(async (msg: ChannelMessage) => {
      const result = await appContext!.agentLoop.processMessage(
        msg.channelId,
        msg.text,
        msg.channelType,
      );
      await mockChannel.send(msg.channelId, result.responseText);
    });

    // Simulate an inbound message
    const testMessage = buildChannelMessage('Hi there');
    await mockChannel.simulateMessage(testMessage);

    // Verify the response was sent
    expect(mockChannel.sentMessages).toHaveLength(1);
    expect(mockChannel.sentMessages[0].text).toBe('Channel response!');
    expect(mockChannel.sentMessages[0].channelId).toBe(testMessage.channelId);
  });

  it('gracefully shuts down via shutdown handler', async () => {
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

    // Register test cleanup handlers on the shutdown handler
    let gatewayStopCalled = false;
    let channelDisconnectCalled = false;

    appContext.shutdownHandler.register('test-gateway', async () => {
      await appContext!.gateway.stop();
      gatewayStopCalled = true;
    });

    appContext.shutdownHandler.register('test-channels', async () => {
      await appContext!.channelManager.disconnectAll();
      channelDisconnectCalled = true;
    });

    // Trigger manual shutdown
    await appContext.shutdownHandler.shutdown();

    expect(gatewayStopCalled).toBe(true);
    expect(channelDisconnectCalled).toBe(true);
    expect(appContext.shutdownHandler.isShuttingDown()).toBe(true);

    // Prevent afterEach from trying to stop again (already stopped)
    appContext = undefined;
  });

  it('handles multiple sequential messages', async () => {
    const config = createTestConfig();

    mockProvider.setDefault({
      content: [{ type: 'text', text: 'Response' }],
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 50, outputTokens: 25 },
      stopReason: 'end_turn',
    });

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    // Send three messages
    const result1 = await appContext.agentLoop.processMessage('conv-seq', 'msg 1', 'webchat');
    const result2 = await appContext.agentLoop.processMessage('conv-seq', 'msg 2', 'webchat');
    const result3 = await appContext.agentLoop.processMessage('conv-seq', 'msg 3', 'webchat');

    expect(result1.responseText).toBe('Response');
    expect(result2.responseText).toBe('Response');
    expect(result3.responseText).toBe('Response');

    // Verify cost accumulates
    expect(mockProvider.getCalls().length).toBeGreaterThanOrEqual(3);
  });

  it('starts with the gateway health endpoint responding', async () => {
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

    // Use Fastify inject to test the health endpoint
    const response = await appContext.gateway.app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('version');
  });
});

describe('Onboarding Check', () => {
  const tempDir = join(tmpdir(), `lildude-test-${nanoid(8)}`);

  beforeEach(() => {
    process.env.LIL_DUDE_HOME = tempDir;
  });

  afterEach(() => {
    delete process.env.LIL_DUDE_HOME;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns false when no config file exists', () => {
    expect(isOnboarded()).toBe(false);
  });

  it('returns true when config.json exists', () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'config.json'), '{}', 'utf-8');

    expect(isOnboarded()).toBe(true);
  });
});
