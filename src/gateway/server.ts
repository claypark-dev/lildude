/**
 * Main Fastify server setup for the Lil Dude gateway.
 * Registers CORS, static file serving, WebSocket, and REST API routes.
 * Provides start() and stop() lifecycle methods.
 *
 * See HLD Section 7 for gateway architecture.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { DatabaseManager } from '../persistence/db.js';
import type { Config } from '../config/schema.js';
import { gatewayLogger } from '../utils/logger.js';
import { createWSManager, type WSManager } from './ws.js';
import { registerHealthRoutes } from './api/health.js';
import { registerConfigRoutes } from './api/config.js';
import { registerBudgetRoutes } from './api/budget.js';
import { registerTaskRoutes } from './api/tasks.js';
import { registerConversationRoutes } from './api/conversations.js';
import { registerKnowledgeRoutes } from './api/knowledge.js';
import { registerCronRoutes } from './api/cron.js';
import { registerSecurityRoutes } from './api/security.js';
import { registerApprovalRoutes } from './api/approvals.js';
import { registerUsageRoutes } from './api/usage.js';
import { registerBriefingRoutes } from './api/briefing.js';
import { registerRoutingHistoryRoutes } from './api/routing-history.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const log = gatewayLogger;

/** The gateway server with start/stop lifecycle and WebSocket manager access. */
export interface GatewayServer {
  /** The underlying Fastify instance (useful for testing via inject()). */
  readonly app: FastifyInstance;

  /** The WebSocket manager for broadcasting events. */
  readonly ws: WSManager;

  /**
   * Start listening on the given port and host.
   * @param port - TCP port to listen on.
   * @param host - Hostname or IP to bind to. Defaults to '127.0.0.1'.
   */
  start(port: number, host?: string): Promise<void>;

  /**
   * Gracefully stop the server and disconnect all WebSocket clients.
   */
  stop(): Promise<void>;
}

/**
 * Create and configure the gateway Fastify server.
 * Registers all middleware, REST routes, and the WebSocket upgrade handler.
 *
 * @param dbManager - The database manager providing the SQLite connection.
 * @param config - The application configuration.
 * @returns A configured {@link GatewayServer} instance ready to be started.
 */
export function createGatewayServer(
  dbManager: DatabaseManager,
  config: Config,
): GatewayServer {
  const db = dbManager.db;

  const app = Fastify({
    logger: false, // We use our own pino logger
    forceCloseConnections: true,
  });

  const wsManager = createWSManager();

  // ── Plugin registration ───────────────────────────────────────────
  // Fastify plugins are registered asynchronously and resolved when
  // app.ready() or app.listen() is called.

  app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Static file serving for the web panel
  const webDistDir = join(MODULE_DIR, '..', '..', 'web', 'dist');
  if (existsSync(webDistDir)) {
    app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/',
      decorateReply: false,
    });
  }

  // WebSocket plugin
  app.register(fastifyWebsocket);

  // Hook to register WS route after websocket plugin is ready
  app.after(() => {
    app.get('/ws', { websocket: true }, (socket) => {
      wsManager.addClient(socket);
    });
  });

  // ── REST API routes ───────────────────────────────────────────────
  registerHealthRoutes(app, db);
  registerConfigRoutes(app, db);
  registerBudgetRoutes(app, db, config);
  registerTaskRoutes(app, db);
  registerConversationRoutes(app, db);
  registerKnowledgeRoutes(app, db);
  registerCronRoutes(app, db);
  registerSecurityRoutes(app, db);
  registerApprovalRoutes(app, db);
  registerUsageRoutes(app, db);
  registerBriefingRoutes(app, db);
  registerRoutingHistoryRoutes(app, db);

  return {
    get app(): FastifyInstance {
      return app;
    },

    get ws(): WSManager {
      return wsManager;
    },

    async start(port: number, host: string = '127.0.0.1'): Promise<void> {
      try {
        await app.listen({ port, host });
        log.info({ port, host }, 'Gateway server started');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ error: message }, 'Failed to start gateway server');
        throw error;
      }
    },

    async stop(): Promise<void> {
      try {
        wsManager.disconnectAll();
        await app.close();
        log.info('Gateway server stopped');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ error: message }, 'Error stopping gateway server');
        throw error;
      }
    },
  };
}
