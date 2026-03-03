/**
 * Dual-LLM intent classifier stub.
 * Uses a cheap model to classify user intent before the main LLM processes it.
 * Classification categories: benign-conversation, tool-request, injection-attempt, unclear.
 * Capped at $0.001/classification to keep costs negligible.
 *
 * Currently a deterministic stub that uses pattern matching.
 * Future: will call a small model (e.g. haiku) for ambiguous cases.
 */

import { securityLogger } from '../utils/logger.js';

/** Classification result from the intent classifier. */
export type IntentClass =
  | 'benign-conversation'
  | 'tool-request'
  | 'injection-attempt'
  | 'unclear';

/** Result of intent classification. */
export interface ClassificationResult {
  /** The classified intent. */
  intent: IntentClass;
  /** Confidence level (0-1). */
  confidence: number;
  /** Reasoning for the classification. */
  reason: string;
}

/** Patterns that strongly indicate benign conversation. */
const BENIGN_PATTERNS = [
  /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|how\s+are\s+you)/i,
  /^(?:what|when|where|who|why|how)\s+/i,
  /^(?:tell\s+me|can\s+you|do\s+you|is\s+there)/i,
];

/** Patterns that indicate tool/action requests. */
const TOOL_REQUEST_PATTERNS = [
  /\b(?:check|read|send|schedule|create|delete|update|install|uninstall|set|add|remove)\b.*\b(?:email|calendar|reminder|file|task|wave|meeting)/i,
  /\b(?:what'?s?\s+(?:on\s+my|in\s+my))\s+(?:calendar|email|schedule)/i,
  /\b(?:search|find|look\s+up|fetch|get)\s+/i,
];

/** Patterns that strongly indicate injection attempts. */
const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/i,
  /you\s+are\s+(?:now|actually)\s+/i,
  /\bsystem\s*:\s*/i,
  /\[INST\]|\[\/INST\]/i,
  /<\|im_start\|>/i,
  /\bact\s+as\s+(?:a\s+)?(?:different|new|unrestricted)/i,
  /\bpretend\s+(?:you\s+are|to\s+be)\b/i,
  /\bjailbreak\b/i,
  /\bDAN\s+mode\b/i,
  /\b(?:developer|debug|maintenance|god)\s+mode\b/i,
];

/**
 * Classify user intent using deterministic pattern matching.
 * This is the fast, cost-free first pass. For ambiguous inputs,
 * returns 'unclear' which can optionally trigger a cheap LLM call.
 *
 * @param input - The user message to classify.
 * @returns The classification result with intent, confidence, and reason.
 */
export function classifyIntent(input: string): ClassificationResult {
  // Check injection patterns first (highest priority)
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      securityLogger.warn(
        { input: input.substring(0, 100) },
        'Intent classified as injection attempt',
      );
      return {
        intent: 'injection-attempt',
        confidence: 0.9,
        reason: 'Input matches known injection pattern',
      };
    }
  }

  // Check tool request patterns
  for (const pattern of TOOL_REQUEST_PATTERNS) {
    if (pattern.test(input)) {
      return {
        intent: 'tool-request',
        confidence: 0.8,
        reason: 'Input requests an action or tool use',
      };
    }
  }

  // Check benign conversation patterns
  for (const pattern of BENIGN_PATTERNS) {
    if (pattern.test(input)) {
      return {
        intent: 'benign-conversation',
        confidence: 0.85,
        reason: 'Input matches conversational pattern',
      };
    }
  }

  // Default: unclear — would benefit from LLM classification
  return {
    intent: 'unclear',
    confidence: 0.5,
    reason: 'Input does not match known patterns; may need LLM classification',
  };
}

/**
 * Check if intent classification indicates the input should be blocked.
 *
 * @param result - The classification result.
 * @returns True if the input should be blocked or flagged.
 */
export function shouldBlockInput(result: ClassificationResult): boolean {
  return result.intent === 'injection-attempt' && result.confidence >= 0.8;
}
