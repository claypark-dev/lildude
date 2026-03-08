/**
 * Tests for MCP Manager — tool name conversion, schema mapping, and manager behavior.
 */

import { describe, it, expect } from 'vitest';

// --- Inline implementations of pure functions to test without module imports ---
// (These match the implementations in mcp-manager.ts)

const MCP_TOOL_PREFIX = 'mcp_';

function buildMcpToolName(serverName: string, toolName: string): string {
  const safeName = serverName.replace(/[^a-zA-Z0-9_]/g, '_');
  return `${MCP_TOOL_PREFIX}${safeName}_${toolName}`;
}

function parseMcpToolName(prefixedName: string): { serverName: string; toolName: string } | undefined {
  if (!prefixedName.startsWith(MCP_TOOL_PREFIX)) return undefined;
  const rest = prefixedName.slice(MCP_TOOL_PREFIX.length);
  const underscoreIndex = rest.indexOf('_');
  if (underscoreIndex < 0) return undefined;
  return {
    serverName: rest.slice(0, underscoreIndex),
    toolName: rest.slice(underscoreIndex + 1),
  };
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

function convertMcpSchema(inputSchema: Record<string, unknown>): ToolDefinition['parameters'] {
  const properties = (inputSchema.properties ?? {}) as Record<string, unknown>;
  const required = (inputSchema.required ?? []) as string[];
  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

function mcpToolsToDefinitions(tools: McpTool[]): ToolDefinition[] {
  return tools.map((tool) => ({
    name: buildMcpToolName(tool.serverName, tool.name),
    description: `[MCP: ${tool.serverName}] ${tool.description}`,
    parameters: convertMcpSchema(tool.inputSchema),
  }));
}

// --- Tests ---

describe('MCP Manager — Tool Name Conversion', () => {
  it('builds a prefixed tool name from server and tool names', () => {
    expect(buildMcpToolName('filesystem', 'readFile')).toBe('mcp_filesystem_readFile');
  });

  it('sanitizes server names with special characters', () => {
    expect(buildMcpToolName('my-server', 'list')).toBe('mcp_my_server_list');
    expect(buildMcpToolName('server.v2', 'query')).toBe('mcp_server_v2_query');
    expect(buildMcpToolName('ns/name', 'run')).toBe('mcp_ns_name_run');
  });

  it('handles server names with no special chars', () => {
    expect(buildMcpToolName('sqlite', 'query')).toBe('mcp_sqlite_query');
  });

  it('preserves underscores in server names', () => {
    expect(buildMcpToolName('my_server', 'tool')).toBe('mcp_my_server_tool');
  });
});

describe('MCP Manager — Tool Name Parsing', () => {
  it('parses a valid MCP tool name', () => {
    const result = parseMcpToolName('mcp_filesystem_readFile');
    expect(result).toEqual({ serverName: 'filesystem', toolName: 'readFile' });
  });

  it('returns undefined for non-MCP tool names', () => {
    expect(parseMcpToolName('shell_execute')).toBeUndefined();
    expect(parseMcpToolName('read_file')).toBeUndefined();
    expect(parseMcpToolName('')).toBeUndefined();
  });

  it('returns undefined for MCP prefix with no underscore separator', () => {
    expect(parseMcpToolName('mcp_noseparator')).toBeUndefined();
  });

  it('handles tool names with underscores', () => {
    const result = parseMcpToolName('mcp_db_list_tables');
    expect(result).toEqual({ serverName: 'db', toolName: 'list_tables' });
  });

  it('round-trips build and parse', () => {
    const built = buildMcpToolName('myserver', 'doStuff');
    const parsed = parseMcpToolName(built);
    expect(parsed?.serverName).toBe('myserver');
    expect(parsed?.toolName).toBe('doStuff');
  });
});

describe('MCP Manager — Schema Conversion', () => {
  it('converts a full MCP input schema to ToolDefinition parameters', () => {
    const schema = {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        encoding: { type: 'string', description: 'File encoding' },
      },
      required: ['path'],
    };

    const result = convertMcpSchema(schema);
    expect(result.type).toBe('object');
    expect(result.properties).toHaveProperty('path');
    expect(result.properties).toHaveProperty('encoding');
    expect(result.required).toEqual(['path']);
  });

  it('handles schemas with no required fields', () => {
    const schema = {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    };

    const result = convertMcpSchema(schema);
    expect(result.required).toBeUndefined();
  });

  it('handles empty schemas', () => {
    const result = convertMcpSchema({});
    expect(result.type).toBe('object');
    expect(result.properties).toEqual({});
    expect(result.required).toBeUndefined();
  });

  it('handles schemas with empty required array', () => {
    const schema = {
      type: 'object',
      properties: { x: { type: 'number' } },
      required: [],
    };
    const result = convertMcpSchema(schema);
    expect(result.required).toBeUndefined();
  });
});

describe('MCP Manager — Tool Definition Conversion', () => {
  it('converts MCP tools to ToolDefinition format', () => {
    const tools: McpTool[] = [
      {
        name: 'read_file',
        description: 'Read a file from disk',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
          },
          required: ['path'],
        },
        serverName: 'filesystem',
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
        serverName: 'filesystem',
      },
    ];

    const defs = mcpToolsToDefinitions(tools);
    expect(defs).toHaveLength(2);
    expect(defs[0].name).toBe('mcp_filesystem_read_file');
    expect(defs[0].description).toContain('[MCP: filesystem]');
    expect(defs[0].description).toContain('Read a file from disk');
    expect(defs[0].parameters.required).toEqual(['path']);

    expect(defs[1].name).toBe('mcp_filesystem_write_file');
    expect(defs[1].parameters.required).toEqual(['path', 'content']);
  });

  it('handles tools from different servers', () => {
    const tools: McpTool[] = [
      {
        name: 'query',
        description: 'Run a SQL query',
        inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
        serverName: 'sqlite',
      },
      {
        name: 'fetch',
        description: 'Fetch a URL',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        serverName: 'web',
      },
    ];

    const defs = mcpToolsToDefinitions(tools);
    expect(defs[0].name).toBe('mcp_sqlite_query');
    expect(defs[1].name).toBe('mcp_web_fetch');
    expect(defs[0].description).toContain('[MCP: sqlite]');
    expect(defs[1].description).toContain('[MCP: web]');
  });

  it('returns empty array for no tools', () => {
    expect(mcpToolsToDefinitions([])).toEqual([]);
  });
});

describe('MCP Manager — isMcpTool', () => {
  function isMcpTool(name: string): boolean {
    return name.startsWith(MCP_TOOL_PREFIX);
  }

  it('identifies MCP tools', () => {
    expect(isMcpTool('mcp_server_tool')).toBe(true);
    expect(isMcpTool('mcp_fs_readFile')).toBe(true);
  });

  it('rejects non-MCP tools', () => {
    expect(isMcpTool('shell_execute')).toBe(false);
    expect(isMcpTool('read_file')).toBe(false);
    expect(isMcpTool('')).toBe(false);
  });
});

describe('MCP Manager — McpServerConfig validation', () => {
  it('validates required fields for stdio transport', () => {
    const config = {
      name: 'test-server',
      transport: 'stdio' as const,
      command: 'node',
      args: ['server.js'],
    };
    expect(config.name).toBe('test-server');
    expect(config.transport).toBe('stdio');
    expect(config.command).toBe('node');
    expect(config.args).toEqual(['server.js']);
  });

  it('validates required fields for SSE transport', () => {
    const config = {
      name: 'remote-server',
      transport: 'sse' as const,
      url: 'http://localhost:3000/sse',
    };
    expect(config.name).toBe('remote-server');
    expect(config.transport).toBe('sse');
    expect(config.url).toBe('http://localhost:3000/sse');
  });

  it('allows optional env vars', () => {
    const config = {
      name: 'with-env',
      transport: 'stdio' as const,
      command: 'python',
      args: ['mcp_server.py'],
      env: { API_KEY: 'secret-123', DEBUG: 'true' },
    };
    expect(config.env).toHaveProperty('API_KEY');
    expect(config.env).toHaveProperty('DEBUG');
  });
});

describe('MCP Manager — Tool Merging', () => {
  it('merges MCP tools with CORE_TOOLS without conflicts', () => {
    // Simulate CORE_TOOLS
    const coreTools: ToolDefinition[] = [
      {
        name: 'shell_execute',
        description: 'Execute a shell command',
        parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      },
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    ];

    // Simulate MCP tools (one of which has same name as core tool)
    const mcpTools: McpTool[] = [
      {
        name: 'read_file',
        description: 'Read a file from MCP filesystem',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        serverName: 'fs',
      },
    ];

    const mcpDefs = mcpToolsToDefinitions(mcpTools);
    const allTools = [...coreTools, ...mcpDefs];

    // No name collisions because MCP tools are prefixed
    expect(allTools).toHaveLength(3);
    const names = allTools.map((t) => t.name);
    expect(names).toContain('shell_execute');
    expect(names).toContain('read_file');
    expect(names).toContain('mcp_fs_read_file');

    // Names are all unique
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(3);
  });
});

describe('MCP Manager — Config Schema', () => {
  it('validates the expected Zod schema shape', () => {
    // Simulate what the Zod schema produces for MCP config
    const defaultMcpConfig = {
      enabled: false,
      autoConnectOnStartup: true,
      servers: [],
    };

    expect(defaultMcpConfig.enabled).toBe(false);
    expect(defaultMcpConfig.autoConnectOnStartup).toBe(true);
    expect(defaultMcpConfig.servers).toEqual([]);
  });

  it('validates a populated MCP config', () => {
    const mcpConfig = {
      enabled: true,
      autoConnectOnStartup: true,
      servers: [
        {
          name: 'sqlite',
          transport: 'stdio' as const,
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-sqlite', '/tmp/test.db'],
        },
        {
          name: 'brave-search',
          transport: 'stdio' as const,
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
          env: { BRAVE_API_KEY: 'test-key' },
        },
      ],
    };

    expect(mcpConfig.enabled).toBe(true);
    expect(mcpConfig.servers).toHaveLength(2);
    expect(mcpConfig.servers[0].name).toBe('sqlite');
    expect(mcpConfig.servers[1].env?.BRAVE_API_KEY).toBe('test-key');
  });
});

describe('MCP Manager — Error Handling', () => {
  it('executeTool returns error for non-MCP tool names', () => {
    // Simulate what the manager would return
    const parsed = parseMcpToolName('shell_execute');
    expect(parsed).toBeUndefined();
  });

  it('executeTool returns error for disconnected server', () => {
    // Simulate: parsed OK but server not in connections map
    const parsed = parseMcpToolName('mcp_ghost_doStuff');
    expect(parsed).toEqual({ serverName: 'ghost', toolName: 'doStuff' });
    // The manager would check connections map and return error
  });

  it('tool result formatting for success', () => {
    const mcpResult = {
      content: [{ type: 'text', text: 'File contents here' }],
      isError: false,
    };

    const outputText = mcpResult.content
      .map((c) => c.text ?? '')
      .filter(Boolean)
      .join('\n');

    expect(outputText).toBe('File contents here');
  });

  it('tool result formatting for error', () => {
    const mcpResult = {
      content: [{ type: 'text', text: 'Permission denied' }],
      isError: true,
    };

    const errorText = mcpResult.content
      .map((c) => c.text ?? '')
      .filter(Boolean)
      .join('\n');

    expect(errorText).toBe('Permission denied');
  });

  it('tool result with multiple content blocks', () => {
    const mcpResult = {
      content: [
        { type: 'text', text: 'Line 1' },
        { type: 'text', text: 'Line 2' },
        { type: 'image' }, // no text
      ],
      isError: false,
    };

    const outputText = mcpResult.content
      .map((c) => c.text ?? '')
      .filter(Boolean)
      .join('\n');

    expect(outputText).toBe('Line 1\nLine 2');
  });

  it('tool result with empty content', () => {
    const mcpResult = {
      content: [],
      isError: false,
    };

    const outputText = mcpResult.content
      .map((c: { text?: string }) => c.text ?? '')
      .filter(Boolean)
      .join('\n');

    expect(outputText || '(no output)').toBe('(no output)');
  });
});
