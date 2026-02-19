/**
 * Slack channel adapter.
 * Bridges Slack Bot events to the ChannelAdapter interface via Socket Mode.
 * Uses dependency injection for the Slack client — in production, users
 * install @slack/bolt separately; in tests, a mock is injected.
 * See HLD Section 10 for channel adapter architecture.
 */

import { nanoid } from 'nanoid';
import { channelLogger } from '../utils/logger.js';
import type {
  ChannelAdapter, ChannelConfig, ChannelMessage, ChannelType, SendOptions,
} from '../types/index.js';

/** Slack message character limit (Slack allows 4000, use 3000 for safety). */
const SLACK_MSG_LIMIT = 3000;

/** Minimum delay between sends to avoid Slack rate limits (ms). */
const RATE_LIMIT_DELAY_MS = 1000;

/** A minimal Slack message event (subset of Slack's event payload). */
export interface SlackMessageEvent {
  type: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
}

/** Options for posting a Slack message. */
export interface SlackPostMessageOptions {
  channel: string;
  text: string;
  thread_ts?: string;
  blocks?: unknown[];
}

/** Minimal Slack client interface for dependency injection. */
export interface SlackClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (event: SlackMessageEvent) => Promise<void>): void;
  postMessage(options: SlackPostMessageOptions): Promise<void>;
}

/** Factory function type to create a SlackClient from config. */
export type SlackClientFactory = (config: { token: string; appToken: string }) => SlackClient;

/**
 * Split a message into chunks that fit within Slack's character limit.
 *
 * @param text  - The full message text to split.
 * @param limit - Maximum characters per chunk (defaults to 3000).
 * @returns An array of text chunks, each within the limit.
 */
export function splitMessage(text: string, limit: number = SLACK_MSG_LIMIT): string[] {
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
 * Build Slack block-kit button elements from SendOptions buttons.
 *
 * @param buttons - Array of button definitions with label and callback id.
 * @returns A Slack actions block containing the buttons.
 */
function buildButtonBlocks(
  buttons: Array<{ label: string; id: string }>,
): unknown[] {
  return [{
    type: 'actions',
    elements: buttons.map((btn) => ({
      type: 'button',
      text: { type: 'plain_text', text: btn.label },
      action_id: btn.id,
      value: btn.id,
    })),
  }];
}

/** Sleep utility for rate limiting. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Create a Slack channel adapter.
 *
 * @param clientFactory - Optional factory to create the Slack client (for testing).
 * @returns A fully-wired Slack ChannelAdapter.
 */
export function createSlackAdapter(clientFactory?: SlackClientFactory): ChannelAdapter {
  const log = channelLogger.child({ adapter: 'slack' });

  let client: SlackClient | undefined;
  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  let allowFromList: string[] = [];
  let lastSendTimestamp = 0;

  function isUserAllowed(userId: string): boolean {
    if (allowFromList.length === 0) return true;
    return allowFromList.includes(userId);
  }

  function normalizeMessage(event: SlackMessageEvent): ChannelMessage {
    return {
      id: nanoid(),
      channelType: 'slack',
      channelId: event.channel,
      userId: event.user,
      text: event.text,
      attachments: [],
      replyToMessageId: event.thread_ts,
      timestamp: new Date(parseFloat(event.ts) * 1000),
      raw: event,
    };
  }

  async function throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastSendTimestamp;
    if (elapsed < RATE_LIMIT_DELAY_MS) await sleep(RATE_LIMIT_DELAY_MS - elapsed);
    lastSendTimestamp = Date.now();
  }

  const adapter: ChannelAdapter = {
    name: 'Slack',
    type: 'slack' as ChannelType,

    /**
     * Connect to Slack using Socket Mode.
     * @param config - Channel config with token, appToken, and optional allowFrom.
     */
    async connect(config: ChannelConfig): Promise<void> {
      if (!config.token) {
        throw new Error('Slack adapter requires a bot token in config.token');
      }
      const appToken = config['appToken'] as string | undefined;
      if (!appToken) {
        throw new Error(
          'Slack adapter requires an app-level token in config.appToken for Socket Mode',
        );
      }

      allowFromList = config.allowFrom ?? [];

      try {
        if (clientFactory) {
          client = clientFactory({ token: config.token, appToken });
        } else {
          const { createBoltClient } = await import('./slack-bolt.js');
          client = await createBoltClient({ token: config.token, appToken });
        }

        client.onMessage(async (event: SlackMessageEvent) => {
          if (!isUserAllowed(event.user)) {
            log.debug({ userId: event.user }, 'Message from non-allowed user; dropping');
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
            log.error({ userId: event.user, error }, 'Message handler threw an error');
          }
        });

        await client.start();
        connected = true;
        log.info('Slack adapter connected via Socket Mode');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        client = undefined;
        connected = false;
        throw new Error(`Failed to connect Slack adapter: ${errorMessage}`);
      }
    },

    /**
     * Register the message handler callback.
     * @param handler - Async function to invoke for each incoming message.
     */
    onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
      messageHandler = handler;
      log.debug('Message handler registered');
    },

    /**
     * Send a text message to a Slack channel.
     * @param channelId - The Slack channel ID to send to.
     * @param text      - The message text.
     * @param options   - Optional send configuration.
     */
    async send(channelId: string, text: string, options?: SendOptions): Promise<void> {
      if (!client) {
        log.warn('Cannot send: client is not connected');
        return;
      }

      const chunks = splitMessage(text);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        try {
          await throttle();
          const postOptions: SlackPostMessageOptions = {
            channel: channelId,
            text: chunks[chunkIndex],
          };
          if (options?.replyToMessageId) {
            postOptions.thread_ts = options.replyToMessageId;
          }
          if (
            chunkIndex === chunks.length - 1 &&
            options?.buttons && options.buttons.length > 0
          ) {
            postOptions.blocks = buildButtonBlocks(options.buttons);
          }
          await client.postMessage(postOptions);
        } catch (error: unknown) {
          log.error({ channelId, chunkIndex, error }, 'Failed to send message chunk');
        }
      }
    },

    /** Disconnect from Slack and clean up. */
    async disconnect(): Promise<void> {
      if (client) {
        try {
          await client.stop();
        } catch (error: unknown) {
          log.error({ error }, 'Error stopping Slack client');
        }
        client = undefined;
      }
      messageHandler = undefined;
      connected = false;
      log.info('Slack adapter disconnected');
    },

    /** Check whether the adapter is currently connected. */
    isConnected(): boolean {
      return connected;
    },
  };

  return adapter;
}
