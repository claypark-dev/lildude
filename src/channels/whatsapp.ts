/**
 * WhatsApp channel adapter.
 * Bridges WhatsApp messaging to the ChannelAdapter interface.
 * Uses dependency injection for the WhatsApp connection — the adapter
 * defines its own connection interface that can be satisfied by
 * whatsapp-web.js, Baileys, or a test mock.
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
} from '../types/index.js';

/** WhatsApp message character limit. */
const WHATSAPP_MSG_LIMIT = 4096;

// --- WhatsApp connection abstraction types ---

/** A minimal WhatsApp inbound message. */
export interface WhatsAppInboundMessage {
  id: string;
  from: string;
  body: string;
  timestamp: number;
  isGroup: boolean;
  chatId: string;
}

/** Minimal WhatsApp connection interface for dependency injection. */
export interface WhatsAppConnection {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  onMessage(handler: (message: WhatsAppInboundMessage) => Promise<void>): void;
  sendMessage(chatId: string, text: string): Promise<void>;
  isReady(): boolean;
}

/**
 * Split a message into chunks that fit within WhatsApp's character limit.
 * Splits on newlines when possible; otherwise splits at the hard limit.
 *
 * @param text  - The full message text to split.
 * @param limit - Maximum characters per chunk (defaults to 4096).
 * @returns An array of text chunks, each within the limit.
 */
export function splitMessage(text: string, limit: number = WHATSAPP_MSG_LIMIT): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    const sliceCandidate = remaining.slice(0, limit);
    const lastNewline = sliceCandidate.lastIndexOf('\n');
    const splitAt = lastNewline > 0 ? lastNewline + 1 : limit;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

/**
 * Sleep utility for rate limiting.
 *
 * @param ms - Milliseconds to wait.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Minimum delay between sends (ms). */
const RATE_LIMIT_DELAY_MS = 500;

/**
 * Create a WhatsApp channel adapter.
 *
 * @param connection - Injected WhatsApp connection (for testing or alternative libs).
 * @returns A fully-wired WhatsApp ChannelAdapter.
 */
export function createWhatsAppAdapter(connection?: WhatsAppConnection): ChannelAdapter {
  const log = channelLogger.child({ adapter: 'whatsapp' });

  let conn: WhatsAppConnection | undefined = connection;
  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  let allowFromList: string[] = [];
  let lastSendTimestamp = 0;

  /**
   * Determine whether a phone number is permitted by the allowFrom filter.
   *
   * @param phoneNumber - The sender's phone number.
   * @returns True if the phone is allowed (or if allowFrom is empty).
   */
  function isUserAllowed(phoneNumber: string): boolean {
    if (allowFromList.length === 0) {
      return true;
    }
    return allowFromList.includes(phoneNumber);
  }

  /**
   * Normalize a WhatsApp inbound message into a ChannelMessage.
   *
   * @param message - The WhatsApp inbound message.
   * @returns A normalized ChannelMessage.
   */
  function normalizeMessage(message: WhatsAppInboundMessage): ChannelMessage {
    return {
      id: nanoid(),
      channelType: 'whatsapp',
      channelId: message.chatId,
      userId: message.from,
      text: message.body,
      attachments: [],
      timestamp: new Date(message.timestamp * 1000),
      raw: message,
    };
  }

  /**
   * Enforce a minimum delay between API calls for rate limiting.
   */
  async function throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastSendTimestamp;
    if (elapsed < RATE_LIMIT_DELAY_MS) {
      await sleep(RATE_LIMIT_DELAY_MS - elapsed);
    }
    lastSendTimestamp = Date.now();
  }

  const adapter: ChannelAdapter = {
    name: 'WhatsApp',
    type: 'whatsapp' as ChannelType,

    /**
     * Connect to WhatsApp by initializing the injected connection.
     *
     * @param config - Channel config with optional allowFrom.
     */
    async connect(config: ChannelConfig): Promise<void> {
      allowFromList = config.allowFrom ?? [];

      if (!conn) {
        throw new Error(
          'WhatsApp adapter requires an injected WhatsAppConnection. ' +
            'Install whatsapp-web.js or @whiskeysockets/baileys and provide a connection.',
        );
      }

      try {
        conn.onMessage(async (message: WhatsAppInboundMessage) => {
          const phoneNumber = message.from;

          if (!isUserAllowed(phoneNumber)) {
            log.debug({ phoneNumber }, 'Message from non-allowed number; dropping');
            return;
          }

          const channelMessage = normalizeMessage(message);

          if (!messageHandler) {
            log.warn('No message handler registered; dropping message');
            return;
          }

          try {
            await messageHandler(channelMessage);
          } catch (error: unknown) {
            log.error({ phoneNumber, error }, 'Message handler threw an error');
          }
        });

        await conn.initialize();
        connected = true;
        log.info('WhatsApp adapter connected');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        connected = false;
        throw new Error(`Failed to connect WhatsApp adapter: ${errorMessage}`);
      }
    },

    /**
     * Register the message handler callback.
     *
     * @param handler - Async function to invoke for each incoming message.
     */
    onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
      messageHandler = handler;
      log.debug('Message handler registered');
    },

    /**
     * Send a text message to a WhatsApp chat.
     * Handles message splitting and rate limiting.
     *
     * @param channelId - The WhatsApp chat ID to send to.
     * @param text      - The message text.
     * @param _options  - Optional send configuration (limited support on WhatsApp).
     */
    async send(
      channelId: string,
      text: string,
      _options?: SendOptions,
    ): Promise<void> {
      if (!conn) {
        log.warn('Cannot send: connection is not initialized');
        return;
      }

      const chunks = splitMessage(text);

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        try {
          await throttle();
          await conn.sendMessage(channelId, chunks[chunkIndex]);
        } catch (error: unknown) {
          log.error(
            { channelId, chunkIndex, error },
            'Failed to send message chunk',
          );
        }
      }
    },

    /**
     * Disconnect from WhatsApp and clean up.
     */
    async disconnect(): Promise<void> {
      if (conn) {
        try {
          await conn.destroy();
        } catch (error: unknown) {
          log.error({ error }, 'Error destroying WhatsApp connection');
        }
      }
      messageHandler = undefined;
      connected = false;
      log.info('WhatsApp adapter disconnected');
    },

    /**
     * Check whether the adapter is currently connected.
     *
     * @returns True if the WhatsApp connection is active.
     */
    isConnected(): boolean {
      return connected;
    },
  };

  return adapter;
}
