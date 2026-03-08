/**
 * MCP (Model Context Protocol) manager.
 * Manages connections to multiple MCP servers, discovers their tools,
 * and provides a unified interface for the agent loop to consume.
 *
 * Responsibilities:
 * - Load server configs from both config file and database
 * - Connect to all enabled servers on startup
 * - Maintain a pool of active connections
 * - Convert MCP tools → ToolDefinition format for the LLM
 * - Route MCP tool calls to the correct server
 * - Graceful shutdown of all connections
 *
 * See HLD Section 10 for tool architecture.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { createModuleLogger } from '../utils/logger.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import {
  connectMcpServer,
  loadMcpServerConfigs,
  saveMcpServerConfig,
  type McpConnection,
  type McpServerConfig,
  type McpTool,
} from './mcp-client.js';

const log = createModuleLogger('mcp-manager');

/**
 * Prefix applied to MCP tool names to avoid collisions with CORE_TOOLS.
 * Format: mcp_{serverName}_{toolName}
 */
const MCP_TOOL_PREFIX = 'mcp_';

/**
 * Convert an MCP tool name to a prefixed tool name.
 * Uses the server name as a namespace to prevent collisions.
 *
 * @param serverName - The MCP server that provides this tool.
 * @param toolName - The original tool name from the MCP server.
 * @returns A namespaced tool name like `mcp_filesystem_readFile`.
 */
export function buildMcpToolName(serverName: string, toolName: string): string {
  // Sanitize the server name to be a valid identifier segment
  const safeName = serverName.replace(/[^a-zA-Z0-9_]/g, '_');
  return `${MCP_TOOL_PREFIX}${safeName}_${toolName}`;
}

/**
 * Parse an MCP-prefixed tool name back into server name and tool name.
 *
 * @param prefixedName - The prefixed tool name (e.g. `mcp_filesystem_readFile`).
 * @returns `{ serverName, toolName }` or `undefined` if not an MCP tool.
 */
export function parseMcpToolName(prefixedName: string): { serverName: string; toolName: string } | undefined {
  if (!prefixedName.startsWith(MCP_TOOL_PREFIX)) return undefined;

  const rest = prefixedName.slice(MCP_TOOL_PREFIX.length);
  const underscoreIndex = rest.indexOf('_');
  if (underscoreIndex < 0) return undefined;

  return {
    serverName: rest.slice(0, underscoreIndex),
    toolName: rest.slice(underscoreIndex + 1),
  };
}

/**
 * Convert an MCP tool's input schema to the ToolDefinition parameters format.
 * MCP uses JSON Schema; our ToolDefinition expects `{ type, properties, required }`.
 *
 * @param inputSchema - The MCP tool's inputSchema (JSON Schema object).
 * @returns Normalized parameters object for ToolDefinition.
 */
export function convertMcpSchema(inputSchema: Record<string, unknown>): ToolDefinition['parameters'] {
  const properties = (inputSchema.properties ?? {}) as Record<string, unknown>;
  const required = (inputSchema.required ?? []) as string[];

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Convert MCP tools from a server into ToolDefinition format for the LLM.
 *
 * @param tools - Array of MCP tools from a connected server.
 * @returns Array of ToolDefinition objects compatible with the LLM tool catalog.
 */
export function mcpToolsToDefinitions(tools: McpTool[]): ToolDefinition[] {
  return tools.map((tool) => ({
    name: buildMcpToolName(tool.serverName, tool.name),
    description: `[MCP: ${tool.serverName}] ${tool.description}`,
    parameters: convertMcpSchema(tool.inputSchema),
  }));
}

/** Status of a single MCP server connection. */
export interface McpServerStatus {
  name: string;
  transport: 'stdio' | 'sse';
  connected: boolean;
  toolCount: number;
  tools: string[];
  error?: string;
}

/** The MCP manager instance. */
export interface McpManager {
  /** Connect to all configured MCP servers. */
  connectAll(): Promise<void>;

  /** Disconnect all active connections. */
  disconnectAll(): Promise<void>;

  /** Get all available MCP tools as ToolDefinition objects for the LLM. */
  getToolDefinitions(): ToolDefinition[];

  /**
   * Execute an MCP tool call.
   * Routes to the correct server based on the prefixed tool name.
   *
   * @param prefixedToolName - The namespaced tool name (e.g. `mcp_filesystem_readFile`).
   * @param args - The tool call arguments.
   * @returns A ToolResult with the execution output.
   */
  executeTool(prefixedToolName: string, args: Record<string, unknown>): Promise<ToolResult>;

  /** Check if a tool name is an MCP tool. */
  isMcpTool(toolName: string): boolean;

  /** Get status of all configured servers. */
  getStatus(): McpServerStatus[];

  /** Add a new MCP server config and optionally connect immediately. */
  addServer(config: McpServerConfig, connectNow?: boolean): Promise<void>;

  /** Remove an MCP server by name and disconnect it. */
  removeServer(name: string): Promise<void>;
}

/**
 * Create an MCP manager instance.
 *
 * @param db - The database instance for loading/saving server configs.
 * @param configServers - Server configs from the config file (merged with DB configs).
 * @returns A configured McpManager.
 */
export function createMcpManager(
  db: BetterSqlite3.Database,
  configServers: McpServerConfig[] = [],
): McpManager {
  const connections = new Map<string, McpConnection>();
  const errors = new Map<string, string>();
  let allConfigs: McpServerConfig[] = [];

  /**
   * Merge config file servers with database servers.
   * Config file takes precedence (overwrites DB entries with same name).
   */
  function loadConfigs(): McpServerConfig[] {
    const dbConfigs = loadMcpServerConfigs(db);
    const merged = new Map<string, McpServerConfig>();

    // DB configs first (lower priority)
    for (const cfg of dbConfigs) {
      merged.set(cfg.name, cfg);
    }

    // Config file overwrites
    for (const cfg of configServers) {
      merged.set(cfg.name, cfg);
      // Also persist to DB so the dashboard can see them
      try {
        saveMcpServerConfig(db, cfg);
      } catch {
        // Not critical — config file is the source of truth
      }
    }

    return Array.from(merged.values());
  }

  async function connectServer(config: McpServerConfig): Promise<void> {
    if (connections.has(config.name)) {
      log.debug({ server: config.name }, 'Server already connected, skipping');
      return;
    }

    try {
      const connection = await connectMcpServer(config);
      connections.set(config.name, connection);
      errors.delete(config.name);
      log.info(
        { server: config.name, toolCount: connection.tools.length },
        'MCP server connected',
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.set(config.name, msg);
      log.error({ server: config.name, error: msg }, 'Failed to connect MCP server');
    }
  }

  const manager: McpManager = {
    async connectAll(): Promise<void> {
      allConfigs = loadConfigs();

      if (allConfigs.length === 0) {
        log.debug('No MCP servers configured');
        return;
      }

      log.info({ serverCount: allConfigs.length }, 'Connecting to MCP servers');

      // Connect in parallel with individual error handling
      await Promise.allSettled(
        allConfigs.map((config) => connectServer(config)),
      );

      const connected = connections.size;
      const failed = errors.size;
      log.info({ connected, failed, total: allConfigs.length }, 'MCP server connection complete');
    },

    async disconnectAll(): Promise<void> {
      const names = Array.from(connections.keys());
      await Promise.allSettled(
        names.map(async (name) => {
          const conn = connections.get(name);
          if (conn) {
            await conn.disconnect();
            connections.delete(name);
          }
        }),
      );
      errors.clear();
      log.info({ count: names.length }, 'All MCP servers disconnected');
    },

    getToolDefinitions(): ToolDefinition[] {
      const allTools: McpTool[] = [];
      for (const conn of connections.values()) {
        allTools.push(...conn.tools);
      }
      return mcpToolsToDefinitions(allTools);
    },

    async executeTool(prefixedToolName: string, args: Record<string, unknown>): Promise<ToolResult> {
      const parsed = parseMcpToolName(prefixedToolName);
      if (!parsed) {
        return {
          success: false,
          output: '',
          error: `Not an MCP tool: "${prefixedToolName}"`,
        };
      }

      // Find the connection by server name
      // We need to match against the sanitized server name
      let targetConn: McpConnection | undefined;
      for (const conn of connections.values()) {
        const safeName = conn.name.replace(/[^a-zA-Z0-9_]/g, '_');
        if (safeName === parsed.serverName) {
          targetConn = conn;
          break;
        }
      }

      if (!targetConn) {
        return {
          success: false,
          output: '',
          error: `MCP server "${parsed.serverName}" is not connected`,
        };
      }

      try {
        const result = await targetConn.callTool(parsed.toolName, args);

        if (result.isError) {
          const errorText = result.content
            .map((c) => c.text ?? '')
            .filter(Boolean)
            .join('\n');
          return {
            success: false,
            output: '',
            error: errorText || 'MCP tool returned an error',
          };
        }

        const outputText = result.content
          .map((c) => c.text ?? '')
          .filter(Boolean)
          .join('\n');

        return {
          success: true,
          output: outputText || '(no output)',
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          output: '',
          error: `MCP tool execution failed: ${msg}`,
        };
      }
    },

    isMcpTool(toolName: string): boolean {
      return toolName.startsWith(MCP_TOOL_PREFIX);
    },

    getStatus(): McpServerStatus[] {
      return allConfigs.map((config) => {
        const conn = connections.get(config.name);
        const error = errors.get(config.name);
        return {
          name: config.name,
          transport: config.transport,
          connected: !!conn,
          toolCount: conn?.tools.length ?? 0,
          tools: conn?.tools.map((t) => t.name) ?? [],
          error,
        };
      });
    },

    async addServer(config: McpServerConfig, connectNow: boolean = true): Promise<void> {
      saveMcpServerConfig(db, config);
      allConfigs.push(config);
      if (connectNow) {
        await connectServer(config);
      }
    },

    async removeServer(name: string): Promise<void> {
      const conn = connections.get(name);
      if (conn) {
        await conn.disconnect();
        connections.delete(name);
      }
      errors.delete(name);
      allConfigs = allConfigs.filter((c) => c.name !== name);
    },
  };

  return manager;
}
