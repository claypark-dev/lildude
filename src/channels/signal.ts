/**
 * Signal channel adapter.
 * Bridges signal-cli JSON RPC interface to the ChannelAdapter interface.
 * Uses dependency injection for the signal-cli connection — in production,
 * signal-cli must be installed separately on the host system.
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

/** Signal message character limit. */
const SIGNAL_MSG_LIMIT = 4096;

// --- Signal connection abstraction types ---

/** A minimal Signal inbound message. */
export interface SignalInboundMessage {
  source: string;
  timestamp: number;
  body: string;
  groupId?: string;
}

/** Minimal Signal connection interface for dependency injection. */
export interface SignalConnection {
  start(phoneNumber: string): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (message: SignalInboundMessage) => Promise<void>): void;
  send(recipient: string, message: string): Promise<void>;
  isRunning(): boolean;
}

/**
 * Split a message into chunks that fit within Signal's character limit.
 * Splits on newlines when possible; otherwise splits at the hard limit.
 *
 * @param text  - The full message text to split.
 * @param limit - Maximum characters per chunk (defaults to 4096).
 * @returns An array of text chunks, each within the limit.
 */
export function splitMessage(text: string, limit: number = SIGNAL_MSG_LIMIT): string[] {
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
 * Create a Signal channel adapter.
 *
 * @param connection - Injected Signal connection (for testing or alternative implementations).
 * @returns A fully-wired Signal ChannelAdapter.
 */
export function createSignalAdapter(connection?: SignalConnection): ChannelAdapter {
  const log = channelLogger.child({ adapter: 'signal' });

  let conn: SignalConnection | undefined = connection;
  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  let allowFromList: string[] = [];
  let botPhoneNumber: string | undefined;

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
   * Normalize a Signal inbound message into a ChannelMessage.
   *
   * @param message - The Signal inbound message.
   * @returns A normalized ChannelMessage.
   */
  function normalizeMessage(message: SignalInboundMessage): ChannelMessage {
    return {
      id: nanoid(),
      channelType: 'signal',
      channelId: message.groupId ?? message.source,
      userId: message.source,
      text: message.body,
      attachments: [],
      timestamp: new Date(message.timestamp),
      raw: message,
    };
  }

  const adapter: ChannelAdapter = {
    name: 'Signal',
    type: 'signal' as ChannelType,

    /**
     * Connect to Signal via signal-cli JSON RPC.
     *
     * @param config - Channel config with phoneNumber and optional allowFrom.
     */
    async connect(config: ChannelConfig): Promise<void> {
      const phoneNumber = config['phoneNumber'] as string | undefined;
      if (!phoneNumber) {
        throw new Error(
          'Signal adapter requires a phone number in config.phoneNumber. ' +
            'This should be the phone number registered with signal-cli.',
        );
      }

      botPhoneNumber = phoneNumber;
      allowFromList = config.allowFrom ?? [];

      if (!conn) {
        throw new Error(
          'Signal adapter requires an injected SignalConnection. ' +
            'Install signal-cli on your system and provide a connection.',
        );
      }

      try {
        conn.onMessage(async (message: SignalInboundMessage) => {
          if (!isUserAllowed(message.source)) {
            log.debug({ source: message.source }, 'Message from non-allowed number; dropping');
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
            log.error({ source: message.source, error }, 'Message handler threw an error');
          }
        });

        await conn.start(phoneNumber);
        connected = true;
        log.info({ phoneNumber: botPhoneNumber }, 'Signal adapter connected');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        connected = false;
        throw new Error(`Failed to connect Signal adapter: ${errorMessage}`);
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
     * Send a text message to a Signal recipient.
     * Handles message splitting for long messages.
     *
     * @param channelId - The recipient phone number or group ID.
     * @param text      - The message text.
     * @param _options  - Optional send configuration (limited support on Signal).
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
          await conn.send(channelId, chunks[chunkIndex]);
        } catch (error: unknown) {
          log.error(
            { channelId, chunkIndex, error },
            'Failed to send message chunk',
          );
        }
      }
    },

    /**
     * Disconnect from Signal and clean up.
     */
    async disconnect(): Promise<void> {
      if (conn) {
        try {
          await conn.stop();
        } catch (error: unknown) {
          log.error({ error }, 'Error stopping Signal connection');
        }
      }
      messageHandler = undefined;
      connected = false;
      botPhoneNumber = undefined;
      log.info('Signal adapter disconnected');
    },

    /**
     * Check whether the adapter is currently connected.
     *
     * @returns True if the Signal connection is active.
     */
    isConnected(): boolean {
      return connected;
    },
  };

  return adapter;
}
