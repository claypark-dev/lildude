/**
 * Matrix channel adapter.
 * Bridges the Matrix protocol to the ChannelAdapter interface using
 * dependency injection for the Matrix SDK connection.
 * Supports self-hosted homeservers and end-to-end encryption.
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

/** Matrix message character limit (events can be up to 65535 bytes). */
const MATRIX_MSG_LIMIT = 8192;

// --- Matrix connection abstraction types ---

/** A minimal Matrix inbound message/event. */
export interface MatrixInboundMessage {
  eventId: string;
  roomId: string;
  sender: string;
  body: string;
  timestamp: number;
  type: string;
}

/** Minimal Matrix connection interface for dependency injection. */
export interface MatrixConnection {
  start(homeserverUrl: string, accessToken: string): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (message: MatrixInboundMessage) => Promise<void>): void;
  send(roomId: string, message: string): Promise<void>;
  isRunning(): boolean;
}

/**
 * Split a message into chunks that fit within Matrix's practical limit.
 *
 * @param text  - The full message text to split.
 * @param limit - Maximum characters per chunk (defaults to 8192).
 * @returns An array of text chunks, each within the limit.
 */
export function splitMessage(text: string, limit: number = MATRIX_MSG_LIMIT): string[] {
  if (text.length <= limit) return [text];

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
 * Create a Matrix channel adapter.
 *
 * @param connection - Injected Matrix connection (uses matrix-js-sdk in production).
 * @returns A fully-wired Matrix ChannelAdapter.
 */
export function createMatrixAdapter(connection?: MatrixConnection): ChannelAdapter {
  const log = channelLogger.child({ adapter: 'matrix' });

  const conn: MatrixConnection | undefined = connection;
  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  let allowFromList: string[] = [];

  function isUserAllowed(userId: string): boolean {
    if (allowFromList.length === 0) return true;
    return allowFromList.includes(userId);
  }

  function normalizeMessage(message: MatrixInboundMessage): ChannelMessage {
    return {
      id: nanoid(),
      channelType: 'matrix',
      channelId: message.roomId,
      userId: message.sender,
      text: message.body,
      attachments: [],
      timestamp: new Date(message.timestamp),
      raw: message,
    };
  }

  const adapter: ChannelAdapter = {
    name: 'Matrix',
    type: 'matrix' as ChannelType,

    async connect(config: ChannelConfig): Promise<void> {
      const homeserverUrl = config['homeserverUrl'] as string | undefined;
      const accessToken = config['accessToken'] as string | undefined;

      if (!homeserverUrl || !accessToken) {
        throw new Error(
          'Matrix adapter requires homeserverUrl and accessToken in config.',
        );
      }

      allowFromList = config.allowFrom ?? [];

      if (!conn) {
        throw new Error(
          'Matrix adapter requires an injected MatrixConnection. ' +
            'Install matrix-js-sdk and provide a connection.',
        );
      }

      try {
        conn.onMessage(async (message: MatrixInboundMessage) => {
          if (message.type !== 'm.room.message') return;
          if (!isUserAllowed(message.sender)) {
            log.debug({ sender: message.sender }, 'Message from non-allowed user; dropping');
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
            log.error({ sender: message.sender, error }, 'Message handler threw an error');
          }
        });

        await conn.start(homeserverUrl, accessToken);
        connected = true;
        log.info({ homeserverUrl }, 'Matrix adapter connected');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        connected = false;
        throw new Error(`Failed to connect Matrix adapter: ${errorMessage}`);
      }
    },

    onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
      messageHandler = handler;
      log.debug('Message handler registered');
    },

    async send(channelId: string, text: string, _options?: SendOptions): Promise<void> {
      if (!conn) {
        log.warn('Cannot send: connection is not initialized');
        return;
      }

      const chunks = splitMessage(text);
      for (let i = 0; i < chunks.length; i++) {
        try {
          await conn.send(channelId, chunks[i]);
        } catch (error: unknown) {
          log.error({ channelId, chunkIndex: i, error }, 'Failed to send message chunk');
        }
      }
    },

    async disconnect(): Promise<void> {
      if (conn) {
        try {
          await conn.stop();
        } catch (error: unknown) {
          log.error({ error }, 'Error stopping Matrix connection');
        }
      }
      messageHandler = undefined;
      connected = false;
      log.info('Matrix adapter disconnected');
    },

    isConnected(): boolean {
      return connected;
    },
  };

  return adapter;
}
