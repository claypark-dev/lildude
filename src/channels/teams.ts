/**
 * Microsoft Teams channel adapter.
 * Bridges the Bot Framework / Azure Bot Service to the ChannelAdapter interface.
 * Uses dependency injection for the Teams bot connection.
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

/** Teams message character limit. */
const TEAMS_MSG_LIMIT = 28000;

// --- Teams connection abstraction types ---

/** A minimal Teams inbound activity. */
export interface TeamsInboundMessage {
  activityId: string;
  conversationId: string;
  from: { id: string; name?: string };
  text: string;
  timestamp: string;
  type: 'message' | 'conversationUpdate' | 'event';
}

/** Minimal Teams connection interface for dependency injection. */
export interface TeamsConnection {
  start(appId: string, appPassword: string): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (message: TeamsInboundMessage) => Promise<void>): void;
  send(conversationId: string, message: string): Promise<void>;
  isRunning(): boolean;
}

/**
 * Split a message into chunks that fit within Teams' limit.
 */
export function splitMessage(text: string, limit: number = TEAMS_MSG_LIMIT): string[] {
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
 * Create a Microsoft Teams channel adapter.
 *
 * @param connection - Injected Teams connection (uses botbuilder in production).
 * @returns A fully-wired Teams ChannelAdapter.
 */
export function createTeamsAdapter(connection?: TeamsConnection): ChannelAdapter {
  const log = channelLogger.child({ adapter: 'teams' });

  const conn: TeamsConnection | undefined = connection;
  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  let allowFromList: string[] = [];

  function isUserAllowed(userId: string): boolean {
    if (allowFromList.length === 0) return true;
    return allowFromList.includes(userId);
  }

  function normalizeMessage(message: TeamsInboundMessage): ChannelMessage {
    return {
      id: nanoid(),
      channelType: 'teams',
      channelId: message.conversationId,
      userId: message.from.id,
      text: message.text,
      attachments: [],
      timestamp: new Date(message.timestamp),
      raw: message,
    };
  }

  const adapter: ChannelAdapter = {
    name: 'Microsoft Teams',
    type: 'teams' as ChannelType,

    async connect(config: ChannelConfig): Promise<void> {
      const appId = config['appId'] as string | undefined;
      const appPassword = config['appPassword'] as string | undefined;

      if (!appId || !appPassword) {
        throw new Error(
          'Teams adapter requires appId and appPassword in config. ' +
            'Create a Bot Registration in Azure Portal.',
        );
      }

      allowFromList = config.allowFrom ?? [];

      if (!conn) {
        throw new Error(
          'Teams adapter requires an injected TeamsConnection. ' +
            'Install botbuilder and provide a connection.',
        );
      }

      try {
        conn.onMessage(async (message: TeamsInboundMessage) => {
          if (message.type !== 'message') return;
          if (!isUserAllowed(message.from.id)) {
            log.debug({ from: message.from.id }, 'Message from non-allowed user; dropping');
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
            log.error({ from: message.from.id, error }, 'Message handler threw an error');
          }
        });

        await conn.start(appId, appPassword);
        connected = true;
        log.info('Teams adapter connected');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        connected = false;
        throw new Error(`Failed to connect Teams adapter: ${errorMessage}`);
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
          log.error({ error }, 'Error stopping Teams connection');
        }
      }
      messageHandler = undefined;
      connected = false;
      log.info('Teams adapter disconnected');
    },

    isConnected(): boolean {
      return connected;
    },
  };

  return adapter;
}
