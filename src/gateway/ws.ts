/**
 * WebSocket gateway handler.
 * Manages client connections, subscriptions, and bidirectional message dispatch.
 * Protocol:
 *   Client -> Server: auth (first message), subscribe, chat.send, approval.respond, task.kill
 *   Server -> Client: auth.ok, auth.failed, chat.message, chat.stream, task.update, cost.update, approval.request
 *
 * See HLD Section 7 for gateway architecture.
 */

import type { WebSocket } from 'ws';
import type BetterSqlite3 from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { gatewayLogger } from '../utils/logger.js';
import { hashApiKey, findApiKeyByHash } from '../persistence/api-keys.js';

const log = gatewayLogger;

/** Default timeout (ms) to disconnect unauthenticated clients. */
const AUTH_TIMEOUT_MS = 5_000;

/** Default max message size in bytes (64 KB). */
const DEFAULT_MAX_MESSAGE_BYTES = 65_536;

// ── Schemas ──────────────────────────────────────────────────────────

const AuthMessageSchema = z.object({
  type: z.literal('auth'),
  token: z.string().min(1),
});

const SubscribePayloadSchema = z.object({
  topics: z.array(z.string()).min(1),
});

const ChatSendPayloadSchema = z.object({
  text: z.string().min(1),
  channelId: z.string().optional(),
});

const ApprovalRespondPayloadSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['approved', 'denied']),
});

const TaskKillPayloadSchema = z.object({
  taskId: z.string().min(1),
});

const IncomingMessageSchema = z.object({
  type: z.enum(['subscribe', 'chat.send', 'chat.history', 'approval.respond', 'task.kill']),
  payload: z.unknown(),
  timestamp: z.string().optional(),
});

// ── Types ────────────────────────────────────────────────────────────

/** Represents a connected WebSocket client with subscription state. */
export interface WSClient {
  readonly id: string;
  readonly socket: WebSocket;
  readonly topics: Set<string>;
  readonly connectedAt: Date;
  /** Whether the client has completed authentication. */
  authenticated: boolean;
}

/** Outgoing server-to-client message envelope. */
export interface WSOutgoingMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/** Handler called when the gateway receives an inbound client message. */
export type WSMessageHandler = (
  clientId: string,
  messageType: string,
  payload: unknown,
) => void;

/** Configuration options for the WebSocket manager. */
export interface WSManagerOptions {
  /** better-sqlite3 Database instance for API key validation. */
  db?: BetterSqlite3.Database;
  /** Maximum message size in bytes. Default: 65536 (64 KB). */
  maxMessageBytes?: number;
  /** Auth timeout in milliseconds. Default: 5000. */
  authTimeoutMs?: number;
}

// ── WSManager ────────────────────────────────────────────────────────

/**
 * Manages WebSocket connections, subscriptions, and message broadcasting.
 * Instances are created via {@link createWSManager}.
 */
export interface WSManager {
  /** Register a new WebSocket connection. Returns the assigned client ID. */
  addClient(socket: WebSocket): string;

  /** Remove a client by ID (called on disconnect). */
  removeClient(clientId: string): void;

  /** Broadcast a message to all clients subscribed to a given topic. */
  broadcast(topic: string, message: WSOutgoingMessage): void;

  /** Send a message to a specific client. */
  sendTo(clientId: string, message: WSOutgoingMessage): void;

  /** Register a handler that receives parsed inbound messages. */
  onMessage(handler: WSMessageHandler): void;

  /** Return the number of connected clients. */
  clientCount(): number;

  /** Disconnect all clients (used during shutdown). */
  disconnectAll(): void;
}

/**
 * Create a new WebSocket manager.
 * Manages the lifecycle of connected clients and message routing.
 * When a `db` option is provided, clients must authenticate with
 * `{ type: 'auth', token: '<api-key>' }` as their first message.
 *
 * @param options - Optional configuration for auth and message limits.
 * @returns A {@link WSManager} instance.
 */
export function createWSManager(options: WSManagerOptions = {}): WSManager {
  const clients = new Map<string, WSClient>();
  const messageHandlers: WSMessageHandler[] = [];
  const { db, maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES, authTimeoutMs = AUTH_TIMEOUT_MS } = options;
  const authRequired = db !== undefined;

  /**
   * Build a JSON envelope for sending to clients.
   */
  function serialize(message: WSOutgoingMessage): string {
    return JSON.stringify(message);
  }

  /**
   * Process a raw text frame from a client.
   */
  function handleRawMessage(client: WSClient, rawData: string): void {
    // Enforce message size limit
    const byteLength = Buffer.byteLength(rawData, 'utf-8');
    if (byteLength > maxMessageBytes) {
      sendError(client, 'MESSAGE_TOO_LARGE', `Message exceeds ${maxMessageBytes} byte limit (got ${byteLength})`);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      sendError(client, 'INVALID_JSON', 'Message is not valid JSON');
      return;
    }

    // Handle auth message
    if (!client.authenticated && authRequired) {
      handleAuthMessage(client, parsed);
      return;
    }

    const result = IncomingMessageSchema.safeParse(parsed);
    if (!result.success) {
      sendError(client, 'INVALID_MESSAGE', result.error.issues.map(i => i.message).join('; '));
      return;
    }

    const { type, payload } = result.data;

    switch (type) {
      case 'subscribe':
        handleSubscribe(client, payload);
        break;
      case 'chat.send':
        handleChatSend(client, payload);
        break;
      case 'chat.history':
        // Forward to message handlers — history loading is handled in index.ts
        for (const handler of messageHandlers) {
          handler(client.id, 'chat.history', payload ?? {});
        }
        break;
      case 'approval.respond':
        handleApprovalRespond(client, payload);
        break;
      case 'task.kill':
        handleTaskKill(client, payload);
        break;
    }
  }

  /**
   * Handle the first message from an unauthenticated client.
   */
  function handleAuthMessage(client: WSClient, parsed: unknown): void {
    const result = AuthMessageSchema.safeParse(parsed);
    if (!result.success) {
      sendError(client, 'AUTH_REQUIRED', 'First message must be { type: "auth", token: "<api-key>" }');
      try {
        client.socket.close();
      } catch {
        // best-effort close
      }
      return;
    }

    if (!db) {
      // Should not happen if authRequired is true, but guard anyway
      client.authenticated = true;
      return;
    }

    const keyHash = hashApiKey(result.data.token);
    const apiKey = findApiKeyByHash(db, keyHash);

    if (!apiKey) {
      const failMsg: WSOutgoingMessage = {
        type: 'auth.failed',
        payload: { detail: 'Invalid API key' },
        timestamp: new Date().toISOString(),
      };
      safeSend(client.socket, serialize(failMsg));
      log.warn({ clientId: client.id }, 'WebSocket auth failed — invalid key');
      try {
        client.socket.close();
      } catch {
        // best-effort close
      }
      return;
    }

    client.authenticated = true;
    const okMsg: WSOutgoingMessage = {
      type: 'auth.ok',
      payload: { clientId: client.id },
      timestamp: new Date().toISOString(),
    };
    safeSend(client.socket, serialize(okMsg));
    log.debug({ clientId: client.id }, 'WebSocket client authenticated');
  }

  function handleSubscribe(client: WSClient, payload: unknown): void {
    const result = SubscribePayloadSchema.safeParse(payload);
    if (!result.success) {
      sendError(client, 'INVALID_PAYLOAD', 'subscribe requires { topics: string[] }');
      return;
    }

    for (const topic of result.data.topics) {
      client.topics.add(topic);
    }

    log.debug({ clientId: client.id, topics: [...client.topics] }, 'Client subscribed');

    const ack: WSOutgoingMessage = {
      type: 'subscribe.ack',
      payload: { topics: [...client.topics] },
      timestamp: new Date().toISOString(),
    };
    safeSend(client.socket, serialize(ack));
  }

  function handleChatSend(client: WSClient, payload: unknown): void {
    const result = ChatSendPayloadSchema.safeParse(payload);
    if (!result.success) {
      sendError(client, 'INVALID_PAYLOAD', 'chat.send requires { text: string }');
      return;
    }

    for (const handler of messageHandlers) {
      handler(client.id, 'chat.send', result.data);
    }
  }

  function handleApprovalRespond(client: WSClient, payload: unknown): void {
    const result = ApprovalRespondPayloadSchema.safeParse(payload);
    if (!result.success) {
      sendError(client, 'INVALID_PAYLOAD', 'approval.respond requires { approvalId, decision }');
      return;
    }

    for (const handler of messageHandlers) {
      handler(client.id, 'approval.respond', result.data);
    }
  }

  function handleTaskKill(client: WSClient, payload: unknown): void {
    const result = TaskKillPayloadSchema.safeParse(payload);
    if (!result.success) {
      sendError(client, 'INVALID_PAYLOAD', 'task.kill requires { taskId: string }');
      return;
    }

    for (const handler of messageHandlers) {
      handler(client.id, 'task.kill', result.data);
    }
  }

  function sendError(client: WSClient, code: string, detail: string): void {
    const errorMsg: WSOutgoingMessage = {
      type: 'error',
      payload: { code, detail },
      timestamp: new Date().toISOString(),
    };
    safeSend(client.socket, serialize(errorMsg));
  }

  function safeSend(socket: WebSocket, data: string): void {
    try {
      if (socket.readyState === 1) { // WebSocket.OPEN
        socket.send(data);
      }
    } catch (sendErr: unknown) {
      const message = sendErr instanceof Error ? sendErr.message : String(sendErr);
      log.warn({ error: message }, 'Failed to send WebSocket message');
    }
  }

  return {
    addClient(socket: WebSocket): string {
      const clientId = nanoid();
      const client: WSClient = {
        id: clientId,
        socket,
        topics: new Set<string>(),
        connectedAt: new Date(),
        authenticated: !authRequired,
      };

      clients.set(clientId, client);

      // Set auth timeout — disconnect if client doesn't authenticate in time
      if (authRequired) {
        const authTimer = setTimeout(() => {
          if (!client.authenticated) {
            log.warn({ clientId }, 'WebSocket client auth timeout — disconnecting');
            sendError(client, 'AUTH_TIMEOUT', `Authentication required within ${authTimeoutMs}ms`);
            try {
              client.socket.close();
            } catch {
              // best-effort close
            }
            clients.delete(clientId);
          }
        }, authTimeoutMs);
        authTimer.unref();

        // Clear timeout on disconnect to avoid memory leak
        socket.on('close', () => {
          clearTimeout(authTimer);
        });
      }

      socket.on('message', (data: Buffer | string) => {
        const raw = typeof data === 'string' ? data : data.toString('utf-8');
        handleRawMessage(client, raw);
      });

      socket.on('close', () => {
        clients.delete(clientId);
        log.debug({ clientId }, 'WebSocket client disconnected');
      });

      socket.on('error', (err: Error) => {
        log.warn({ clientId, error: err.message }, 'WebSocket client error');
        clients.delete(clientId);
      });

      log.debug({ clientId }, 'WebSocket client connected');
      return clientId;
    },

    removeClient(clientId: string): void {
      const client = clients.get(clientId);
      if (client) {
        try {
          client.socket.close();
        } catch {
          // best-effort close
        }
        clients.delete(clientId);
      }
    },

    broadcast(topic: string, message: WSOutgoingMessage): void {
      const data = serialize(message);
      for (const client of clients.values()) {
        if (!client.authenticated) continue;
        if (client.topics.has(topic) || client.topics.has('*')) {
          safeSend(client.socket, data);
        }
      }
    },

    sendTo(clientId: string, message: WSOutgoingMessage): void {
      const client = clients.get(clientId);
      if (client) {
        safeSend(client.socket, serialize(message));
      }
    },

    onMessage(handler: WSMessageHandler): void {
      messageHandlers.push(handler);
    },

    clientCount(): number {
      return clients.size;
    },

    disconnectAll(): void {
      for (const client of clients.values()) {
        try {
          client.socket.close();
        } catch {
          // best-effort close
        }
      }
      clients.clear();
      log.info('All WebSocket clients disconnected');
    },
  };
}
