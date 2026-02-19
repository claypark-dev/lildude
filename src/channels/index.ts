/**
 * Channel manager — registry for channel adapters.
 * Provides a central place to register, retrieve, and disconnect adapters.
 * See HLD Section 10.
 */

import { channelLogger } from '../utils/logger.js';
import type { ChannelAdapter, ChannelType } from '../types/index.js';

/** Manages the lifecycle of channel adapters. */
export interface ChannelManager {
  /** Register a channel adapter. Replaces any existing adapter of the same type. */
  registerAdapter(adapter: ChannelAdapter): void;
  /** Retrieve a registered adapter by its channel type. */
  getAdapter(type: ChannelType): ChannelAdapter | undefined;
  /** Return all adapters that are currently connected. */
  getConnectedAdapters(): ChannelAdapter[];
  /** Disconnect every registered adapter. */
  disconnectAll(): Promise<void>;
}

/**
 * Create a new ChannelManager instance.
 *
 * @returns A ChannelManager for registering and querying channel adapters.
 */
export function createChannelManager(): ChannelManager {
  const log = channelLogger.child({ component: 'channel-manager' });
  const adapters = new Map<ChannelType, ChannelAdapter>();

  return {
    registerAdapter(adapter: ChannelAdapter): void {
      adapters.set(adapter.type, adapter);
      log.info({ type: adapter.type, name: adapter.name }, 'Adapter registered');
    },

    getAdapter(type: ChannelType): ChannelAdapter | undefined {
      return adapters.get(type);
    },

    getConnectedAdapters(): ChannelAdapter[] {
      return [...adapters.values()].filter((adapter) => adapter.isConnected());
    },

    async disconnectAll(): Promise<void> {
      const disconnectPromises = [...adapters.values()].map(async (adapter) => {
        try {
          await adapter.disconnect();
          log.info({ type: adapter.type }, 'Adapter disconnected');
        } catch (error: unknown) {
          log.error({ type: adapter.type, error }, 'Failed to disconnect adapter');
        }
      });

      await Promise.all(disconnectPromises);
    },
  };
}

export { createWebChatAdapter } from './webchat.js';
export type { WebChatAdapter } from './webchat.js';
export { createTelegramAdapter } from './telegram.js';
export { createDiscordAdapter } from './discord.js';
export type { DiscordAdapter } from './discord.js';
