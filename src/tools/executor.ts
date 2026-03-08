/**
 * Tool executor — S1.H.2
 *
 * Creates a configured tool executor that routes LLM tool_use blocks
 * to the appropriate handler function. Handles timeouts, unknown tools,
 * and execution errors gracefully.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ContentBlock, ToolResult } from '../types/index.js';
import type { SecurityLevel } from '../security/permissions.js';
import type { McpManager } from '../integrations/mcp-manager.js';
import { executeShellCommand } from './shell.js';
import { readFile, writeFile, listDirectory } from './filesystem.js';
import { httpRequest } from './api.js';
import { knowledgeStore, knowledgeRecall } from './knowledge.js';
import { scheduleTask } from './scheduler.js';
import { executeBrowserAction } from './browser.js';
import { CORE_TOOLS } from './definitions.js';
import { DOMAIN_RULES } from '../security/defaults.js';

/** Default timeout for tool execution in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** A handler function that executes a tool and returns a ToolResult. */
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

/** The tool executor interface returned by createToolExecutor. */
export interface ToolExecutor {
  /**
   * Execute a tool_use ContentBlock from the LLM and return a tool_result ContentBlock.
   *
   * @param toolUseBlock - A ContentBlock of type 'tool_use' containing the tool name and input.
   * @returns A ContentBlock of type 'tool_result' with the execution output.
   */
  execute(toolUseBlock: ContentBlock): Promise<ContentBlock>;
}

/**
 * Build a tool_result ContentBlock from a ToolResult.
 *
 * @param toolUseId - The ID from the originating tool_use block.
 * @param toolResult - The result from the tool handler.
 * @returns A ContentBlock of type 'tool_result'.
 */
function buildToolResultBlock(toolUseId: string, toolResult: ToolResult): ContentBlock {
  const outputText = toolResult.success
    ? toolResult.output
    : toolResult.error ?? 'Unknown error';

  return {
    type: 'tool_result',
    toolUseId,
    content: outputText,
    isError: !toolResult.success,
  };
}

/**
 * Wrap a promise with a timeout that rejects after the specified duration.
 *
 * @param promise - The promise to wrap.
 * @param timeoutMs - Maximum time to wait in milliseconds.
 * @returns The result of the promise if it resolves in time.
 * @throws {Error} If the timeout is exceeded.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

/**
 * Validate tool call input against the tool's parameter schema.
 * Checks that required parameters are present and have the correct types.
 * @param toolName - The name of the tool being called.
 * @param input - The input object from the LLM's tool_use block.
 * @returns An error message if validation fails, or undefined if valid.
 */
function validateToolInput(toolName: string, input: Record<string, unknown>): string | undefined {
  const toolDef = CORE_TOOLS.find((tool) => tool.name === toolName);
  if (!toolDef) {
    return undefined; // Unknown tool will be caught by handler lookup
  }

  const { properties, required } = toolDef.parameters;

  // Check required parameters are present
  if (required) {
    const missingParams = required.filter((param) => input[param] === undefined || input[param] === null);
    if (missingParams.length > 0) {
      return `Missing required parameter(s): ${missingParams.join(', ')}. Expected: ${required.join(', ')}`;
    }
  }

  // Check parameter types match schema
  for (const [paramName, paramValue] of Object.entries(input)) {
    const schema = properties[paramName] as { type?: string } | undefined;
    if (!schema || !schema.type) {
      continue;
    }

    const actualType = typeof paramValue;
    if (schema.type === 'string' && actualType !== 'string') {
      return `Parameter "${paramName}" must be a string, got ${actualType}`;
    }
    if (schema.type === 'number' && actualType !== 'number') {
      return `Parameter "${paramName}" must be a number, got ${actualType}`;
    }
    if (schema.type === 'boolean' && actualType !== 'boolean') {
      return `Parameter "${paramName}" must be a boolean, got ${actualType}`;
    }
    if (schema.type === 'object' && (actualType !== 'object' || paramValue === null || Array.isArray(paramValue))) {
      return `Parameter "${paramName}" must be an object`;
    }
  }

  return undefined;
}

/**
 * Build the allowed domains list for browser navigation based on security level.
 * Levels 1-3: only the default API domains (restrictive).
 * Level 4-5: common web domains are also allowed for broader browsing.
 *
 * @param securityLevel - The current security level (1-5).
 * @returns Array of allowed domain strings for the browser tool.
 */
function getAllowedBrowserDomains(securityLevel: SecurityLevel): string[] {
  const base = [...DOMAIN_RULES.DEFAULT_ALLOWED_OUTBOUND];

  // At higher trust levels, allow common web browsing domains
  if (securityLevel >= 4) {
    base.push(
      'google.com', 'www.google.com',
      'github.com', 'www.github.com',
      'stackoverflow.com', 'www.stackoverflow.com',
      'wikipedia.org', 'en.wikipedia.org',
      'reddit.com', 'www.reddit.com',
      'news.ycombinator.com',
      'wttr.in',
      'mail.google.com',
      'calendar.google.com',
      'docs.google.com',
    );
  }

  return base;
}

/** Options for creating a tool executor. */
export interface ToolExecutorOptions {
  /** Optional MCP manager for dispatching MCP tool calls. */
  mcpManager?: McpManager;
}

/**
 * Create a tool executor configured with the given database, security level, and task ID.
 *
 * The executor maps tool names to their handler functions and applies
 * a configurable timeout to each execution. Unknown tools and execution
 * errors are handled gracefully without crashing. If an McpManager is
 * provided, unrecognized tool names are checked against connected MCP
 * servers before returning an error.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param securityLevel - The current security level (1-5) for permission checks.
 * @param taskId - Optional task ID for audit trail correlation.
 * @param timeoutMs - Optional timeout in milliseconds (default: 30000).
 * @param options - Optional configuration including McpManager.
 * @returns A configured ToolExecutor instance.
 */
export function createToolExecutor(
  db: BetterSqlite3.Database,
  securityLevel: SecurityLevel,
  taskId?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  options?: ToolExecutorOptions,
): ToolExecutor {
  const handlers: Record<string, ToolHandler> = {
    shell_execute: async (input) => {
      const command = input.command as string;
      const cwd = input.cwd as string | undefined;
      return executeShellCommand(db, command, securityLevel, cwd, taskId);
    },

    read_file: async (input) => {
      const path = input.path as string;
      return readFile(db, path, securityLevel, taskId);
    },

    write_file: async (input) => {
      const path = input.path as string;
      const content = input.content as string;
      return writeFile(db, path, content, securityLevel, taskId);
    },

    list_directory: async (input) => {
      const path = input.path as string;
      return listDirectory(db, path, securityLevel, taskId);
    },

    http_request: async (input) => {
      const url = input.url as string;
      const method = input.method as string;
      const headers = input.headers as Record<string, string> | undefined;
      const body = input.body as string | undefined;
      return httpRequest(
        db,
        url,
        method as 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        securityLevel,
        headers,
        body,
        taskId,
      );
    },

    knowledge_store: async (input) => {
      const category = input.category as string;
      const key = input.key as string;
      const value = input.value as string;
      return knowledgeStore(db, category, key, value, {
        sourceTaskId: taskId,
        securityLevel,
      });
    },

    knowledge_recall: async (input) => {
      const query = input.query as string;
      const category = input.category as string | undefined;
      return knowledgeRecall(db, query, category, {
        securityLevel,
        taskId,
      });
    },

    schedule_task: async (input) => {
      const schedule = input.schedule as string;
      const description = input.description as string;
      return scheduleTask(db, schedule, description, {
        securityLevel,
        taskId,
      });
    },

    browser_navigate: async (input) => {
      const url = input.url as string;
      const script = input.script as string | undefined;
      const screenshot = input.screenshot as boolean | undefined;
      // Browser uses the same domain allowlist as HTTP requests.
      // At security levels 1-3, only explicitly allowed domains work.
      // At levels 4-5, all non-blocked domains are allowed.
      const allowedDomains = getAllowedBrowserDomains(securityLevel);
      const result = await executeBrowserAction({ url, script, screenshot, allowedDomains });
      return {
        success: result.success,
        output: result.success
          ? result.screenshotPath
            ? `${result.content}\n\nScreenshot saved: ${result.screenshotPath}`
            : result.content
          : '',
        error: result.error,
      };
    },
  };

  return {
    async execute(toolUseBlock: ContentBlock): Promise<ContentBlock> {
      const toolName = toolUseBlock.name ?? '';
      const toolUseId = toolUseBlock.id ?? '';
      const toolInput = (toolUseBlock.input ?? {}) as Record<string, unknown>;

      // Check if this is an MCP tool call
      if (options?.mcpManager?.isMcpTool(toolName)) {
        try {
          const toolResult = await withTimeout(
            options.mcpManager.executeTool(toolName, toolInput),
            timeoutMs,
          );
          return buildToolResultBlock(toolUseId, toolResult);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          const errorResult: ToolResult = {
            success: false,
            output: '',
            error: `MCP tool execution failed: ${message}`,
          };
          return buildToolResultBlock(toolUseId, errorResult);
        }
      }

      // Validate tool input against schema before execution
      const validationError = validateToolInput(toolName, toolInput);
      if (validationError) {
        const errorResult: ToolResult = {
          success: false,
          output: '',
          error: `Invalid tool input for "${toolName}": ${validationError}`,
        };
        return buildToolResultBlock(toolUseId, errorResult);
      }

      const handler = handlers[toolName];

      if (!handler) {
        const errorResult: ToolResult = {
          success: false,
          output: '',
          error: `Unknown tool: "${toolName}". Available tools: ${Object.keys(handlers).join(', ')}`,
        };
        return buildToolResultBlock(toolUseId, errorResult);
      }

      try {
        const toolResult = await withTimeout(handler(toolInput), timeoutMs);
        return buildToolResultBlock(toolUseId, toolResult);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const errorResult: ToolResult = {
          success: false,
          output: '',
          error: `Tool execution failed: ${message}`,
        };
        return buildToolResultBlock(toolUseId, errorResult);
      }
    },
  };
}
