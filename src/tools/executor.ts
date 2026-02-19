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
import { executeShellCommand } from './shell.js';
import { readFile, writeFile, listDirectory } from './filesystem.js';
import { httpRequest } from './api.js';
import { knowledgeStore, knowledgeRecall } from './knowledge.js';
import { scheduleTask } from './scheduler.js';

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
 * Create a tool executor configured with the given database, security level, and task ID.
 *
 * The executor maps tool names to their handler functions and applies
 * a configurable timeout to each execution. Unknown tools and execution
 * errors are handled gracefully without crashing.
 *
 * @param db - The better-sqlite3 Database instance.
 * @param securityLevel - The current security level (1-5) for permission checks.
 * @param taskId - Optional task ID for audit trail correlation.
 * @param timeoutMs - Optional timeout in milliseconds (default: 30000).
 * @returns A configured ToolExecutor instance.
 */
export function createToolExecutor(
  db: BetterSqlite3.Database,
  securityLevel: SecurityLevel,
  taskId?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
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
  };

  return {
    async execute(toolUseBlock: ContentBlock): Promise<ContentBlock> {
      const toolName = toolUseBlock.name ?? '';
      const toolUseId = toolUseBlock.id ?? '';
      const toolInput = (toolUseBlock.input ?? {}) as Record<string, unknown>;

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
