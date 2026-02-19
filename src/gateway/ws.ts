/**
 * WebSocket gateway handler.
 * Manages client connections, subscriptions, and bidirectional message dispatch.
 * Protocol:
 *   Client -> Server: subscribe, chat.send, approval.respond, task.kill
 *   Server -> Client: chat.message, chat.stream, task.update, cost.update, approval.request
 *
 * See HLD Section 7 for gateway architecture.
 */

import type { WebSocket } from 'ws';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { gatewayLogger } from '../utils/logger.js';

const log = gatewayLogger;

// ── Schemas ──────────────────────────────────────────────────────────

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
  type: z.enum(['subscribe', 'chat.send', 'approval.respond', 'task.kill']),
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
 * @returns A {@link WSManager} instance.
 */
export function createWSManager(): WSManager {
  const clients = new Map<string, WSClient>();
  const messageHandlers: WSMessageHandler[] = [];

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
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      sendError(client, 'INVALID_JSON', 'Message is not valid JSON');
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
      case 'approval.respond':
        handleApprovalRespond(client, payload);
        break;
      case 'task.kill':
        handleTaskKill(client, payload);
        break;
    }
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
      };

      clients.set(clientId, client);

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
