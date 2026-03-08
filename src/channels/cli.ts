/**
 * CLI channel adapter.
 * Provides a direct terminal chat experience via stdin/stdout.
 * Useful for quick interactions without the web panel.
 * See HLD Section 10 for channel adapter architecture.
 */

import { createInterface, type Interface } from 'node:readline';
import { nanoid } from 'nanoid';
import { channelLogger } from '../utils/logger.js';
import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelMessage,
  ChannelType,
  SendOptions,
} from '../types/index.js';

/**
 * Create a CLI channel adapter that reads from stdin and writes to stdout.
 *
 * @returns A ChannelAdapter for terminal-based chat.
 */
export function createCliAdapter(): ChannelAdapter {
  const log = channelLogger.child({ adapter: 'cli' });

  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  let rl: Interface | undefined;

  const adapter: ChannelAdapter = {
    name: 'CLI',
    type: 'cli' as ChannelType,

    /**
     * Connect the CLI adapter by setting up a readline interface on stdin.
     *
     * @param _config - Channel configuration (not used for CLI).
     */
    async connect(_config: ChannelConfig): Promise<void> {
      connected = true;

      rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'you> ',
      });

      rl.on('line', (line: string) => {
        const text = line.trim();
        if (text.length === 0) {
          rl?.prompt();
          return;
        }

        const channelMessage: ChannelMessage = {
          id: nanoid(),
          channelType: 'cli',
          channelId: 'terminal',
          userId: 'local-user',
          text,
          attachments: [],
          timestamp: new Date(),
          raw: { text },
        };

        if (!messageHandler) {
          log.warn('No message handler registered; dropping message');
          rl?.prompt();
          return;
        }

        messageHandler(channelMessage).catch((error: unknown) => {
          const errorMsg = error instanceof Error ? error.message : String(error);
          log.error({ error: errorMsg }, 'Message handler threw an error');
        });
      });

      rl.on('close', () => {
        connected = false;
        log.info('CLI adapter readline closed');
      });

      log.info('CLI adapter connected');
      rl.prompt();
    },

    /**
     * Register the message handler callback.
     * Called by the orchestrator to receive inbound channel messages.
     *
     * @param handler - The function to call when a message arrives.
     */
    onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
      messageHandler = handler;
      log.debug('Message handler registered');
    },

    /**
     * Send a response to the terminal via stdout.
     *
     * @param _channelId - Ignored for CLI (always outputs to stdout).
     * @param text - The message text to display.
     * @param _options - Optional send configuration (not used for CLI).
     */
    async send(
      _channelId: string,
      text: string,
      _options?: SendOptions,
    ): Promise<void> {
      process.stdout.write(`\nassistant> ${text}\n\n`);
      rl?.prompt();
    },

    /** Disconnect the adapter and close the readline interface. */
    async disconnect(): Promise<void> {
      if (rl) {
        rl.close();
        rl = undefined;
      }
      messageHandler = undefined;
      connected = false;
      log.info('CLI adapter disconnected');
    },

    /** Check whether the adapter is currently connected. */
    isConnected(): boolean {
      return connected;
    },
  };

  return adapter;
}
