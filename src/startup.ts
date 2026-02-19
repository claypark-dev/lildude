/**
 * Startup helpers — channel initialization, agent loop wiring, and banner.
 * Extracted from the main entry point to keep files under 300 lines.
 * See HLD Section 5 for startup flow.
 */

import type { Config } from './config/schema.js';
import type { ChannelManager } from './channels/index.js';
import {
  createWebChatAdapter,
  createDiscordAdapter,
  createTelegramAdapter,
} from './channels/index.js';
import type { AgentLoop } from './orchestrator/agent-loop.js';
import type { ChannelMessage, LLMProvider } from './types/index.js';
import type { ProviderManager } from './providers/index.js';
import { createModuleLogger } from './utils/logger.js';

/** The version string, kept in sync with package.json. */
const VERSION = '0.1.0';

const log = createModuleLogger('startup');

/** ASCII art banner printed on startup. */
const BANNER = `
  _ _ _   _     _         _
 | (_) | | |   | |       | |
 | |_| | | | __| |_   _  | | ___
 | | | | | |/ _\` | | | |/ _\` |/ _ \\
 | | | | | | (_| | |_| | (_| |  __/
 |_|_|_| |_|\\__,_|\\__,_|\\__,_|\\___|
                              v${VERSION}
`;

/**
 * Initialize and connect enabled channel adapters.
 *
 * @param channelManager - The channel manager to register adapters with.
 * @param config - The application configuration.
 */
export async function initializeChannels(
  channelManager: ChannelManager,
  config: Config,
): Promise<void> {
  // WebChat is always enabled by default
  if (config.channels.webchat.enabled) {
    const webChatAdapter = createWebChatAdapter();
    await webChatAdapter.connect({ enabled: true });
    channelManager.registerAdapter(webChatAdapter);
    log.info('WebChat adapter enabled');
  }

  // Discord (only if enabled and token provided)
  if (config.channels.discord.enabled && config.channels.discord.token) {
    try {
      const discordAdapter = createDiscordAdapter();
      await discordAdapter.connect({
        enabled: true,
        token: config.channels.discord.token,
        allowFrom: config.channels.discord.allowFrom,
      });
      channelManager.registerAdapter(discordAdapter);
      log.info('Discord adapter enabled');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to connect Discord adapter');
    }
  }

  // Telegram (only if enabled and token provided)
  if (config.channels.telegram.enabled && config.channels.telegram.token) {
    try {
      const telegramAdapter = createTelegramAdapter();
      await telegramAdapter.connect({
        enabled: true,
        token: config.channels.telegram.token,
        allowFrom: config.channels.telegram.allowFrom,
      });
      channelManager.registerAdapter(telegramAdapter);
      log.info('Telegram adapter enabled');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to connect Telegram adapter');
    }
  }
}

/**
 * Wire all connected channel adapters to route messages through the agent loop.
 *
 * @param channelManager - The channel manager with registered adapters.
 * @param agentLoop - The agent loop to process messages.
 */
export function wireChannelsToAgentLoop(
  channelManager: ChannelManager,
  agentLoop: AgentLoop,
): void {
  const connectedAdapters = channelManager.getConnectedAdapters();

  for (const adapter of connectedAdapters) {
    adapter.onMessage(async (msg: ChannelMessage) => {
      try {
        const result = await agentLoop.processMessage(
          msg.channelId,
          msg.text,
          msg.channelType,
        );
        await adapter.send(msg.channelId, result.responseText);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(
          { channelType: msg.channelType, channelId: msg.channelId, error: errorMessage },
          'Failed to process message through agent loop',
        );
        try {
          await adapter.send(
            msg.channelId,
            'Sorry, something went wrong processing your message. Please try again.',
          );
        } catch (sendError: unknown) {
          const sendErrorMessage = sendError instanceof Error ? sendError.message : String(sendError);
          log.error({ error: sendErrorMessage }, 'Failed to send error response');
        }
      }
    });
  }

  log.info(
    { connectedCount: connectedAdapters.length },
    'Channel adapters wired to agent loop',
  );
}

/**
 * Resolve the primary LLM provider from injected or configured providers.
 *
 * @param injected - An optionally injected provider (for tests).
 * @param manager - The provider manager with configured providers.
 * @param enabledNames - List of enabled provider names.
 * @returns The resolved LLMProvider.
 */
export function resolvePrimaryProvider(
  injected: LLMProvider | undefined,
  manager: ProviderManager,
  enabledNames: string[],
): LLMProvider {
  if (injected) {
    return injected;
  }

  if (enabledNames.length === 0) {
    log.warn('No providers enabled — the agent loop will not be able to process messages');
    return createNoOpProvider();
  }

  const firstEnabled = manager.getProvider(enabledNames[0]);
  if (!firstEnabled) {
    throw new Error(`Provider "${enabledNames[0]}" reported as enabled but not found`);
  }
  return firstEnabled;
}

/**
 * Create a no-op provider that throws when called.
 * Used as a placeholder when no providers are configured.
 *
 * @returns An LLMProvider that always throws.
 */
function createNoOpProvider(): LLMProvider {
  return {
    name: 'none',
    async chat() {
      throw new Error('No LLM provider configured. Run `lil-dude onboard` to set up a provider.');
    },
    async *chatStream() {
      throw new Error('No LLM provider configured. Run `lil-dude onboard` to set up a provider.');
    },
    countTokens() {
      return 0;
    },
  };
}

/**
 * Log the startup banner with ASCII art and connection URLs.
 *
 * @param config - The application configuration for reading port/host.
 */
export function logStartupBanner(config: Config): void {
  console.log(BANNER);
  console.log(`  Web Panel:  http://${config.gateway.host}:${config.gateway.httpPort}`);
  console.log(`  WebSocket:  ws://${config.gateway.host}:${config.gateway.wsPort}/ws`);
  console.log('');
  log.info('Lil Dude is ready');
}
