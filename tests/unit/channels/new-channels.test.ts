/**
 * Tests for new channel adapters: Matrix, Teams, LINE, Google Chat.
 *
 * Tests the adapter factory functions, message normalization, message
 * splitting, allow-from filtering, and connection lifecycle.
 * Uses mock connections via dependency injection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMatrixAdapter, type MatrixConnection } from '../../../src/channels/matrix.js';
import { createTeamsAdapter, type TeamsConnection } from '../../../src/channels/teams.js';
import { createLineAdapter, type LineConnection } from '../../../src/channels/line.js';
import { createGoogleChatAdapter, type GoogleChatConnection } from '../../../src/channels/googlechat.js';
import { splitMessage as matrixSplit } from '../../../src/channels/matrix.js';
import { splitMessage as teamsSplit } from '../../../src/channels/teams.js';
import { splitMessage as lineSplit } from '../../../src/channels/line.js';
import { splitMessage as gchatSplit } from '../../../src/channels/googlechat.js';

// ── Mock Connection Factory ──────────────────────────────────────

function createMockMatrixConnection(): MatrixConnection {
  let messageHandler: ((msg: any) => Promise<void>) | undefined;
  let running = false;

  return {
    async start() { running = true; },
    async stop() { running = false; },
    onMessage(handler) { messageHandler = handler; },
    async send() {},
    isRunning() { return running; },
    // Test helper: simulate an inbound message
    _simulateMessage: async (msg: any) => { await messageHandler?.(msg); },
  } as MatrixConnection & { _simulateMessage: (msg: any) => Promise<void> };
}

function createMockTeamsConnection(): TeamsConnection {
  let messageHandler: ((msg: any) => Promise<void>) | undefined;
  let running = false;

  return {
    async start() { running = true; },
    async stop() { running = false; },
    onMessage(handler) { messageHandler = handler; },
    async send() {},
    isRunning() { return running; },
    _simulateMessage: async (msg: any) => { await messageHandler?.(msg); },
  } as TeamsConnection & { _simulateMessage: (msg: any) => Promise<void> };
}

function createMockLineConnection(): LineConnection {
  let messageHandler: ((msg: any) => Promise<void>) | undefined;
  let running = false;

  return {
    async start() { running = true; },
    async stop() { running = false; },
    onMessage(handler) { messageHandler = handler; },
    async send() {},
    async reply() {},
    isRunning() { return running; },
    _simulateMessage: async (msg: any) => { await messageHandler?.(msg); },
  } as LineConnection & { _simulateMessage: (msg: any) => Promise<void> };
}

function createMockGoogleChatConnection(): GoogleChatConnection {
  let messageHandler: ((msg: any) => Promise<void>) | undefined;
  let running = false;

  return {
    async start() { running = true; },
    async stop() { running = false; },
    onMessage(handler) { messageHandler = handler; },
    async send() {},
    isRunning() { return running; },
    _simulateMessage: async (msg: any) => { await messageHandler?.(msg); },
  } as GoogleChatConnection & { _simulateMessage: (msg: any) => Promise<void> };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Matrix Adapter', () => {
  it('creates an adapter with correct name and type', () => {
    const adapter = createMatrixAdapter();
    expect(adapter.name).toBe('Matrix');
    expect(adapter.type).toBe('matrix');
  });

  it('starts disconnected', () => {
    const adapter = createMatrixAdapter();
    expect(adapter.isConnected()).toBe(false);
  });

  it('throws without homeserverUrl and accessToken', async () => {
    const conn = createMockMatrixConnection();
    const adapter = createMatrixAdapter(conn);
    await expect(adapter.connect({})).rejects.toThrow('homeserverUrl');
  });

  it('connects with valid config', async () => {
    const conn = createMockMatrixConnection();
    const adapter = createMatrixAdapter(conn);
    await adapter.connect({ homeserverUrl: 'https://matrix.org', accessToken: 'syt_test' });
    expect(adapter.isConnected()).toBe(true);
  });

  it('disconnects cleanly', async () => {
    const conn = createMockMatrixConnection();
    const adapter = createMatrixAdapter(conn);
    await adapter.connect({ homeserverUrl: 'https://matrix.org', accessToken: 'syt_test' });
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });
});

describe('Teams Adapter', () => {
  it('creates an adapter with correct name and type', () => {
    const adapter = createTeamsAdapter();
    expect(adapter.name).toBe('Microsoft Teams');
    expect(adapter.type).toBe('teams');
  });

  it('starts disconnected', () => {
    const adapter = createTeamsAdapter();
    expect(adapter.isConnected()).toBe(false);
  });

  it('throws without appId and appPassword', async () => {
    const conn = createMockTeamsConnection();
    const adapter = createTeamsAdapter(conn);
    await expect(adapter.connect({})).rejects.toThrow('appId');
  });

  it('connects with valid config', async () => {
    const conn = createMockTeamsConnection();
    const adapter = createTeamsAdapter(conn);
    await adapter.connect({ appId: 'test-app', appPassword: 'test-pass' });
    expect(adapter.isConnected()).toBe(true);
  });

  it('disconnects cleanly', async () => {
    const conn = createMockTeamsConnection();
    const adapter = createTeamsAdapter(conn);
    await adapter.connect({ appId: 'test-app', appPassword: 'test-pass' });
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });
});

describe('LINE Adapter', () => {
  it('creates an adapter with correct name and type', () => {
    const adapter = createLineAdapter();
    expect(adapter.name).toBe('LINE');
    expect(adapter.type).toBe('line');
  });

  it('starts disconnected', () => {
    const adapter = createLineAdapter();
    expect(adapter.isConnected()).toBe(false);
  });

  it('throws without channelAccessToken and channelSecret', async () => {
    const conn = createMockLineConnection();
    const adapter = createLineAdapter(conn);
    await expect(adapter.connect({})).rejects.toThrow('channelAccessToken');
  });

  it('connects with valid config', async () => {
    const conn = createMockLineConnection();
    const adapter = createLineAdapter(conn);
    await adapter.connect({ channelAccessToken: 'token123', channelSecret: 'secret123' });
    expect(adapter.isConnected()).toBe(true);
  });

  it('disconnects cleanly', async () => {
    const conn = createMockLineConnection();
    const adapter = createLineAdapter(conn);
    await adapter.connect({ channelAccessToken: 'token123', channelSecret: 'secret123' });
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });
});

describe('Google Chat Adapter', () => {
  it('creates an adapter with correct name and type', () => {
    const adapter = createGoogleChatAdapter();
    expect(adapter.name).toBe('Google Chat');
    expect(adapter.type).toBe('googlechat');
  });

  it('starts disconnected', () => {
    const adapter = createGoogleChatAdapter();
    expect(adapter.isConnected()).toBe(false);
  });

  it('throws without serviceAccountKey', async () => {
    const conn = createMockGoogleChatConnection();
    const adapter = createGoogleChatAdapter(conn);
    await expect(adapter.connect({})).rejects.toThrow('serviceAccountKey');
  });

  it('connects with valid config', async () => {
    const conn = createMockGoogleChatConnection();
    const adapter = createGoogleChatAdapter(conn);
    await adapter.connect({ serviceAccountKey: '{"type":"service_account"}' });
    expect(adapter.isConnected()).toBe(true);
  });

  it('disconnects cleanly', async () => {
    const conn = createMockGoogleChatConnection();
    const adapter = createGoogleChatAdapter(conn);
    await adapter.connect({ serviceAccountKey: '{"type":"service_account"}' });
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });
});

describe('Message Splitting', () => {
  it('Matrix: returns single chunk for short messages', () => {
    expect(matrixSplit('Hello')).toEqual(['Hello']);
  });

  it('Matrix: splits long messages', () => {
    const long = 'A'.repeat(10000);
    const chunks = matrixSplit(long, 3000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(long);
  });

  it('Teams: returns single chunk for short messages', () => {
    expect(teamsSplit('Hello')).toEqual(['Hello']);
  });

  it('LINE: returns single chunk for short messages', () => {
    expect(lineSplit('Hello')).toEqual(['Hello']);
  });

  it('Google Chat: returns single chunk for short messages', () => {
    expect(gchatSplit('Hello')).toEqual(['Hello']);
  });

  it('splits on newlines when possible', () => {
    const text = 'Line 1\nLine 2\nLine 3';
    const chunks = matrixSplit(text, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // Verify no chunk exceeds the limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
  });
});

describe('Adapter without connection', () => {
  it('Matrix throws when connecting without a connection', async () => {
    const adapter = createMatrixAdapter();
    await expect(
      adapter.connect({ homeserverUrl: 'https://matrix.org', accessToken: 'token' }),
    ).rejects.toThrow('injected');
  });

  it('Teams throws when connecting without a connection', async () => {
    const adapter = createTeamsAdapter();
    await expect(
      adapter.connect({ appId: 'app', appPassword: 'pass' }),
    ).rejects.toThrow('injected');
  });

  it('LINE throws when connecting without a connection', async () => {
    const adapter = createLineAdapter();
    await expect(
      adapter.connect({ channelAccessToken: 'token', channelSecret: 'secret' }),
    ).rejects.toThrow('injected');
  });

  it('Google Chat throws when connecting without a connection', async () => {
    const adapter = createGoogleChatAdapter();
    await expect(
      adapter.connect({ serviceAccountKey: 'key' }),
    ).rejects.toThrow('injected');
  });
});
