/**
 * MCP (Model Context Protocol) client.
 * Connects to external MCP servers and exposes their tools
 * as additional tool providers for the agent loop.
 *
 * Supports two transport modes:
 * - stdio: Launches a subprocess and communicates via stdin/stdout
 * - sse: Connects to an HTTP SSE endpoint
 *
 * This is a lightweight client that speaks the MCP JSON-RPC protocol.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type BetterSqlite3 from 'better-sqlite3';
import { createModuleLogger } from '../utils/logger.js';

const mcpLogger = createModuleLogger('mcp-client');

/** MCP server configuration. */
export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

/** An MCP tool definition exposed by a server. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

/** Result of an MCP tool call. */
export interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
}

/** MCP JSON-RPC message. */
interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Represents a connected MCP server. */
export interface McpConnection {
  name: string;
  transport: 'stdio' | 'sse';
  tools: McpTool[];
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  disconnect(): Promise<void>;
}

/**
 * Connect to an MCP server via stdio transport.
 * Launches the command as a subprocess and communicates via JSON-RPC over stdin/stdout.
 *
 * @param config - The MCP server configuration.
 * @returns A connected MCP connection with available tools.
 */
export async function connectStdioServer(
  config: McpServerConfig,
): Promise<McpConnection> {
  if (!config.command) {
    throw new Error(`MCP server "${config.name}" requires a command for stdio transport`);
  }

  const env = { ...process.env, ...config.env };
  const child: ChildProcess = spawn(config.command, config.args ?? [], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (!child.stdin || !child.stdout) {
    throw new Error(`Failed to spawn MCP server "${config.name}"`);
  }

  let messageId = 0;
  const pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();

  let buffer = '';

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    // Process complete JSON-RPC messages (newline-delimited)
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as JsonRpcMessage;
        if (msg.id !== undefined && pendingRequests.has(msg.id)) {
          const pending = pendingRequests.get(msg.id)!;
          pendingRequests.delete(msg.id);

          if (msg.error) {
            pending.reject(new Error(`MCP error: ${msg.error.message}`));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {
        mcpLogger.debug({ line: trimmed.slice(0, 100) }, 'Non-JSON output from MCP server');
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    mcpLogger.debug({ server: config.name, stderr: chunk.toString().trim() }, 'MCP server stderr');
  });

  function sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      pendingRequests.set(id, { resolve, reject });

      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const payload = JSON.stringify(message) + '\n';

      try {
        child.stdin!.write(payload);
      } catch (error: unknown) {
        pendingRequests.delete(id);
        const msg = error instanceof Error ? error.message : String(error);
        reject(new Error(`Failed to send to MCP server: ${msg}`));
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 30000);
    });
  }

  // Initialize the connection
  try {
    await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'lil-dude', version: '0.1.0' },
    });

    // Send initialized notification
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  } catch (error: unknown) {
    child.kill();
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize MCP server "${config.name}": ${msg}`);
  }

  // List available tools
  let tools: McpTool[] = [];
  try {
    const toolsResult = await sendRequest('tools/list') as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> };
    tools = (toolsResult.tools ?? []).map((tool) => ({
      ...tool,
      serverName: config.name,
    }));
    mcpLogger.info(
      { server: config.name, toolCount: tools.length },
      'MCP server connected, tools loaded',
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    mcpLogger.warn({ server: config.name, error: msg }, 'Failed to list MCP tools');
  }

  return {
    name: config.name,
    transport: 'stdio',
    tools,

    async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
      try {
        const result = await sendRequest('tools/call', { name: toolName, arguments: args }) as McpToolResult;
        return result;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `MCP tool error: ${msg}` }],
          isError: true,
        };
      }
    },

    async disconnect(): Promise<void> {
      try {
        child.kill('SIGTERM');
        // Give it a moment to shut down gracefully
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!child.killed) {
          child.kill('SIGKILL');
        }
        mcpLogger.info({ server: config.name }, 'MCP server disconnected');
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        mcpLogger.warn({ server: config.name, error: msg }, 'Error disconnecting MCP server');
      }
    },
  };
}

/**
 * Connect to an MCP server via SSE transport.
 * Establishes an HTTP SSE connection for server-sent events.
 *
 * @param config - The MCP server configuration.
 * @returns A connected MCP connection with available tools.
 */
export async function connectSseServer(
  config: McpServerConfig,
): Promise<McpConnection> {
  if (!config.url) {
    throw new Error(`MCP server "${config.name}" requires a url for SSE transport`);
  }

  mcpLogger.info({ server: config.name, url: config.url }, 'SSE transport not yet implemented, returning empty connection');

  // SSE transport is a placeholder — stdio covers the primary use case
  return {
    name: config.name,
    transport: 'sse',
    tools: [],

    async callTool(): Promise<McpToolResult> {
      return {
        content: [{ type: 'text', text: 'SSE transport not yet implemented' }],
        isError: true,
      };
    },

    async disconnect(): Promise<void> {
      mcpLogger.info({ server: config.name }, 'SSE MCP server disconnected');
    },
  };
}

/**
 * Connect to an MCP server using the configured transport.
 *
 * @param config - The MCP server configuration.
 * @returns A connected MCP connection.
 */
export async function connectMcpServer(
  config: McpServerConfig,
): Promise<McpConnection> {
  if (config.transport === 'stdio') {
    return connectStdioServer(config);
  }
  return connectSseServer(config);
}

/**
 * Load MCP server configurations from the database.
 *
 * @param db - The database instance.
 * @returns Array of MCP server configs.
 */
export function loadMcpServerConfigs(
  db: BetterSqlite3.Database,
): McpServerConfig[] {
  try {
    const rows = db.prepare(`
      SELECT name, transport, command, args, url, env
      FROM mcp_servers
      WHERE enabled = 1
    `).all() as Array<{
      name: string;
      transport: string;
      command: string | null;
      args: string | null;
      url: string | null;
      env: string | null;
    }>;

    return rows.map((row) => ({
      name: row.name,
      transport: row.transport as 'stdio' | 'sse',
      command: row.command ?? undefined,
      args: row.args ? JSON.parse(row.args) as string[] : undefined,
      url: row.url ?? undefined,
      env: row.env ? JSON.parse(row.env) as Record<string, string> : undefined,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    mcpLogger.warn({ error: message }, 'Failed to load MCP server configs');
    return [];
  }
}

/**
 * Save an MCP server configuration to the database.
 *
 * @param db - The database instance.
 * @param config - The MCP server configuration to save.
 */
export function saveMcpServerConfig(
  db: BetterSqlite3.Database,
  config: McpServerConfig,
): void {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO mcp_servers (name, transport, command, args, url, env, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      config.name,
      config.transport,
      config.command ?? null,
      config.args ? JSON.stringify(config.args) : null,
      config.url ?? null,
      config.env ? JSON.stringify(config.env) : null,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    mcpLogger.error({ name: config.name, error: message }, 'Failed to save MCP server config');
    throw error;
  }
}

/**
 * Delete an MCP server configuration from the database.
 *
 * @param db - The database instance.
 * @param name - The MCP server name.
 * @returns Whether the config was deleted.
 */
export function deleteMcpServerConfig(
  db: BetterSqlite3.Database,
  name: string,
): boolean {
  try {
    const result = db.prepare('DELETE FROM mcp_servers WHERE name = ?').run(name);
    return result.changes > 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    mcpLogger.error({ name, error: message }, 'Failed to delete MCP server config');
    return false;
  }
}
