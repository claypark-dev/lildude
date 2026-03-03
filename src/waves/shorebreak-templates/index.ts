/**
 * Shorebreak template registry — S2.N.4
 *
 * Each template is a safe building block that the LLM composes from.
 * Templates include:
 *   - A pattern name and description
 *   - Trigger keywords for matching user requests to templates
 *   - A builder prompt that teaches the LLM how to compose the template
 *   - A code skeleton that the LLM fills in with extracted parameters
 *   - A default safety tier for waves generated from this template
 */

import type { WaveSafetyTier } from '../../types/index.js';

/** A Shorebreak template definition. */
export interface ShorebreakTemplate {
  /** Unique identifier for the template. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** What this template does. */
  description: string;
  /** Keywords that help match user requests to this template. */
  triggers: string[];
  /** Default safety tier for waves generated from this template. */
  defaultSafetyTier: WaveSafetyTier;
  /** The code skeleton with {{PLACEHOLDER}} markers for the LLM to fill. */
  codeSkeleton: string;
  /** Builder prompt that teaches the LLM how to compose this template safely. */
  builderPrompt: string;
  /** Domains this template pattern typically requires (informational). */
  typicalDomains: string[];
}

/**
 * HTTP Fetch template — for API calls with domain validation.
 * Covers: email APIs, calendar APIs, weather APIs, REST services.
 */
const HTTP_FETCH: ShorebreakTemplate = {
  id: 'http-fetch',
  name: 'HTTP API Fetch',
  description: 'Make HTTP requests to a REST API and parse the JSON response',
  triggers: ['api', 'fetch', 'request', 'check', 'get', 'email', 'weather', 'calendar', 'stock', 'price'],
  defaultSafetyTier: 'observe',
  typicalDomains: [],
  builderPrompt: `You are generating a wave that makes HTTP requests using fetch().
RULES:
- Only use the fetch() function provided in the sandbox (it enforces domain checks).
- Parse the response as JSON with response.json().
- Always check response.ok before processing.
- Format the output as a human-readable string.
- Handle errors with try/catch and return a descriptive error message.
- Do NOT use require(), import(), or any Node.js modules.
- Do NOT access process, fs, child_process, or any system APIs.

Fill in the skeleton below by replacing the {{PLACEHOLDERS}} with appropriate values.
The user's extracted parameters will be passed as the 'params' argument.`,
  codeSkeleton: `var execute = async function(params) {
  var url = "{{API_URL}}";
  {{URL_PARAMS_CONSTRUCTION}}

  var response = await fetch(url, {
    method: "{{HTTP_METHOD}}",
    headers: {{HEADERS}},
    {{BODY_IF_NEEDED}}
  });

  if (!response.ok) {
    return "Error: API returned status " + response.status;
  }

  var data = await response.json();
  {{EXTRACT_AND_FORMAT_RESPONSE}}
};`,
};

/**
 * JSON Parser template — for extracting and transforming JSON data.
 */
const JSON_PARSER: ShorebreakTemplate = {
  id: 'json-parser',
  name: 'JSON Parser & Formatter',
  description: 'Parse JSON data, extract specific fields, and format for display',
  triggers: ['parse', 'extract', 'format', 'transform', 'convert', 'summarize'],
  defaultSafetyTier: 'observe',
  typicalDomains: [],
  builderPrompt: `You are generating a wave that parses JSON data and extracts specific fields.
RULES:
- Use standard JSON.parse() and object property access.
- Handle missing fields gracefully with fallback values.
- Format output as a clean human-readable string.
- Do NOT use eval(), Function(), or any dynamic code execution.
- Do NOT access any system APIs or modules.

Fill in the skeleton below by replacing the {{PLACEHOLDERS}}.`,
  codeSkeleton: `var execute = async function(params) {
  var input = params.data || params.input || "";

  var parsed;
  try {
    parsed = typeof input === "string" ? JSON.parse(input) : input;
  } catch (e) {
    return "Error: Could not parse JSON input";
  }

  {{EXTRACT_FIELDS_AND_FORMAT}}
};`,
};

/**
 * File Operations template — for reading/writing with path security.
 * Note: In sandbox, file operations go through the wave's execute() which
 * calls the core tools. The sandbox itself has no fs access.
 */
const FILE_OPS: ShorebreakTemplate = {
  id: 'file-ops',
  name: 'File Operations',
  description: 'Read, write, or list files using the core file tools',
  triggers: ['file', 'read', 'write', 'save', 'create file', 'list files', 'directory'],
  defaultSafetyTier: 'create',
  typicalDomains: [],
  builderPrompt: `You are generating a wave that performs file operations.
RULES:
- File operations in waves use params passed from the core tool system.
- The wave receives file contents or paths as params and processes them.
- Do NOT use require('fs') or any Node.js filesystem modules.
- Do NOT construct file paths dynamically — only use paths from params.
- Format output as a human-readable string.
- Handle missing or empty content gracefully.

Fill in the skeleton below by replacing the {{PLACEHOLDERS}}.`,
  codeSkeleton: `var execute = async function(params) {
  var content = params.content || "";
  var path = params.path || "";

  {{PROCESS_FILE_CONTENT}}
};`,
};

/**
 * Formatter template — for formatting output for display.
 */
const FORMATTER: ShorebreakTemplate = {
  id: 'formatter',
  name: 'Output Formatter',
  description: 'Format data into human-readable text, tables, or summaries',
  triggers: ['format', 'display', 'table', 'summary', 'report', 'list', 'show'],
  defaultSafetyTier: 'observe',
  typicalDomains: [],
  builderPrompt: `You are generating a wave that formats data for human-readable display.
RULES:
- Use string concatenation or template-style formatting.
- Handle arrays by iterating and building formatted strings.
- Handle missing data with sensible defaults like "N/A" or "unknown".
- Keep output concise — summarize long lists.
- Do NOT use any external modules or system APIs.

Fill in the skeleton below by replacing the {{PLACEHOLDERS}}.`,
  codeSkeleton: `var execute = async function(params) {
  var data = params.data || params.items || [];
  var title = params.title || "Results";

  {{FORMAT_OUTPUT}}
};`,
};

/**
 * Scheduler template — for creating cron-based recurring actions.
 */
const SCHEDULER: ShorebreakTemplate = {
  id: 'scheduler',
  name: 'Scheduled Action',
  description: 'Define a recurring action with cron-style scheduling',
  triggers: ['schedule', 'recurring', 'every', 'daily', 'weekly', 'hourly', 'cron', 'remind'],
  defaultSafetyTier: 'create',
  typicalDomains: [],
  builderPrompt: `You are generating a wave that defines a scheduled action.
RULES:
- Return an object with 'schedule' (cron expression) and 'action' (description).
- Use standard 5-field cron: minute hour day month weekday.
- Validate the cron expression format before returning.
- Common patterns: "0 9 * * 1-5" (weekdays at 9am), "0 * * * *" (every hour).
- Do NOT execute the action directly — the scheduler handles execution.
- Do NOT use any system APIs or modules.

Fill in the skeleton below by replacing the {{PLACEHOLDERS}}.`,
  codeSkeleton: `var execute = async function(params) {
  var description = params.description || "{{DEFAULT_DESCRIPTION}}";
  var schedule = "{{CRON_EXPRESSION}}";

  // Validate cron format (5 fields separated by spaces)
  var parts = schedule.split(" ");
  if (parts.length !== 5) {
    return "Error: Invalid cron expression. Expected 5 fields: minute hour day month weekday";
  }

  return JSON.stringify({
    schedule: schedule,
    description: description,
    action: "{{ACTION_TYPE}}"
  });
};`,
};

/** All available templates. */
export const SHOREBREAK_TEMPLATES: readonly ShorebreakTemplate[] = [
  HTTP_FETCH,
  JSON_PARSER,
  FILE_OPS,
  FORMATTER,
  SCHEDULER,
];

/**
 * Find the best matching template for a user request.
 * Matches against template triggers using case-insensitive substring matching.
 * Returns the template with the most trigger matches.
 *
 * @param userMessage - The user's request message.
 * @returns The best matching template, or undefined if no triggers match.
 */
export function findMatchingTemplate(userMessage: string): ShorebreakTemplate | undefined {
  const lowerMessage = userMessage.toLowerCase();
  let bestMatch: { template: ShorebreakTemplate; score: number } | undefined;

  for (const template of SHOREBREAK_TEMPLATES) {
    const matchCount = template.triggers.filter(
      (trigger) => lowerMessage.includes(trigger.toLowerCase()),
    ).length;

    if (matchCount > 0 && (!bestMatch || matchCount > bestMatch.score)) {
      bestMatch = { template, score: matchCount };
    }
  }

  return bestMatch?.template;
}
