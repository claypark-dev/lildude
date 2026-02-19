/**
 * Mock channel adapter for use in unit tests.
 * Implements the ChannelAdapter interface with spying capabilities.
 */

import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelMessage,
  ChannelType,
  SendOptions,
} from '../../src/types/index.js';

/** Record of a message sent through the mock adapter. */
export interface SentMessage {
  channelId: string;
  text: string;
  options?: SendOptions;
}

/** Mock adapter with test helpers for inspecting behavior. */
export interface MockChannelAdapter extends ChannelAdapter {
  /** All messages sent through `send()`, captured for assertion. */
  sentMessages: SentMessage[];
  /**
   * Simulate an inbound message by triggering the registered handler.
   *
   * @param msg - The ChannelMessage to deliver to the handler.
   */
  simulateMessage(msg: ChannelMessage): Promise<void>;
}

/**
 * Create a MockChannelAdapter for testing.
 *
 * @param type - The ChannelType to emulate (defaults to 'webchat').
 * @param name - A human-readable name (defaults to 'MockChannel').
 * @returns A fully-functional mock adapter with spy capabilities.
 */
export function createMockChannelAdapter(
  type: ChannelType = 'webchat',
  name: string = 'MockChannel',
): MockChannelAdapter {
  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  const sentMessages: SentMessage[] = [];

  return {
    name,
    type,
    sentMessages,

    async connect(_config: ChannelConfig): Promise<void> {
      connected = true;
    },

    onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
      messageHandler = handler;
    },

    async send(
      channelId: string,
      text: string,
      options?: SendOptions,
    ): Promise<void> {
      sentMessages.push({ channelId, text, options });
    },

    async disconnect(): Promise<void> {
      connected = false;
    },

    isConnected(): boolean {
      return connected;
    },

    async simulateMessage(msg: ChannelMessage): Promise<void> {
      if (!messageHandler) {
        throw new Error('No message handler registered on mock adapter');
      }
      await messageHandler(msg);
    },
  };
}
