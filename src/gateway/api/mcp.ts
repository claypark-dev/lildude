/**
 * MCP (Model Context Protocol) API routes.
 * Provides endpoints to manage MCP server connections and view status.
 *
 * Endpoints:
 * - GET /api/v1/mcp/status — list all MCP servers and their connection status
 * - POST /api/v1/mcp/servers — add a new MCP server config
 * - DELETE /api/v1/mcp/servers/:name — remove an MCP server
 * - POST /api/v1/mcp/servers/:name/reconnect — reconnect a specific server
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import type { McpManager } from '../../integrations/mcp-manager.js';
import { deleteMcpServerConfig } from '../../integrations/mcp-client.js';
import { createModuleLogger } from '../../utils/logger.js';

const mcpApiLogger = createModuleLogger('mcp-api');

/**
 * Register MCP management API routes.
 *
 * @param app - The Fastify server instance.
 * @param db - The database instance.
 * @param mcpManager - Optional MCP manager (undefined if MCP is disabled).
 */
export function registerMcpRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
  mcpManager?: McpManager,
): void {
  // GET /api/v1/mcp/status — list all MCP servers and status
  app.get('/api/v1/mcp/status', async (_request, reply) => {
    if (!mcpManager) {
      return reply.status(200).send({
        enabled: false,
        servers: [],
      });
    }

    try {
      const status = mcpManager.getStatus();
      return reply.status(200).send({
        enabled: true,
        servers: status,
        totalTools: status.reduce((sum, s) => sum + s.toolCount, 0),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      mcpApiLogger.error({ error: message }, 'Failed to get MCP status');
      return reply.status(500).send({ error: 'Failed to get MCP status' });
    }
  });

  // POST /api/v1/mcp/servers — add a new MCP server
  app.post('/api/v1/mcp/servers', async (request, reply) => {
    if (!mcpManager) {
      return reply.status(400).send({ error: 'MCP is not enabled' });
    }

    const body = request.body as {
      name?: string;
      transport?: string;
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
    };

    if (!body.name || !body.transport) {
      return reply.status(400).send({ error: 'name and transport are required' });
    }

    const config = {
      name: body.name,
      transport: body.transport as 'stdio' | 'sse',
      command: body.command,
      args: body.args,
      url: body.url,
      env: body.env,
    };

    try {
      await mcpManager.addServer(config, true);
      return reply.status(201).send({ ok: true, server: config.name });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      mcpApiLogger.error({ server: config.name, error: message }, 'Failed to add MCP server');
      return reply.status(500).send({ error: `Failed to add server: ${message}` });
    }
  });

  // DELETE /api/v1/mcp/servers/:name — remove an MCP server
  app.delete('/api/v1/mcp/servers/:name', async (request, reply) => {
    const { name } = request.params as { name: string };

    if (mcpManager) {
      await mcpManager.removeServer(name);
    }
    deleteMcpServerConfig(db, name);

    return reply.status(200).send({ ok: true, removed: name });
  });

  // POST /api/v1/mcp/servers/:name/reconnect — reconnect a specific server
  app.post('/api/v1/mcp/servers/:name/reconnect', async (request, reply) => {
    if (!mcpManager) {
      return reply.status(400).send({ error: 'MCP is not enabled' });
    }

    const { name } = request.params as { name: string };

    try {
      // Remove and re-add
      await mcpManager.removeServer(name);

      // Reload from DB
      const rows = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').all(name) as Array<{
        name: string;
        transport: string;
        command: string | null;
        args: string | null;
        url: string | null;
        env: string | null;
      }>;

      if (rows.length === 0) {
        return reply.status(404).send({ error: `Server "${name}" not found` });
      }

      const row = rows[0];
      await mcpManager.addServer({
        name: row.name,
        transport: row.transport as 'stdio' | 'sse',
        command: row.command ?? undefined,
        args: row.args ? JSON.parse(row.args) as string[] : undefined,
        url: row.url ?? undefined,
        env: row.env ? JSON.parse(row.env) as Record<string, string> : undefined,
      }, true);

      return reply.status(200).send({ ok: true, reconnected: name });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      mcpApiLogger.error({ server: name, error: message }, 'Failed to reconnect MCP server');
      return reply.status(500).send({ error: `Failed to reconnect: ${message}` });
    }
  });
}
