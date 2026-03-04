/**
 * Party wave execution context builder and output sanitizer.
 * Ensures external-facing waves never leak owner-private data.
 * See CLAUDE.md: NEVER process external content without wrapUntrustedContent().
 */

import type { Contact } from '../types/index.js';
import { createModuleLogger, securityLogger } from '../utils/logger.js';

const partyLogger = createModuleLogger('party-wave-context');

/** Context keys that MUST be stripped from party wave execution context. */
const BLOCKED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  'ownerPreferences',
  'ownerSchedule',
  'ownerNotes',
  'privateKnowledge',
  'apiKeys',
  'systemPrompt',
  'conversationHistory',
  'ownerEmail',
  'ownerPhone',
  'ownerAddress',
  'ownerCalendar',
  'securityConfig',
  'providerKeys',
  'tokenUsage',
  'budgetDetails',
  'knowledgeContext',
  'userProfile',
  'conversationSummary',
]);

/** Param value patterns that indicate leaked owner data in extracted params. */
const BLOCKED_PARAM_VALUE_PATTERNS: readonly RegExp[] = [
  // SSN patterns
  /\b\d{3}-\d{2}-\d{4}\b/,
  // Credit card numbers
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  // API key patterns
  /(?:sk|pk|api|key|token|secret)[-_]?[a-zA-Z0-9]{20,}/i,
  // Config paths
  /(?:~\/\.lil-dude|\.env|config\.json|credentials)/i,
  // Database references
  /(?:CREATE TABLE|ALTER TABLE|INSERT INTO|SELECT \* FROM)/i,
];

/** Patterns that indicate owner-private data in wave output. */
const SENSITIVE_OUTPUT_PATTERNS: readonly RegExp[] = [
  // Email addresses (owner's email could leak)
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Phone numbers (various formats)
  /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  // API key patterns
  /(?:sk|pk|api|key|token|secret)[-_]?[a-zA-Z0-9]{20,}/gi,
  // System prompt fragments
  /(?:you are|your role is|system prompt|instructions:)/gi,
  // Database schema references
  /(?:CREATE TABLE|ALTER TABLE|INSERT INTO|SELECT \* FROM)/gi,
  // Config file paths
  /(?:~\/\.lil-dude|\.env|config\.json|credentials)/gi,
  // SSN patterns
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // Home directory paths
  /(?:\/Users\/\w+|\/home\/\w+|C:\\Users\\\w+)/gi,
  // Internal URLs / localhost references
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/gi,
  // Budget / financial references with dollar amounts
  /(?:budget|monthly.*limit|cost.*limit|spending.*limit).*\$[\d.]+/gi,
];

/**
 * Build a sanitized execution context for a party wave.
 * Removes all owner-private keys and injects contact metadata.
 *
 * @param fullContext - The full wave execution context.
 * @param contact - The external contact triggering the party wave.
 * @returns A sanitized context safe for party wave execution.
 */
export function buildPartyWaveContext(
  fullContext: Record<string, unknown>,
  contact: Contact,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fullContext)) {
    if (BLOCKED_CONTEXT_KEYS.has(key)) {
      partyLogger.debug({ key, contactId: contact.id }, 'Stripped blocked context key for party wave');
      continue;
    }
    sanitized[key] = value;
  }

  // Inject contact metadata for the party wave to use
  sanitized['contactName'] = contact.name;
  sanitized['contactTrustLevel'] = contact.trustLevel;
  sanitized['isPartyWave'] = true;

  partyLogger.info(
    { contactId: contact.id, strippedKeys: countStrippedKeys(fullContext) },
    'Built sanitized party wave context',
  );

  return sanitized;
}

/**
 * Validate extracted parameters from LLM param extraction.
 * Ensures the LLM didn't leak owner data into the extracted params.
 * Returns a cleaned version of the params with any blocked values removed.
 *
 * @param params - The extracted parameters from LLM.
 * @param waveName - The wave name (for logging).
 * @returns Cleaned parameters with blocked values replaced.
 */
export function validateExtractedParams(
  params: Record<string, unknown>,
  waveName: string,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    // Block any param whose KEY matches a blocked context key
    if (BLOCKED_CONTEXT_KEYS.has(key)) {
      securityLogger.warn(
        { waveName, paramKey: key },
        'Blocked context key found in extracted params — stripping',
      );
      continue;
    }

    // Check string values for sensitive patterns
    if (typeof value === 'string') {
      let blocked = false;
      for (const pattern of BLOCKED_PARAM_VALUE_PATTERNS) {
        if (pattern.test(value)) {
          securityLogger.warn(
            { waveName, paramKey: key, pattern: pattern.source },
            'Sensitive pattern found in extracted param value — redacting',
          );
          cleaned[key] = '[redacted]';
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        cleaned[key] = value;
      }
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

/**
 * Sanitize party wave output to prevent owner data leakage.
 * Scans the output string for sensitive patterns and redacts them.
 *
 * @param output - The raw wave output string.
 * @param allowedPatterns - Patterns that are explicitly allowed (e.g., owner's public email).
 * @returns The sanitized output with sensitive data redacted.
 */
export function sanitizePartyWaveOutput(
  output: string,
  allowedPatterns: readonly string[] = [],
): string {
  let sanitized = output;
  const allowedSet = new Set(allowedPatterns.map((p) => p.toLowerCase()));

  for (const pattern of SENSITIVE_OUTPUT_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      if (allowedSet.has(match.toLowerCase())) {
        return match;
      }
      partyLogger.warn({ redactedPattern: pattern.source }, 'Redacted sensitive data from party wave output');
      return '[redacted]';
    });
  }

  return sanitized;
}

/**
 * Get the set of context keys that are blocked for party waves.
 * Useful for testing and validation.
 *
 * @returns A readonly set of blocked context key names.
 */
export function getBlockedContextKeys(): ReadonlySet<string> {
  return BLOCKED_CONTEXT_KEYS;
}

/**
 * Count how many keys from the full context were stripped.
 * @param fullContext - The original full context.
 * @returns Number of blocked keys found in the context.
 */
function countStrippedKeys(fullContext: Record<string, unknown>): number {
  let count = 0;
  for (const key of Object.keys(fullContext)) {
    if (BLOCKED_CONTEXT_KEYS.has(key)) {
      count++;
    }
  }
  return count;
}
