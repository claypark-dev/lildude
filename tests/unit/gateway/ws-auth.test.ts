import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { createWSManager, type WSManager } from '../../../src/gateway/ws.js';
import { storeApiKey, generateApiKey } from '../../../src/persistence/api-keys.js';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

/** Mock WebSocket that simulates a real WebSocket connection. */
class MockSocket extends EventEmitter {
  readyState = 1; // OPEN
  sentMessages: string[] = [];
  closed = false;

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3; // CLOSED
    this.emit('close');
  }

  /** Simulate receiving a message from the client. */
  receiveMessage(data: string): void {
    this.emit('message', Buffer.from(data));
  }
}

describe('ws-auth', () => {
  let manager: DatabaseManager;
  let validApiKey: string;

  beforeEach(() => {
    manager = createTestDb();
    validApiKey = generateApiKey();
    storeApiKey(manager.db, validApiKey, 'ws-test');
  });

  afterEach(() => {
    try {
      manager.close();
    } catch {
      // best-effort cleanup
    }
  });

  describe('without auth (no db)', () => {
    it('clients are immediately authenticated', () => {
      const wsManager = createWSManager();
      const socket = new MockSocket();

      wsManager.addClient(socket as never);

      // Should be able to subscribe immediately
      socket.receiveMessage(JSON.stringify({
        type: 'subscribe',
        payload: { topics: ['chat'] },
      }));

      const lastMsg = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]);
      expect(lastMsg.type).toBe('subscribe.ack');
    });
  });

  describe('with auth (db provided)', () => {
    it('rejects non-auth first messages', () => {
      const wsManager = createWSManager({ db: manager.db, authTimeoutMs: 30_000 });
      const socket = new MockSocket();

      wsManager.addClient(socket as never);

      // Send a subscribe before auth
      socket.receiveMessage(JSON.stringify({
        type: 'subscribe',
        payload: { topics: ['chat'] },
      }));

      const lastMsg = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]);
      expect(lastMsg.type).toBe('error');
      expect(lastMsg.payload.code).toBe('AUTH_REQUIRED');
      expect(socket.closed).toBe(true);
    });

    it('authenticates with valid token', () => {
      const wsManager = createWSManager({ db: manager.db, authTimeoutMs: 30_000 });
      const socket = new MockSocket();

      wsManager.addClient(socket as never);

      socket.receiveMessage(JSON.stringify({
        type: 'auth',
        token: validApiKey,
      }));

      const lastMsg = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]);
      expect(lastMsg.type).toBe('auth.ok');
      expect(lastMsg.payload.clientId).toBeDefined();
    });

    it('rejects invalid token', () => {
      const wsManager = createWSManager({ db: manager.db, authTimeoutMs: 30_000 });
      const socket = new MockSocket();

      wsManager.addClient(socket as never);

      socket.receiveMessage(JSON.stringify({
        type: 'auth',
        token: 'ld_invalid_token_here',
      }));

      const lastMsg = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]);
      expect(lastMsg.type).toBe('auth.failed');
      expect(socket.closed).toBe(true);
    });

    it('allows normal messages after authentication', () => {
      const wsManager = createWSManager({ db: manager.db, authTimeoutMs: 30_000 });
      const socket = new MockSocket();

      wsManager.addClient(socket as never);

      // Authenticate first
      socket.receiveMessage(JSON.stringify({
        type: 'auth',
        token: validApiKey,
      }));

      // Now subscribe
      socket.receiveMessage(JSON.stringify({
        type: 'subscribe',
        payload: { topics: ['chat'] },
      }));

      const lastMsg = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]);
      expect(lastMsg.type).toBe('subscribe.ack');
    });

    it('disconnects unauthenticated clients after timeout', async () => {
      vi.useFakeTimers();

      const wsManager = createWSManager({ db: manager.db, authTimeoutMs: 100 });
      const socket = new MockSocket();

      wsManager.addClient(socket as never);

      // Don't send any auth message
      vi.advanceTimersByTime(150);

      // Client should be disconnected
      expect(socket.sentMessages.length).toBeGreaterThan(0);
      const lastMsg = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]);
      expect(lastMsg.type).toBe('error');
      expect(lastMsg.payload.code).toBe('AUTH_TIMEOUT');

      vi.useRealTimers();
    });

    it('does not disconnect authenticated clients after timeout', async () => {
      vi.useFakeTimers();

      const wsManager = createWSManager({ db: manager.db, authTimeoutMs: 100 });
      const socket = new MockSocket();

      wsManager.addClient(socket as never);

      // Authenticate immediately
      socket.receiveMessage(JSON.stringify({
        type: 'auth',
        token: validApiKey,
      }));

      vi.advanceTimersByTime(150);

      // Client should still be connected (no AUTH_TIMEOUT error)
      const messages = socket.sentMessages.map((m) => JSON.parse(m));
      const timeoutMsg = messages.find((m) => m.payload?.code === 'AUTH_TIMEOUT');
      expect(timeoutMsg).toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe('message size limits', () => {
    it('rejects messages exceeding size limit', () => {
      const wsManager = createWSManager({ maxMessageBytes: 100 });
      const socket = new MockSocket();

      wsManager.addClient(socket as never);

      // Send a message larger than 100 bytes
      const largePayload = JSON.stringify({
        type: 'subscribe',
        payload: { topics: ['a'.repeat(200)] },
      });

      socket.receiveMessage(largePayload);

      const lastMsg = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]);
      expect(lastMsg.type).toBe('error');
      expect(lastMsg.payload.code).toBe('MESSAGE_TOO_LARGE');
    });

    it('allows messages within size limit', () => {
      const wsManager = createWSManager({ maxMessageBytes: 10_000 });
      const socket = new MockSocket();

      wsManager.addClient(socket as never);

      socket.receiveMessage(JSON.stringify({
        type: 'subscribe',
        payload: { topics: ['chat'] },
      }));

      const lastMsg = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]);
      expect(lastMsg.type).toBe('subscribe.ack');
    });
  });

  describe('broadcast filtering', () => {
    it('does not broadcast to unauthenticated clients', () => {
      const wsManager = createWSManager({ db: manager.db, authTimeoutMs: 30_000 });
      const authedSocket = new MockSocket();
      const unauthedSocket = new MockSocket();

      wsManager.addClient(authedSocket as never);
      wsManager.addClient(unauthedSocket as never);

      // Authenticate only the first client
      authedSocket.receiveMessage(JSON.stringify({
        type: 'auth',
        token: validApiKey,
      }));

      // Subscribe the authenticated client
      authedSocket.receiveMessage(JSON.stringify({
        type: 'subscribe',
        payload: { topics: ['chat'] },
      }));

      // Clear messages so we can track broadcasts
      authedSocket.sentMessages.length = 0;
      unauthedSocket.sentMessages.length = 0;

      // Broadcast
      wsManager.broadcast('chat', {
        type: 'chat.message',
        payload: { text: 'hello' },
        timestamp: new Date().toISOString(),
      });

      // Authed client should receive the broadcast
      expect(authedSocket.sentMessages.length).toBe(1);
      // Unauthed client should NOT receive it
      expect(unauthedSocket.sentMessages.length).toBe(0);
    });
  });
});
