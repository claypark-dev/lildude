/**
 * Telegram channel adapter.
 * Bridges Telegraf bot to the ChannelAdapter interface.
 * Handles message normalization, allowFrom filtering, rate limiting,
 * message splitting, and inline keyboard support.
 * See HLD Section 10 for channel adapter architecture.
 */

import { Telegraf } from 'telegraf';
import type { Context, NarrowedContext } from 'telegraf';
import type { Update, Message } from 'telegraf/types';
import { nanoid } from 'nanoid';
import { channelLogger } from '../utils/logger.js';
import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelMessage,
  ChannelType,
  SendOptions,
} from '../types/index.js';

/** Telegram message character limit. */
const TELEGRAM_MSG_LIMIT = 4096;

/** Minimum delay between sends to avoid Telegram rate limits (ms). */
const RATE_LIMIT_DELAY_MS = 50;

/** Type for the Telegraf text message context. */
type TextMessageContext = NarrowedContext<
  Context<Update>,
  Update.MessageUpdate<Message.TextMessage>
>;

/**
 * Escape special characters for Telegram MarkdownV2 format.
 *
 * @param text - The raw text to escape.
 * @returns The escaped text safe for MarkdownV2.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Split a message into chunks that fit within Telegram's character limit.
 * Splits on newlines when possible; otherwise splits at the hard limit.
 *
 * @param text  - The full message text to split.
 * @param limit - Maximum characters per chunk (defaults to 4096).
 * @returns An array of text chunks, each within the limit.
 */
export function splitMessage(text: string, limit: number = TELEGRAM_MSG_LIMIT): string[] {
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

    // Try to split at a newline within the limit
    const sliceCandidate = remaining.slice(0, limit);
    const lastNewline = sliceCandidate.lastIndexOf('\n');
    const splitAt = lastNewline > 0 ? lastNewline + 1 : limit;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

/**
 * Build a Telegram inline keyboard from SendOptions buttons.
 *
 * @param buttons - Array of button definitions with label and callback id.
 * @returns An InlineKeyboardMarkup object for the Telegram API.
 */
function buildInlineKeyboard(
  buttons: Array<{ label: string; id: string }>,
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: [
      buttons.map((btn) => ({
        text: btn.label,
        callback_data: btn.id,
      })),
    ],
  };
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

/**
 * Create a Telegram channel adapter.
 *
 * @returns A fully-wired Telegram ChannelAdapter.
 */
export function createTelegramAdapter(): ChannelAdapter {
  const log = channelLogger.child({ adapter: 'telegram' });

  let bot: Telegraf | undefined;
  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  let allowFromList: string[] = [];
  let lastSendTimestamp = 0;

  /**
   * Determine whether a user ID is permitted by the allowFrom filter.
   *
   * @param userId - The Telegram user ID as a string.
   * @returns True if the user is allowed (or if allowFrom is empty).
   */
  function isUserAllowed(userId: string): boolean {
    if (allowFromList.length === 0) {
      return true;
    }
    return allowFromList.includes(userId);
  }

  /**
   * Normalize a Telegraf text message context into a ChannelMessage.
   *
   * @param ctx - The Telegraf context for a text message update.
   * @returns A normalized ChannelMessage.
   */
  function normalizeMessage(ctx: TextMessageContext): ChannelMessage {
    const message = ctx.message;
    return {
      id: nanoid(),
      channelType: 'telegram',
      channelId: String(message.chat.id),
      userId: String(message.from.id),
      text: message.text,
      attachments: [],
      replyToMessageId: message.reply_to_message
        ? String(message.reply_to_message.message_id)
        : undefined,
      timestamp: new Date(message.date * 1000),
      raw: ctx.update,
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
    name: 'Telegram',
    type: 'telegram' as ChannelType,

    /**
     * Connect to Telegram by creating a Telegraf bot and launching polling.
     *
     * @param config - Channel configuration with token and optional allowFrom.
     */
    async connect(config: ChannelConfig): Promise<void> {
      if (!config.token) {
        throw new Error('Telegram adapter requires a bot token in config.token');
      }

      allowFromList = config.allowFrom ?? [];

      bot = new Telegraf(config.token);

      bot.on('text', async (ctx: TextMessageContext) => {
        const userId = String(ctx.message.from.id);

        if (!isUserAllowed(userId)) {
          log.debug({ userId }, 'Message from non-allowed user; dropping');
          return;
        }

        const channelMessage = normalizeMessage(ctx);

        if (!messageHandler) {
          log.warn('No message handler registered; dropping message');
          return;
        }

        try {
          await messageHandler(channelMessage);
        } catch (error: unknown) {
          log.error({ userId, error }, 'Message handler threw an error');
        }
      });

      bot.catch((error: unknown) => {
        log.error({ error }, 'Telegraf error');
      });

      await bot.launch();
      connected = true;
      log.info('Telegram adapter connected');
    },

    /**
     * Register the message handler callback.
     * Called by the orchestrator to receive inbound channel messages.
     *
     * @param handler - Async function to invoke for each incoming message.
     */
    onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
      messageHandler = handler;
      log.debug('Message handler registered');
    },

    /**
     * Send a text message to a Telegram chat.
     * Handles MarkdownV2 parsing, inline keyboards for buttons,
     * reply threading, message splitting, and rate limiting.
     *
     * @param channelId - The Telegram chat ID to send to.
     * @param text      - The message text.
     * @param options   - Optional send configuration.
     */
    async send(
      channelId: string,
      text: string,
      options?: SendOptions,
    ): Promise<void> {
      if (!bot) {
        log.warn('Cannot send: bot is not connected');
        return;
      }

      const chunks = splitMessage(text);

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        try {
          await throttle();

          const extra: Record<string, unknown> = {};

          if (options?.parseMode === 'markdown') {
            extra.parse_mode = 'MarkdownV2';
          } else if (options?.parseMode === 'html') {
            extra.parse_mode = 'HTML';
          }

          if (options?.silent) {
            extra.disable_notification = true;
          }

          // Only apply reply_parameters to the first chunk
          if (chunkIndex === 0 && options?.replyToMessageId) {
            extra.reply_parameters = {
              message_id: Number(options.replyToMessageId),
            };
          }

          // Only apply buttons to the last chunk
          if (chunkIndex === chunks.length - 1 && options?.buttons && options.buttons.length > 0) {
            extra.reply_markup = buildInlineKeyboard(options.buttons);
          }

          await bot.telegram.sendMessage(channelId, chunks[chunkIndex], extra);
        } catch (error: unknown) {
          log.error(
            { channelId, chunkIndex, error },
            'Failed to send message chunk',
          );
        }
      }
    },

    /**
     * Disconnect the bot and clean up.
     */
    async disconnect(): Promise<void> {
      if (bot) {
        bot.stop('Adapter disconnect');
        bot = undefined;
      }
      messageHandler = undefined;
      connected = false;
      log.info('Telegram adapter disconnected');
    },

    /**
     * Check whether the adapter is currently connected.
     *
     * @returns True if the bot is running.
     */
    isConnected(): boolean {
      return connected;
    },
  };

  return adapter;
}
