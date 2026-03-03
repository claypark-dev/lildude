/**
 * Security Pipeline — wires all security layers into a coherent input/output chain.
 * Called by the agent loop to process messages through the full security stack:
 *   Input: injection detection → intent classification → abuse detection
 *   Output: output filtering → canary detection → response sanitization
 */

import type BetterSqlite3 from 'better-sqlite3';
import { checkForInjection } from './injection.js';
import { classifyIntent, shouldBlockInput, type ClassificationResult } from './intent-classifier.js';
import { filterOutput, type OutputFilterResult } from './output-filter.js';
import { generateCanary, buildCanaryInstruction, detectCanaryLeak, stripCanary } from './canary.js';
import { recordInjectionAttempt, isBlocked, autoBlockContact, type AbuseDetectorConfig } from './abuse-detector.js';
import { appendSecurityLog } from '../persistence/security-log.js';
import { createModuleLogger } from '../utils/logger.js';

const pipelineLogger = createModuleLogger('security-pipeline');

/** Result of the input security check. */
export interface InputSecurityResult {
  allowed: boolean;
  reason: string;
  classification: ClassificationResult;
  injectionDetected: boolean;
  contactBlocked: boolean;
}

/** Result of the output security check. */
export interface OutputSecurityResult {
  sanitizedOutput: string;
  filterResult: OutputFilterResult;
  canaryLeaked: boolean;
  leaksDetected: number;
}

/** Canary token context for a conversation turn. */
export interface CanaryContext {
  token: string;
  instruction: string;
}

/**
 * Run the full input security pipeline.
 * Checks injection patterns, classifies intent, tracks abuse.
 *
 * @param db - Database connection.
 * @param input - The user's message.
 * @param contactId - Optional contact ID for abuse tracking.
 * @param abuseConfig - Optional abuse detector configuration.
 * @returns Security check result.
 */
export function checkInputSecurity(
  db: BetterSqlite3.Database,
  input: string,
  contactId?: string,
  abuseConfig?: Partial<AbuseDetectorConfig>,
): InputSecurityResult {
  // Step 1: Check if contact is already blocked
  if (contactId && isBlocked(contactId)) {
    pipelineLogger.warn({ contactId }, 'Input from blocked contact');
    return {
      allowed: false,
      reason: 'Contact is blocked due to repeated injection attempts',
      classification: { intent: 'injection-attempt', confidence: 1.0, reason: 'Contact blocked' },
      injectionDetected: false,
      contactBlocked: true,
    };
  }

  // Step 2: Pattern-based injection check
  const injectionResult = checkForInjection(input, 'external');

  // Step 3: Intent classification (deterministic)
  const classification = classifyIntent(input);

  // Step 4: Determine if we should block
  const injectionDetected = !injectionResult.isClean;
  const shouldBlock = shouldBlockInput(classification);

  if (injectionDetected || shouldBlock) {
    // Record attempt for abuse detection
    if (contactId) {
      const nowBlocked = recordInjectionAttempt(
        contactId,
        input,
        classification.intent,
        abuseConfig,
      );

      if (nowBlocked) {
        autoBlockContact(db, contactId, 'Injection attempt threshold exceeded');
      }
    }

    appendSecurityLog(db, {
      actionType: 'injection_blocked',
      actionDetail: `Blocked: ${classification.reason}. Intent: ${classification.intent}`,
      allowed: false,
      securityLevel: 1,
      reason: classification.reason,
    });

    pipelineLogger.warn(
      {
        contactId,
        intent: classification.intent,
        confidence: classification.confidence,
        injectionDetected,
      },
      'Input blocked by security pipeline',
    );

    return {
      allowed: false,
      reason: classification.reason,
      classification,
      injectionDetected,
      contactBlocked: false,
    };
  }

  // Step 5: Log unclear classifications for monitoring
  if (classification.intent === 'unclear') {
    pipelineLogger.info(
      { contactId, intent: classification.intent },
      'Input classified as unclear — allowing with monitoring',
    );
  }

  return {
    allowed: true,
    reason: 'Input passed security checks',
    classification,
    injectionDetected: false,
    contactBlocked: false,
  };
}

/**
 * Generate a canary token context for a conversation turn.
 * Returns the token and the instruction to embed in the system prompt.
 *
 * @returns Canary context with token and instruction.
 */
export function createCanaryContext(): CanaryContext {
  const token = generateCanary();
  const instruction = buildCanaryInstruction(token);
  return { token, instruction };
}

/**
 * Run the full output security pipeline.
 * Filters sensitive data, checks for canary leaks, sanitizes the response.
 *
 * @param db - Database connection.
 * @param output - The LLM's response text.
 * @param canaryToken - Optional canary token to check for leakage.
 * @returns Sanitized output and security findings.
 */
export function checkOutputSecurity(
  db: BetterSqlite3.Database,
  output: string,
  canaryToken?: string,
): OutputSecurityResult {
  // Step 1: Filter output for sensitive data
  const filterResult = filterOutput(output);
  let sanitizedOutput = filterResult.filtered;

  // Step 2: Check for canary leak
  let canaryLeaked = false;
  if (canaryToken) {
    canaryLeaked = detectCanaryLeak(sanitizedOutput, canaryToken);
    if (canaryLeaked) {
      sanitizedOutput = stripCanary(sanitizedOutput, canaryToken);

      appendSecurityLog(db, {
        actionType: 'canary_leak',
        actionDetail: 'Canary token leaked in LLM response — possible context extraction',
        allowed: false,
        securityLevel: 1,
        reason: 'Context leakage detected',
      });

      pipelineLogger.error('Canary token leaked in LLM response');
    }
  }

  // Step 3: Log any output leaks
  if (filterResult.hasLeaks) {
    appendSecurityLog(db, {
      actionType: 'output_leak',
      actionDetail: `Output filter detected ${filterResult.leaks.length} leak(s): ${filterResult.leaks.map((l) => l.type).join(', ')}`,
      allowed: false,
      securityLevel: 1,
      reason: 'Sensitive data in LLM output',
    });

    pipelineLogger.warn(
      { leakCount: filterResult.leaks.length, types: filterResult.leaks.map((l) => l.type) },
      'Output filter detected sensitive data',
    );
  }

  return {
    sanitizedOutput,
    filterResult,
    canaryLeaked,
    leaksDetected: filterResult.leaks.length,
  };
}
