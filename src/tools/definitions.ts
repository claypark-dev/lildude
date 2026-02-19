/**
 * Tool definitions — S1.H.2
 *
 * Exports the CORE_TOOLS array containing all tool definitions
 * that are provided to the LLM for tool-use conversations.
 * Each definition follows the ToolDefinition interface from types.
 */

import type { ToolDefinition } from '../types/index.js';

/**
 * Core tool definitions provided to the LLM.
 *
 * Each entry describes a tool's name, purpose, and parameter schema
 * so the LLM can select and invoke the appropriate tool.
 */
export const CORE_TOOLS: ToolDefinition[] = [
  {
    name: 'shell_execute',
    description:
      'Execute a shell command on the local machine. Commands are subject to security checks and may be blocked or require approval depending on the security level.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for the command. Defaults to the current working directory.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read the contents of a file at the given absolute path. Subject to security checks on the file path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to read.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write content to a file at the given absolute path. Creates the file if it does not exist, or overwrites it. Subject to security checks on the file path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to write.',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description:
      'List the contents of a directory, showing each entry as a file or directory. Subject to security checks on the directory path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the directory to list.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'http_request',
    description:
      'Make an outbound HTTP request to the specified URL. Subject to domain permission checks.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to request (must include protocol, e.g. https://).',
        },
        method: {
          type: 'string',
          description: 'The HTTP method to use (GET, POST, PUT, PATCH, DELETE, HEAD).',
        },
        headers: {
          type: 'object',
          description: 'Optional HTTP headers as key-value pairs.',
        },
        body: {
          type: 'string',
          description: 'Optional request body (typically for POST/PUT/PATCH).',
        },
      },
      required: ['url', 'method'],
    },
  },
  {
    name: 'knowledge_store',
    description:
      'Store a piece of knowledge (fact, preference, or context) in the knowledge base for future recall. Use categories to organize entries.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'The category for this knowledge entry (e.g. "personal", "work", "preferences").',
        },
        key: {
          type: 'string',
          description: 'A short descriptive key for the knowledge entry.',
        },
        value: {
          type: 'string',
          description: 'The knowledge value to store.',
        },
      },
      required: ['category', 'key', 'value'],
    },
  },
  {
    name: 'knowledge_recall',
    description:
      'Search the knowledge base for previously stored facts matching a query. Optionally filter by category.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search term to match against knowledge keys and values.',
        },
        category: {
          type: 'string',
          description: 'Optional category to restrict the search to.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'schedule_task',
    description:
      'Create a recurring scheduled task using a 5-field cron expression (minute hour day month weekday). For example "0 9 * * 1-5" runs at 9 AM on weekdays.',
    parameters: {
      type: 'object',
      properties: {
        schedule: {
          type: 'string',
          description: 'A 5-field cron expression (minute hour day month weekday).',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of what the scheduled task does.',
        },
      },
      required: ['schedule', 'description'],
    },
  },
];
