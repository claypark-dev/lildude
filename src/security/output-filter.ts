/**
 * Output filter — scans LLM responses before sending to the user.
 * Detects and strips leaked sensitive data: API key formats, system prompt
 * fragments, database schema, config values, and other users' data.
 * Pure regex, zero LLM cost.
 */

import { securityLogger } from '../utils/logger.js';

/** A detected leak in LLM output. */
export interface OutputLeak {
  type: string;
  description: string;
  match: string;
}

/** Result of filtering LLM output. */
export interface OutputFilterResult {
  /** The filtered output with sensitive data redacted. */
  filtered: string;
  /** Any leaks that were detected and redacted. */
  leaks: OutputLeak[];
  /** Whether any leaks were found. */
  hasLeaks: boolean;
}

/** Patterns that detect sensitive data in LLM output. */
const LEAK_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  description: string;
  replacement: string;
}> = [
  // API key formats
  {
    name: 'anthropic_key',
    pattern: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/g,
    description: 'Anthropic API key',
    replacement: '[REDACTED_API_KEY]',
  },
  {
    name: 'openai_key',
    pattern: /sk-[A-Za-z0-9]{20,}/g,
    description: 'OpenAI API key',
    replacement: '[REDACTED_API_KEY]',
  },
  {
    name: 'generic_api_key',
    pattern: /\b[A-Za-z0-9]{32,64}\b(?=.*(?:api[_-]?key|token|secret))/gi,
    description: 'Generic API key or token',
    replacement: '[REDACTED_API_KEY]',
  },
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/g,
    description: 'Bearer authentication token',
    replacement: 'Bearer [REDACTED]',
  },
  {
    name: 'lildude_api_key',
    pattern: /ld_[A-Za-z0-9_-]{20,}/g,
    description: 'Lil Dude API key',
    replacement: '[REDACTED_API_KEY]',
  },

  // Database schema leaks
  {
    name: 'sql_schema',
    pattern: /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\w+\s*\(/gi,
    description: 'SQL CREATE TABLE statement',
    replacement: '[REDACTED_DB_SCHEMA]',
  },
  {
    name: 'sql_select_star',
    pattern: /SELECT\s+\*\s+FROM\s+(?:api_keys|oauth_tokens|config_store|security_log)/gi,
    description: 'SQL query on sensitive tables',
    replacement: '[REDACTED_QUERY]',
  },

  // System prompt fragments
  {
    name: 'system_prompt_leak',
    pattern: /(?:system\s+prompt|system\s+instructions?):\s*["'][\s\S]{50,}?["']/gi,
    description: 'System prompt content',
    replacement: '[REDACTED_SYSTEM_PROMPT]',
  },

  // Config path leaks
  {
    name: 'config_path',
    pattern: /(?:~\/\.lil-dude|\/home\/\w+\/\.lil-dude)\/[a-zA-Z0-9._/-]+/g,
    description: 'Lil Dude config file path',
    replacement: '[REDACTED_PATH]',
  },

  // OAuth tokens
  {
    name: 'oauth_refresh_token',
    pattern: /\b1\/\/[A-Za-z0-9_-]{30,}\b/g,
    description: 'Google OAuth refresh token',
    replacement: '[REDACTED_OAUTH_TOKEN]',
  },

  // Connection strings
  {
    name: 'connection_string',
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s"']+/gi,
    description: 'Database connection string',
    replacement: '[REDACTED_CONNECTION_STRING]',
  },

  // Private key blocks
  {
    name: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    description: 'Private key block',
    replacement: '[REDACTED_PRIVATE_KEY]',
  },

  // Environment variable dumps
  {
    name: 'env_var_dump',
    pattern: /(?:LIL_DUDE_\w+|ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*=\s*\S+/g,
    description: 'Environment variable with value',
    replacement: '[REDACTED_ENV_VAR]',
  },
];

/**
 * Filter LLM output for sensitive data leaks.
 * Runs all leak patterns and redacts matches.
 *
 * @param output - The raw LLM response text.
 * @returns The filtered result with any leaks detected and redacted.
 */
export function filterOutput(output: string): OutputFilterResult {
  const leaks: OutputLeak[] = [];
  let filtered = output;

  for (const rule of LEAK_PATTERNS) {
    // Reset regex lastIndex for global patterns
    rule.pattern.lastIndex = 0;

    const matches = filtered.match(rule.pattern);
    if (matches) {
      for (const match of matches) {
        leaks.push({
          type: rule.name,
          description: rule.description,
          match: match.substring(0, 30) + (match.length > 30 ? '...' : ''),
        });
      }
      filtered = filtered.replace(rule.pattern, rule.replacement);
    }
  }

  if (leaks.length > 0) {
    securityLogger.warn(
      { leakCount: leaks.length, types: leaks.map((l) => l.type) },
      'Output filter detected sensitive data in LLM response',
    );
  }

  return {
    filtered,
    leaks,
    hasLeaks: leaks.length > 0,
  };
}
