/**
 * LINE channel adapter.
 * Bridges the LINE Messaging API to the ChannelAdapter interface.
 * Uses dependency injection for the LINE SDK connection.
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

/** LINE message character limit per text message. */
const LINE_MSG_LIMIT = 5000;

// --- LINE connection abstraction types ---

/** A minimal LINE webhook event. */
export interface LineInboundMessage {
  replyToken: string;
  type: 'message' | 'follow' | 'unfollow' | 'join' | 'leave';
  source: { userId: string; groupId?: string; roomId?: string; type: string };
  message?: { id: string; type: string; text?: string };
  timestamp: number;
}

/** Minimal LINE connection interface for dependency injection. */
export interface LineConnection {
  start(channelAccessToken: string, channelSecret: string, webhookPort?: number): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (event: LineInboundMessage) => Promise<void>): void;
  send(targetId: string, message: string): Promise<void>;
  reply(replyToken: string, message: string): Promise<void>;
  isRunning(): boolean;
}

/**
 * Split a message into chunks that fit within LINE's limit.
 */
export function splitMessage(text: string, limit: number = LINE_MSG_LIMIT): string[] {
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
 * Create a LINE channel adapter.
 *
 * @param connection - Injected LINE connection (uses @line/bot-sdk in production).
 * @returns A fully-wired LINE ChannelAdapter.
 */
export function createLineAdapter(connection?: LineConnection): ChannelAdapter {
  const log = channelLogger.child({ adapter: 'line' });

  const conn: LineConnection | undefined = connection;
  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  let allowFromList: string[] = [];

  function isUserAllowed(userId: string): boolean {
    if (allowFromList.length === 0) return true;
    return allowFromList.includes(userId);
  }

  function normalizeMessage(event: LineInboundMessage): ChannelMessage {
    return {
      id: nanoid(),
      channelType: 'line',
      channelId: event.source.groupId ?? event.source.roomId ?? event.source.userId,
      userId: event.source.userId,
      text: event.message?.text ?? '',
      attachments: [],
      timestamp: new Date(event.timestamp),
      raw: event,
    };
  }

  const adapter: ChannelAdapter = {
    name: 'LINE',
    type: 'line' as ChannelType,

    async connect(config: ChannelConfig): Promise<void> {
      const channelAccessToken = config['channelAccessToken'] as string | undefined;
      const channelSecret = config['channelSecret'] as string | undefined;

      if (!channelAccessToken || !channelSecret) {
        throw new Error(
          'LINE adapter requires channelAccessToken and channelSecret in config. ' +
            'Create a Messaging API channel in the LINE Developers Console.',
        );
      }

      allowFromList = config.allowFrom ?? [];

      if (!conn) {
        throw new Error(
          'LINE adapter requires an injected LineConnection. ' +
            'Install @line/bot-sdk and provide a connection.',
        );
      }

      try {
        conn.onMessage(async (event: LineInboundMessage) => {
          if (event.type !== 'message' || event.message?.type !== 'text') return;
          if (!isUserAllowed(event.source.userId)) {
            log.debug({ userId: event.source.userId }, 'Message from non-allowed user; dropping');
            return;
          }

          const channelMessage = normalizeMessage(event);

          if (!messageHandler) {
            log.warn('No message handler registered; dropping message');
            return;
          }

          try {
            await messageHandler(channelMessage);
          } catch (error: unknown) {
            log.error({ userId: event.source.userId, error }, 'Message handler threw an error');
          }
        });

        const webhookPort = config['webhookPort'] as number | undefined;
        await conn.start(channelAccessToken, channelSecret, webhookPort);
        connected = true;
        log.info('LINE adapter connected');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        connected = false;
        throw new Error(`Failed to connect LINE adapter: ${errorMessage}`);
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
          log.error({ error }, 'Error stopping LINE connection');
        }
      }
      messageHandler = undefined;
      connected = false;
      log.info('LINE adapter disconnected');
    },

    isConnected(): boolean {
      return connected;
    },
  };

  return adapter;
}
