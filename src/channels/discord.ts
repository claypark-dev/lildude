/**
 * Discord channel adapter.
 * Bridges Discord bot events to the ChannelAdapter interface via discord.js.
 * The adapter normalizes Discord messages into ChannelMessage format and
 * sends responses back through the Discord API.
 * See HLD Section 10 for channel adapter architecture.
 */

import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type TextChannel,
  type DMChannel,
  type Message as DiscordMessage,
} from 'discord.js';
import { nanoid } from 'nanoid';
import { channelLogger } from '../utils/logger.js';
import type {
  Attachment,
  ChannelAdapter,
  ChannelConfig,
  ChannelMessage,
  ChannelType,
  SendOptions,
} from '../types/index.js';

/** Maximum characters Discord allows in a single message. */
const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/** Map a Discord attachment content type prefix to our Attachment type. */
function resolveAttachmentType(
  contentType: string | null,
): Attachment['type'] {
  if (!contentType) return 'file';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  return 'file';
}

/**
 * Split a long message into chunks that each fit within Discord's
 * 2000-character limit. Splits on newlines when possible, otherwise
 * falls back to hard-splitting at the boundary.
 *
 * @param text - The message text to split.
 * @returns An array of message chunks, each at most 2000 characters.
 */
function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split on a newline within the limit
    const slice = remaining.slice(0, DISCORD_MAX_MESSAGE_LENGTH);
    const lastNewline = slice.lastIndexOf('\n');

    let splitIndex: number;
    if (lastNewline > 0) {
      splitIndex = lastNewline;
    } else {
      // No newline found — try splitting on a space
      const lastSpace = slice.lastIndexOf(' ');
      splitIndex =
        lastSpace > 0 ? lastSpace : DISCORD_MAX_MESSAGE_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n/, '');
  }

  return chunks;
}

/**
 * Normalize a discord.js Message attachment into our Attachment interface.
 *
 * @param discordAttachment - The discord.js attachment object.
 * @returns A normalized Attachment.
 */
function normalizeAttachment(
  discordAttachment: DiscordMessage['attachments'] extends Map<
    string,
    infer V
  >
    ? V
    : never,
): Attachment {
  return {
    type: resolveAttachmentType(discordAttachment.contentType),
    url: discordAttachment.url,
    mimeType: discordAttachment.contentType ?? 'application/octet-stream',
    filename: discordAttachment.name,
    size: discordAttachment.size,
  };
}

/**
 * Build Discord ActionRowBuilder with buttons for approval queue integration.
 *
 * @param buttons - Array of button definitions with label and id.
 * @returns An ActionRowBuilder ready to attach to a message.
 */
function buildButtonRow(
  buttons: Array<{ label: string; id: string }>,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const button of buttons) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(button.id)
        .setLabel(button.label)
        .setStyle(ButtonStyle.Primary),
    );
  }
  return row;
}

/** Extended ChannelAdapter for Discord with injectable client (for testing). */
export interface DiscordAdapter extends ChannelAdapter {
  /** Allows injecting a mock discord.js Client (used in tests). */
  _injectClient(client: Client): void;
}

/**
 * Create a Discord channel adapter.
 *
 * @returns A fully-wired Discord ChannelAdapter.
 */
export function createDiscordAdapter(): DiscordAdapter {
  const log = channelLogger.child({ adapter: 'discord' });

  let client: Client | undefined;
  let messageHandler:
    | ((msg: ChannelMessage) => Promise<void>)
    | undefined;
  let allowedUserIds: Set<string> | undefined;

  /**
   * Normalize a discord.js Message into our ChannelMessage format.
   */
  function normalizeMessage(discordMsg: DiscordMessage): ChannelMessage {
    const attachments: Attachment[] = [];
    for (const [, attachment] of discordMsg.attachments) {
      attachments.push(normalizeAttachment(attachment));
    }

    const channelId = discordMsg.channel.isDMBased()
      ? discordMsg.author.id
      : discordMsg.channelId;

    return {
      id: nanoid(),
      channelType: 'discord' as ChannelType,
      channelId,
      userId: discordMsg.author.id,
      text: discordMsg.content,
      attachments,
      replyToMessageId: discordMsg.reference?.messageId ?? undefined,
      timestamp: discordMsg.createdAt,
      raw: discordMsg,
    };
  }

  const adapter: DiscordAdapter = {
    name: 'Discord',
    type: 'discord' as ChannelType,

    /**
     * Connect to Discord using the provided bot token.
     * Creates a discord.js Client, registers event listeners, and logs in.
     *
     * @param config - Channel config containing the bot token and allowFrom list.
     * @throws If the token is missing or login fails.
     */
    async connect(config: ChannelConfig): Promise<void> {
      if (!config.token) {
        throw new Error(
          'Discord bot token is required. Set it in your channel config under "token". ' +
            'You can create a bot token at https://discord.com/developers/applications',
        );
      }

      // Set up allowFrom filtering
      if (config.allowFrom && config.allowFrom.length > 0) {
        allowedUserIds = new Set(config.allowFrom);
        log.info(
          { allowedCount: config.allowFrom.length },
          'User filtering enabled',
        );
      } else {
        allowedUserIds = undefined;
        log.info('No user filtering — accepting messages from all users');
      }

      // Only create a new client if one hasn't been injected (for testing)
      if (!client) {
        client = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
          ],
        });
      }

      // Register messageCreate listener
      client.on('messageCreate', (discordMsg: DiscordMessage) => {
        // Ignore messages from bots (including self)
        if (discordMsg.author.bot) {
          return;
        }

        // Filter by allowFrom if configured
        if (allowedUserIds && !allowedUserIds.has(discordMsg.author.id)) {
          log.debug(
            { userId: discordMsg.author.id },
            'Message from non-allowed user ignored',
          );
          return;
        }

        if (!messageHandler) {
          log.warn('No message handler registered; dropping message');
          return;
        }

        const normalizedMsg = normalizeMessage(discordMsg);

        messageHandler(normalizedMsg).catch((error: unknown) => {
          log.error(
            { userId: discordMsg.author.id, error },
            'Message handler threw an error',
          );
        });
      });

      client.on('error', (error: Error) => {
        log.error({ error }, 'Discord client error');
      });

      try {
        await client.login(config.token);
        log.info('Discord adapter connected');
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        client = undefined;
        throw new Error(
          `Failed to connect to Discord: ${errorMessage}. ` +
            'Please verify your bot token is correct and the bot has been added to your server. ' +
            'Generate a new token at https://discord.com/developers/applications',
        );
      }
    },

    /**
     * Register the message handler callback.
     * Called by the orchestrator to receive inbound channel messages.
     *
     * @param handler - Async function to handle normalized inbound messages.
     */
    onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
      messageHandler = handler;
      log.debug('Message handler registered');
    },

    /**
     * Send a message to a Discord channel.
     * Handles message splitting for content exceeding 2000 characters,
     * markdown formatting, and button components for approval flows.
     *
     * @param channelId - The Discord channel or DM user ID to send to.
     * @param text - The message text to send.
     * @param options - Optional send configuration (buttons, reply, parse mode).
     */
    async send(
      channelId: string,
      text: string,
      options?: SendOptions,
    ): Promise<void> {
      if (!client) {
        log.warn('Cannot send: client not connected');
        return;
      }

      try {
        const channel = await client.channels.fetch(channelId);

        if (!channel) {
          log.warn({ channelId }, 'Channel not found');
          return;
        }

        if (!('send' in channel)) {
          log.warn({ channelId }, 'Channel does not support sending messages');
          return;
        }

        const sendableChannel = channel as TextChannel | DMChannel;
        const chunks = splitMessage(text);

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const isLastChunk = chunkIndex === chunks.length - 1;
          const messagePayload: Record<string, unknown> = {
            content: chunks[chunkIndex],
          };

          // Only attach reply reference and buttons to the first chunk
          if (chunkIndex === 0 && options?.replyToMessageId) {
            messagePayload.reply = {
              messageReference: options.replyToMessageId,
            };
          }

          // Attach buttons only to the last chunk
          if (isLastChunk && options?.buttons && options.buttons.length > 0) {
            messagePayload.components = [buildButtonRow(options.buttons)];
          }

          await sendableChannel.send(messagePayload);
        }

        log.debug(
          { channelId, chunkCount: chunks.length },
          'Message sent',
        );
      } catch (error: unknown) {
        log.error({ channelId, error }, 'Failed to send message');
      }
    },

    /**
     * Disconnect from Discord and clean up resources.
     */
    async disconnect(): Promise<void> {
      if (client) {
        client.destroy();
        client = undefined;
      }
      messageHandler = undefined;
      allowedUserIds = undefined;
      log.info('Discord adapter disconnected');
    },

    /**
     * Check whether the Discord client is currently connected and ready.
     *
     * @returns true if the client is logged in and ready.
     */
    isConnected(): boolean {
      return client?.isReady() ?? false;
    },

    /**
     * Inject a mock client for testing purposes.
     * Must be called before connect() to take effect.
     *
     * @param mockClient - A discord.js Client (or mock) to use.
     */
    _injectClient(mockClient: Client): void {
      client = mockClient;
    },
  };

  return adapter;
}
