/**
 * WebChat channel adapter.
 * Bridges WebSocket connections to the ChannelAdapter interface.
 * The adapter does NOT own the WebSocket server — it receives messages
 * from the gateway and sends responses through registered client send functions.
 * See HLD Section 10 for channel adapter architecture.
 */

import { nanoid } from 'nanoid';
import { channelLogger } from '../utils/logger.js';
import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelMessage,
  ChannelType,
  SendOptions,
  WSMessage,
} from '../types/index.js';

/** Payload shape expected inside a `chat.send` WSMessage */
interface ChatSendPayload {
  text: string;
  replyToMessageId?: string;
}

/** Type guard for ChatSendPayload */
function isChatSendPayload(value: unknown): value is ChatSendPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.text === 'string';
}

/**
 * Create a WebChat channel adapter.
 *
 * @returns A fully-wired WebChat ChannelAdapter with additional helpers
 *          for WebSocket client management.
 */
export function createWebChatAdapter(): WebChatAdapter {
  const log = channelLogger.child({ adapter: 'webchat' });

  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  const clients = new Map<string, (data: WSMessage) => void>();

  const adapter: WebChatAdapter = {
    name: 'WebChat',
    type: 'webchat' as ChannelType,

    /** Mark the adapter as connected. WebChat requires no external auth. */
    async connect(_config: ChannelConfig): Promise<void> {
      connected = true;
      log.info('WebChat adapter connected');
    },

    /**
     * Register the message handler callback.
     * Called by the orchestrator to receive inbound channel messages.
     */
    onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
      messageHandler = handler;
      log.debug('Message handler registered');
    },

    /**
     * Send a response to a specific WebSocket client.
     *
     * @param channelId - The client ID to send the message to.
     * @param text      - The message text.
     * @param options   - Optional send configuration.
     */
    async send(
      channelId: string,
      text: string,
      options?: SendOptions,
    ): Promise<void> {
      const clientSend = clients.get(channelId);
      if (!clientSend) {
        log.warn({ channelId }, 'Cannot send: client not registered');
        return;
      }

      const outbound: WSMessage = {
        type: 'chat.message',
        payload: {
          id: nanoid(),
          text,
          replyToMessageId: options?.replyToMessageId,
          buttons: options?.buttons,
          parseMode: options?.parseMode,
        },
        timestamp: new Date().toISOString(),
      };

      try {
        clientSend(outbound);
        log.debug({ channelId }, 'Message sent to client');
      } catch (error: unknown) {
        log.error({ channelId, error }, 'Failed to send message to client');
      }
    },

    /** Disconnect the adapter and clean up all registered clients. */
    async disconnect(): Promise<void> {
      clients.clear();
      messageHandler = undefined;
      connected = false;
      log.info('WebChat adapter disconnected');
    },

    /** Check whether the adapter is currently connected. */
    isConnected(): boolean {
      return connected;
    },

    /**
     * Handle an inbound WebSocket message from a client.
     * Normalizes the WS payload into a ChannelMessage and forwards
     * it to the registered message handler.
     *
     * @param clientId - The WebSocket client identifier.
     * @param data     - The raw WSMessage from the client.
     */
    async handleWebSocketMessage(
      clientId: string,
      data: WSMessage,
    ): Promise<void> {
      if (data.type !== 'chat.send') {
        log.debug({ clientId, type: data.type }, 'Ignoring non-chat message');
        return;
      }

      if (!isChatSendPayload(data.payload)) {
        log.warn({ clientId }, 'Invalid chat.send payload');
        return;
      }

      const channelMessage: ChannelMessage = {
        id: nanoid(),
        channelType: 'webchat',
        channelId: clientId,
        userId: clientId,
        text: data.payload.text,
        attachments: [],
        replyToMessageId: data.payload.replyToMessageId,
        timestamp: new Date(data.timestamp),
        raw: data,
      };

      if (!messageHandler) {
        log.warn('No message handler registered; dropping message');
        return;
      }

      try {
        await messageHandler(channelMessage);
      } catch (error: unknown) {
        log.error({ clientId, error }, 'Message handler threw an error');
      }
    },

    /**
     * Register a WebSocket client's send function so `send()` can
     * route messages back to it.
     *
     * @param clientId - Unique identifier for the client.
     * @param sendFn   - Function that sends a WSMessage to the client.
     */
    registerClient(
      clientId: string,
      sendFn: (data: WSMessage) => void,
    ): void {
      clients.set(clientId, sendFn);
      log.debug({ clientId }, 'Client registered');
    },

    /**
     * Remove a disconnected WebSocket client.
     *
     * @param clientId - The client to remove.
     */
    removeClient(clientId: string): void {
      clients.delete(clientId);
      log.debug({ clientId }, 'Client removed');
    },
  };

  return adapter;
}

/** Extended ChannelAdapter with WebSocket client management methods. */
export interface WebChatAdapter extends ChannelAdapter {
  handleWebSocketMessage(clientId: string, data: WSMessage): Promise<void>;
  registerClient(clientId: string, sendFn: (data: WSMessage) => void): void;
  removeClient(clientId: string): void;
}
