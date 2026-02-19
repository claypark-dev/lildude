/**
 * Prompt injection detection.
 * Scans inbound messages and external content for injection attempts.
 * See HLD Section 14.
 */

import type { SanitizationResult } from '../types/index.js';
import { securityLogger } from '../utils/logger.js';

type ThreatSeverity = 'low' | 'medium' | 'high';
type ContentSource = 'user' | 'external';

interface ThreatPattern {
  name: string;
  pattern: RegExp;
  severity: ThreatSeverity;
  description: string;
  /** If true, only flag when source is 'external' */
  externalOnly: boolean;
}

const THREAT_PATTERNS: ThreatPattern[] = [
  // 1. Instruction override attempts
  {
    name: 'instruction_override',
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
    severity: 'high',
    description: 'Attempts to override system instructions',
    externalOnly: false,
  },
  {
    name: 'instruction_override',
    pattern: /disregard\s+(all\s+)?(previous|prior|above|your)\s+(instructions|prompts|rules|guidelines)/i,
    severity: 'high',
    description: 'Attempts to disregard system instructions',
    externalOnly: false,
  },
  {
    name: 'instruction_override',
    pattern: /forget\s+(all\s+)?(previous|prior|above|your)\s+(instructions|prompts|rules)/i,
    severity: 'high',
    description: 'Attempts to make agent forget instructions',
    externalOnly: false,
  },

  // 2. Role impersonation
  {
    name: 'role_impersonation',
    pattern: /you\s+are\s+(now|actually)\s+/i,
    severity: 'high',
    description: 'External content tries to change agent role',
    externalOnly: true,
  },
  {
    name: 'role_impersonation',
    pattern: /\bact\s+as\s+(a\s+)?/i,
    severity: 'medium',
    description: 'External content tries to assign new role',
    externalOnly: true,
  },
  {
    name: 'role_impersonation',
    pattern: /you\s+must\s+(now\s+)?obey/i,
    severity: 'high',
    description: 'External content demands obedience',
    externalOnly: true,
  },

  // 3. Delimiter injection
  {
    name: 'delimiter_injection',
    pattern: /<\/?system>|<\/?user>|\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/i,
    severity: 'high',
    description: 'Attempts to inject role delimiters',
    externalOnly: false,
  },
  {
    name: 'delimiter_injection',
    pattern: /```system\b|```assistant\b/i,
    severity: 'medium',
    description: 'Attempts to inject role via code blocks',
    externalOnly: false,
  },

  // 4. Tool abuse (external content mentioning tool names)
  {
    name: 'tool_name_mention',
    pattern: /\b(execute_shell|write_file|http_request|schedule_task|read_file|list_directory|knowledge_store)\b/i,
    severity: 'medium',
    description: 'External content mentions tool names',
    externalOnly: true,
  },

  // 5. System prompt extraction
  {
    name: 'prompt_extraction',
    pattern: /\b(show|reveal|output|print|display|repeat)\s+(your\s+)?(system\s+)?(prompt|instructions|rules)/i,
    severity: 'medium',
    description: 'Attempts to extract system prompt',
    externalOnly: true,
  },
];

const BASE64_PATTERN = /(?:[A-Za-z0-9+/]{20,}={0,2})/;
const SUSPICIOUS_DECODED_WORDS = /ignore|execute|run|delete|send|override|bypass|admin|root|sudo/i;

/**
 * Check for prompt injection patterns in input text.
 * Runs on every inbound message and every piece of external content
 * before it enters the context.
 */
export function checkForInjection(input: string, source: ContentSource): SanitizationResult {
  const threats: SanitizationResult['threats'] = [];

  // Check against all threat patterns
  for (const threatPattern of THREAT_PATTERNS) {
    if (threatPattern.externalOnly && source !== 'external') {
      continue;
    }

    if (threatPattern.pattern.test(input)) {
      threats.push({
        type: threatPattern.name,
        description: threatPattern.description,
        severity: threatPattern.severity,
      });
    }
  }

  // Check for base64-encoded suspicious instructions (external only)
  if (source === 'external') {
    const base64Match = input.match(BASE64_PATTERN);
    if (base64Match) {
      try {
        const decoded = Buffer.from(base64Match[0], 'base64').toString('utf-8');
        if (SUSPICIOUS_DECODED_WORDS.test(decoded)) {
          threats.push({
            type: 'encoded_instruction',
            description: 'Base64-encoded suspicious instruction detected',
            severity: 'medium',
          });
        }
      } catch {
        // Not valid base64, ignore
      }
    }
  }

  const highThreats = threats.filter(t => t.severity === 'high');
  const isClean = highThreats.length === 0;

  if (!isClean) {
    securityLogger.warn(
      { source, threatCount: threats.length, threats: threats.map(t => t.type) },
      'Prompt injection detected',
    );
  }

  return {
    isClean,
    threats,
    sanitizedInput: input, // We flag, not modify
  };
}
