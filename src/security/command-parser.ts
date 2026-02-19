/**
 * Security Command Parser — S0.D.1
 *
 * Parses raw shell command strings into structured ParsedCommand objects.
 * This is the MOST SECURITY-CRITICAL code in the project.
 *
 * RULE: Always PARSE commands, never string-match for security decisions.
 */

import type { ParsedCommand } from '../types/index.js';

/** Redirect operators we detect */
const REDIRECT_PATTERN = /(?:>>|>|<|2>&1|2>|&>)/;

/** Detects command substitution via $(...) or backticks */
const COMMAND_SUBSTITUTION_DOLLAR = /\$\(/;
const COMMAND_SUBSTITUTION_BACKTICK = /`/;

/** Detects variable expansion via $VAR or ${VAR} */
const VARIABLE_EXPANSION_BRACE = /\$\{[^}]+\}/;
const VARIABLE_EXPANSION_BARE = /\$[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Check whether a raw command string contains command substitution.
 * Detects both $(...) and backtick forms.
 *
 * @param raw - The raw shell command string
 * @returns true if command substitution is present
 */
export function hasCommandSubstitution(raw: string): boolean {
  return COMMAND_SUBSTITUTION_DOLLAR.test(raw) || COMMAND_SUBSTITUTION_BACKTICK.test(raw);
}

/**
 * Check whether a raw command string contains variable expansion.
 * Detects both ${VAR} and $VAR forms.
 *
 * @param raw - The raw shell command string
 * @returns true if variable expansion is present
 */
export function hasVariableExpansion(raw: string): boolean {
  return VARIABLE_EXPANSION_BRACE.test(raw) || VARIABLE_EXPANSION_BARE.test(raw);
}

/**
 * Tokenize a raw shell command string into individual tokens.
 * Handles single quotes, double quotes, escape characters, and multiple spaces.
 *
 * @param input - The raw command string to tokenize
 * @returns Array of string tokens
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Split a raw command string on chain operators (;, &&, ||),
 * respecting quoting so that operators inside quotes are not split on.
 *
 * @param raw - The raw command string
 * @returns Array of individual command segments (trimmed)
 */
function splitOnChainOperators(raw: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;
  let parenDepth = 0;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    // Track parentheses for subshells — don't split inside them
    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '(') {
        parenDepth++;
        current += char;
        continue;
      }
      if (char === ')') {
        parenDepth--;
        current += char;
        continue;
      }
    }

    if (!inSingleQuote && !inDoubleQuote && parenDepth === 0) {
      // Check for && or ||
      if ((char === '&' && raw[i + 1] === '&') || (char === '|' && raw[i + 1] === '|')) {
        if (current.trim().length > 0) {
          segments.push(current.trim());
        }
        current = '';
        i++; // skip the second character of the operator
        continue;
      }

      // Check for ; (but not inside already checked contexts)
      if (char === ';') {
        if (current.trim().length > 0) {
          segments.push(current.trim());
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim().length > 0) {
    segments.push(current.trim());
  }

  return segments;
}

/**
 * Split a single command segment on pipe operators (|),
 * respecting quoting. Does NOT split on || (logical OR).
 *
 * @param segment - A single command segment (no ;, &&, || operators)
 * @returns Array of piped command strings (trimmed)
 */
function splitOnPipes(segment: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (char === '|' && !inSingleQuote && !inDoubleQuote) {
      // Make sure this is a single pipe, not ||
      if (segment[i + 1] === '|') {
        // This is || — should not appear here since we already split on chain ops
        // but handle gracefully by not splitting
        current += char;
        continue;
      }
      if (current.trim().length > 0) {
        parts.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Detect whether a token is a redirect operator.
 *
 * @param token - A single token
 * @returns true if the token is a redirect operator
 */
function isRedirectToken(token: string): boolean {
  return /^(?:>>?|<|2>&1|2>|&>)$/.test(token);
}

/**
 * Parse a single simple command (no pipes, no chain operators) into a ParsedCommand.
 *
 * @param commandStr - The raw simple command string
 * @returns A ParsedCommand object
 */
function parseSingleCommand(commandStr: string): ParsedCommand {
  const tokens = tokenize(commandStr);

  let binary = '';
  const args: string[] = [];
  let hasRedirects = false;
  let hasSudo = false;
  let skipNext = false;

  for (let i = 0; i < tokens.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const token = tokens[i];

    // Detect redirects
    if (isRedirectToken(token)) {
      hasRedirects = true;
      // The next token is the redirect target — skip it from args
      skipNext = true;
      continue;
    }

    // Check if the token contains a redirect operator embedded (e.g., "2>/dev/null")
    if (REDIRECT_PATTERN.test(token) && token !== binary) {
      hasRedirects = true;
      // Don't add pure redirect tokens to args
      // But if the token starts with a redirect, it's a redirect target combo
      continue;
    }

    if (binary === '') {
      // Handle sudo as a prefix — record it, then continue looking for the actual binary
      if (token === 'sudo') {
        hasSudo = true;
        continue;
      }
      binary = token;
    } else {
      // Check if this arg has an embedded redirect (e.g., ">output.txt")
      if (/^(?:>>?|<|2>|&>)/.test(token)) {
        hasRedirects = true;
        continue;
      }
      args.push(token);
    }
  }

  return {
    binary,
    args,
    rawCommand: commandStr,
    pipes: [],
    hasRedirects,
    hasSudo,
  };
}

/**
 * Parse a raw shell command string into an array of structured ParsedCommand objects.
 *
 * Handles:
 * - Quoted arguments (single and double quotes)
 * - Escaped characters
 * - Command chaining (;, &&, ||) — each part parsed separately
 * - Pipes (|) — piped commands stored in the pipes array
 * - Redirect detection (>, >>, <, 2>&1)
 * - sudo detection
 * - Multiple/extra spaces
 *
 * @param raw - The raw shell command string to parse
 * @returns Array of ParsedCommand objects (one per chained segment)
 */
export function parseCommand(raw: string): ParsedCommand[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const chainedSegments = splitOnChainOperators(trimmed);
  const results: ParsedCommand[] = [];

  for (const segment of chainedSegments) {
    const pipeParts = splitOnPipes(segment);

    if (pipeParts.length === 0) {
      continue;
    }

    // Parse the first command as the primary
    const primary = parseSingleCommand(pipeParts[0]);
    primary.rawCommand = segment;

    // Parse remaining pipe parts
    for (let i = 1; i < pipeParts.length; i++) {
      const pipedCmd = parseSingleCommand(pipeParts[i]);
      primary.pipes.push(pipedCmd);
    }

    // If any piped command has sudo, propagate to primary
    if (primary.pipes.some((pipedCmd) => pipedCmd.hasSudo)) {
      primary.hasSudo = true;
    }

    // If any piped command has redirects, propagate to primary
    if (primary.pipes.some((pipedCmd) => pipedCmd.hasRedirects)) {
      primary.hasRedirects = true;
    }

    results.push(primary);
  }

  return results;
}
