/**
 * Lil Dude — Main entry point.
 * Wires all modules together: config, database, hardware, security,
 * cost engine, providers, channels, agent loop, and gateway.
 * Registers shutdown handlers for graceful termination.
 * See HLD Section 5 for startup flow.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, homeDir } from './config/loader.js';
import type { Config } from './config/schema.js';
import { createDatabase, type DatabaseManager } from './persistence/db.js';
import { detectHardware } from './utils/hardware.js';
import { createShutdownHandler, type ShutdownHandler } from './utils/shutdown.js';
import { createModuleLogger } from './utils/logger.js';
import { createProviderManager, type ProviderManager } from './providers/index.js';
import { createChannelManager, type ChannelManager } from './channels/index.js';
import { createAgentLoop, type AgentLoop } from './orchestrator/agent-loop.js';
import { createGatewayServer, type GatewayServer } from './gateway/index.js';
import type { LLMProvider, WSMessage } from './types/index.js';
import type { SecurityLevel } from './security/permissions.js';
import type { WebChatAdapter } from './channels/webchat.js';
import {
  initializeChannels,
  wireChannelsToAgentLoop,
  resolvePrimaryProvider,
  logStartupBanner,
} from './startup.js';
import {
  runStartupResume,
  updateLastActiveTimestamp,
} from './orchestrator/startup.js';
import {
  isOllamaManagedByUs,
  stopOllamaProcess,
} from './providers/ollama-lifecycle.js';
import { ConfigSchema } from './config/schema.js';

export const VERSION = '0.1.0';

const log = createModuleLogger('main');

/** Dependencies exposed by the startup for testing and shutdown. */
export interface AppContext {
  config: Config;
  dbManager: DatabaseManager;
  providerManager: ProviderManager;
  channelManager: ChannelManager;
  agentLoop: AgentLoop;
  gateway: GatewayServer;
  shutdownHandler: ShutdownHandler;
}

/** Options for starting the app, allowing dependency injection for tests. */
export interface StartOptions {
  /** Override config instead of loading from disk. */
  config?: Config;
  /** Override the database path (e.g. ':memory:' for tests). */
  dbPath?: string;
  /** Override the migrations directory. */
  migrationsDir?: string;
  /** Inject a provider instead of using the config to create one. */
  provider?: LLMProvider;
  /** Skip hardware detection (useful in tests). */
  skipHardwareDetection?: boolean;
  /** Skip starting the gateway listener (useful in tests). */
  skipGatewayListen?: boolean;
  /** Skip registering process signal handlers (useful in tests). */
  skipSignalHandlers?: boolean;
}

/**
 * Check whether onboarding has been completed (config file exists).
 *
 * @returns True if config.json exists in the Lil Dude home directory.
 */
export function isOnboarded(): boolean {
  const configPath = join(homeDir(), 'config.json');
  return existsSync(configPath);
}

/** Minimal context returned from onboarding mode (no providers, channels, or agent loop). */
export interface OnboardingContext {
  gateway: GatewayServer;
  dbManager: DatabaseManager;
  shutdownHandler: ShutdownHandler;
}

/**
 * Start the app in onboarding mode (no config.json yet).
 * Boots a minimal gateway + web panel so the user can complete setup via browser.
 * No providers, channels, or agent loop are initialized.
 *
 * @returns An OnboardingContext with gateway, database, and shutdown handler.
 */
export async function startOnboardingMode(): Promise<OnboardingContext> {
  log.info('Starting in onboarding mode — no configuration found');

  // Use Zod defaults for a minimal config (all providers/channels disabled)
  const config = ConfigSchema.parse({});

  // Initialize database
  const dbPath = join(homeDir(), 'lil-dude.db');
  const dbManager = createDatabase(dbPath);
  dbManager.runMigrations();
  log.info({ dbPath }, 'Database initialized for onboarding');

  // Create gateway with default config (serves web panel + onboarding API)
  const gateway = createGatewayServer(dbManager, config);
  await gateway.start(config.gateway.httpPort, config.gateway.host);
  log.info(
    { port: config.gateway.httpPort, host: config.gateway.host },
    'Onboarding gateway started',
  );

  // Register shutdown handlers
  const shutdownHandler = createShutdownHandler();
  shutdownHandler.register('gateway', async () => {
    await gateway.stop();
  });
  shutdownHandler.register('database', () => {
    dbManager.close();
  });

  console.log('');
  console.log('  Lil Dude — Onboarding Mode');
  console.log(`  Open http://${config.gateway.host}:${config.gateway.httpPort} to set up your assistant.`);
  console.log('');

  return { gateway, dbManager, shutdownHandler };
}

/**
 * Start the Lil Dude application.
 * Loads config, initializes all subsystems, wires channels to the agent loop,
 * and starts the gateway server.
 *
 * @param options - Optional overrides for testing and flexibility.
 * @returns The full AppContext with references to all subsystems.
 */
export async function startApp(options: StartOptions = {}): Promise<AppContext> {
  // Step 1: Load config
  const config = options.config ?? await loadConfig();
  log.info('Configuration loaded');

  // Step 2: Initialize database and run migrations
  const dbPath = options.dbPath ?? join(homeDir(), 'lil-dude.db');
  const dbManager = createDatabase(dbPath, options.migrationsDir);
  dbManager.runMigrations();
  log.info({ dbPath }, 'Database initialized and migrations applied');

  // Step 3: Detect hardware
  if (!options.skipHardwareDetection) {
    const hardware = detectHardware();
    log.info(
      {
        os: hardware.os,
        arch: hardware.arch,
        ramGb: hardware.ramGb,
        cpuCores: hardware.cpuCores,
        hasGpu: hardware.hasGpu,
        features: hardware.features,
      },
      'Hardware profile detected',
    );
  }

  // Step 4: Resolve security level
  const securityLevel = config.security.level as SecurityLevel;
  log.info({ securityLevel }, 'Security module initialized');

  // Step 5: Cost engine is stateless — budget config is passed to agent loop
  log.info(
    {
      monthlyLimitUsd: config.budget.monthlyLimitUsd,
      perTaskDefaultLimitUsd: config.budget.perTaskDefaultLimitUsd,
    },
    'Cost engine configured',
  );

  // Step 6: Initialize providers
  const providerManager = createProviderManager(config);
  const configuredProviders = providerManager.getEnabledProviders();

  // Resolve the primary provider for the agent loop
  const primaryProvider = resolvePrimaryProvider(
    options.provider,
    providerManager,
    configuredProviders,
  );

  // When an external provider is injected and no providers are configured,
  // include the injected provider's name so the router can find it.
  const enabledProviders = configuredProviders.length > 0
    ? configuredProviders
    : [primaryProvider.name];
  log.info({ enabledProviders }, 'Providers initialized');

  // Step 7: Initialize channel adapters
  const channelManager = createChannelManager();
  await initializeChannels(channelManager, config);

  // Step 8: Create the agent loop
  const agentLoop = createAgentLoop(
    {
      db: dbManager.db,
      provider: primaryProvider,
      securityLevel,
      userName: config.user.name,
      monthlyBudgetUsd: config.budget.monthlyLimitUsd,
    },
    {
      taskBudgetUsd: config.budget.perTaskDefaultLimitUsd,
      enabledProviders,
    },
  );
  log.info('Agent loop created');

  // Step 9: Wire channel messages to the agent loop
  wireChannelsToAgentLoop(channelManager, agentLoop);

  // Step 9.5: Run startup resume check
  const resumeResult = await runStartupResume(dbManager.db);
  log.info(
    {
      hasPendingWork: resumeResult.hasPendingWork,
      pendingTasks: resumeResult.pendingTasks.length,
      missedCronJobs: resumeResult.missedCronJobs.length,
      offlineDurationMs: resumeResult.offlineDurationMs,
    },
    'Startup resume check completed',
  );

  if (resumeResult.hasPendingWork) {
    const connectedAdapters = channelManager.getConnectedAdapters();
    if (connectedAdapters.length > 0) {
      const firstAdapter = connectedAdapters[0];
      try {
        await firstAdapter.send('system', resumeResult.message);
        log.info({ channel: firstAdapter.type }, 'Resume message sent to channel');
      } catch (sendError: unknown) {
        const sendMsg = sendError instanceof Error ? sendError.message : String(sendError);
        log.warn({ error: sendMsg }, 'Could not send resume message to channel — logged instead');
        log.info({ resumeMessage: resumeResult.message }, 'Startup resume message');
      }
    } else {
      log.info({ resumeMessage: resumeResult.message }, 'Startup resume message (no channels connected)');
    }
  }

  // Step 10: Create and start the gateway server
  const gateway = createGatewayServer(dbManager, config);

  if (!options.skipGatewayListen) {
    await gateway.start(config.gateway.httpPort, config.gateway.host);
    log.info(
      { port: config.gateway.httpPort, host: config.gateway.host },
      'Gateway server started',
    );
  } else {
    await gateway.app.ready();
  }

  // Step 10.5: Wire WebSocket gateway to WebChat adapter
  const webChatAdapter = channelManager.getAdapter('webchat') as WebChatAdapter | undefined;
  if (webChatAdapter) {
    gateway.ws.onMessage((clientId, messageType, payload) => {
      if (messageType === 'chat.send') {
        const wsMessage: WSMessage = {
          type: 'chat.send',
          payload: payload as Record<string, unknown>,
          timestamp: new Date().toISOString(),
        };

        // Register the client's send function so the adapter can reply
        webChatAdapter.registerClient(clientId, (outbound: WSMessage) => {
          gateway.ws.sendTo(clientId, {
            type: outbound.type,
            payload: outbound.payload as Record<string, unknown>,
            timestamp: outbound.timestamp,
          });
        });

        webChatAdapter.handleWebSocketMessage(clientId, wsMessage).catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.error({ clientId, error: errMsg }, 'WebChat message handling failed');
        });
      }
    });
    log.info('WebSocket gateway wired to WebChat adapter');
  }

  // Step 11: Register shutdown handlers
  const shutdownHandler = createShutdownHandler();

  // Start periodic heartbeat for last_active_at tracking (every 60 seconds)
  const heartbeatInterval = setInterval(() => {
    updateLastActiveTimestamp(dbManager.db);
  }, 60_000);

  if (!options.skipSignalHandlers) {
    shutdownHandler.register('heartbeat', () => {
      clearInterval(heartbeatInterval);
    });
    shutdownHandler.register('gateway', async () => {
      await gateway.stop();
    });
    shutdownHandler.register('channels', async () => {
      await channelManager.disconnectAll();
    });
    shutdownHandler.register('database', () => {
      dbManager.close();
    });

    // Stop Ollama on shutdown if we manage its lifecycle
    if (config.providers.ollama?.enabled && isOllamaManagedByUs()) {
      shutdownHandler.register('ollama', async () => {
        await stopOllamaProcess();
      });
    }
  }

  // Step 12: Log startup banner
  logStartupBanner(config);

  const appContext: AppContext = {
    config,
    dbManager,
    providerManager,
    channelManager,
    agentLoop,
    gateway,
    shutdownHandler,
  };

  return appContext;
}
