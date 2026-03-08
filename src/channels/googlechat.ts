/**
 * Google Chat channel adapter.
 * Bridges the Google Workspace Chat API to the ChannelAdapter interface.
 * Uses dependency injection for the Google Chat connection.
 * Supports both webhook-based and service account authentication.
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

/** Google Chat message character limit. */
const GCHAT_MSG_LIMIT = 4096;

// --- Google Chat connection abstraction types ---

/** A minimal Google Chat inbound message. */
export interface GoogleChatInboundMessage {
  name: string;
  sender: { name: string; displayName: string; email?: string; type: string };
  space: { name: string; type: string; displayName?: string };
  text: string;
  createTime: string;
  type: 'MESSAGE' | 'ADDED_TO_SPACE' | 'REMOVED_FROM_SPACE';
}

/** Minimal Google Chat connection interface for dependency injection. */
export interface GoogleChatConnection {
  start(serviceAccountKey: string, webhookPort?: number): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (message: GoogleChatInboundMessage) => Promise<void>): void;
  send(spaceName: string, message: string): Promise<void>;
  isRunning(): boolean;
}

/**
 * Split a message into chunks that fit within Google Chat's limit.
 */
export function splitMessage(text: string, limit: number = GCHAT_MSG_LIMIT): string[] {
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
 * Create a Google Chat channel adapter.
 *
 * @param connection - Injected Google Chat connection (uses googleapis in production).
 * @returns A fully-wired Google Chat ChannelAdapter.
 */
export function createGoogleChatAdapter(connection?: GoogleChatConnection): ChannelAdapter {
  const log = channelLogger.child({ adapter: 'googlechat' });

  const conn: GoogleChatConnection | undefined = connection;
  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  let allowFromList: string[] = [];

  function isUserAllowed(senderName: string): boolean {
    if (allowFromList.length === 0) return true;
    return allowFromList.includes(senderName);
  }

  function normalizeMessage(message: GoogleChatInboundMessage): ChannelMessage {
    return {
      id: nanoid(),
      channelType: 'googlechat',
      channelId: message.space.name,
      userId: message.sender.name,
      text: message.text,
      attachments: [],
      timestamp: new Date(message.createTime),
      raw: message,
    };
  }

  const adapter: ChannelAdapter = {
    name: 'Google Chat',
    type: 'googlechat' as ChannelType,

    async connect(config: ChannelConfig): Promise<void> {
      const serviceAccountKey = config['serviceAccountKey'] as string | undefined;

      if (!serviceAccountKey) {
        throw new Error(
          'Google Chat adapter requires serviceAccountKey in config. ' +
            'Create a service account in Google Cloud Console with Chat API access.',
        );
      }

      allowFromList = config.allowFrom ?? [];

      if (!conn) {
        throw new Error(
          'Google Chat adapter requires an injected GoogleChatConnection. ' +
            'Install googleapis and provide a connection.',
        );
      }

      try {
        conn.onMessage(async (message: GoogleChatInboundMessage) => {
          if (message.type !== 'MESSAGE') return;
          if (!isUserAllowed(message.sender.name)) {
            log.debug({ sender: message.sender.displayName }, 'Message from non-allowed user; dropping');
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
            log.error({ sender: message.sender.displayName, error }, 'Message handler threw an error');
          }
        });

        const webhookPort = config['webhookPort'] as number | undefined;
        await conn.start(serviceAccountKey, webhookPort);
        connected = true;
        log.info('Google Chat adapter connected');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        connected = false;
        throw new Error(`Failed to connect Google Chat adapter: ${errorMessage}`);
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
          log.error({ error }, 'Error stopping Google Chat connection');
        }
      }
      messageHandler = undefined;
      connected = false;
      log.info('Google Chat adapter disconnected');
    },

    isConnected(): boolean {
      return connected;
    },
  };

  return adapter;
}
