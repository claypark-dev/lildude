/**
 * Prompt injection detection.
 * Scans inbound messages and external content for injection attempts.
 * Covers: instruction overrides, role impersonation, delimiter injection,
 * tool abuse, prompt extraction, Unicode homoglyphs, invisible characters,
 * markdown/HTML injection, multi-turn jailbreaks, indirect injection.
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
  // ── 1. Instruction override attempts ───────────────────────────────
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
  {
    name: 'instruction_override',
    pattern: /new\s+instructions?\s*:/i,
    severity: 'high',
    description: 'Attempts to inject new instructions',
    externalOnly: false,
  },

  // ── 2. Role impersonation ──────────────────────────────────────────
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
  {
    name: 'role_impersonation',
    pattern: /pretend\s+(you\s+are|to\s+be)\s+/i,
    severity: 'high',
    description: 'Attempts to make agent pretend to be something else',
    externalOnly: true,
  },

  // ── 3. Delimiter injection ─────────────────────────────────────────
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

  // ── 4. Tool abuse ──────────────────────────────────────────────────
  {
    name: 'tool_name_mention',
    pattern: /\b(execute_shell|write_file|http_request|schedule_task|read_file|list_directory|knowledge_store)\b/i,
    severity: 'medium',
    description: 'External content mentions tool names',
    externalOnly: true,
  },

  // ── 5. System prompt extraction ────────────────────────────────────
  {
    name: 'prompt_extraction',
    pattern: /\b(show|reveal|output|print|display|repeat)\s+(your\s+)?(system\s+)?(prompt|instructions|rules)/i,
    severity: 'medium',
    description: 'Attempts to extract system prompt',
    externalOnly: true,
  },

  // ── 6. Unicode homoglyph attacks ───────────────────────────────────
  {
    name: 'unicode_homoglyph',
    pattern: /[\u0400-\u04FF]{3,}/,
    severity: 'low',
    description: 'Cyrillic characters that may be homoglyph substitutes',
    externalOnly: true,
  },
  {
    name: 'unicode_confusable',
    pattern: /[\uFF01-\uFF5E]{3,}/,
    severity: 'medium',
    description: 'Fullwidth characters used to evade filters',
    externalOnly: true,
  },

  // ── 7. Invisible characters ────────────────────────────────────────
  {
    name: 'invisible_chars',
    pattern: /[\u200B\u200C\u200D\u00AD\uFEFF]{2,}/,
    severity: 'medium',
    description: 'Multiple invisible Unicode characters detected',
    externalOnly: false,
  },
  {
    name: 'rtl_override',
    pattern: /[\u202E\u202D\u2066\u2067\u2068\u2069]/,
    severity: 'high',
    description: 'Bidirectional text override character detected',
    externalOnly: false,
  },

  // ── 8. HTML/Markdown injection ─────────────────────────────────────
  {
    name: 'html_injection',
    pattern: /<script\b|<iframe\b|<object\b|<embed\b|<form\b.*action\s*=/i,
    severity: 'high',
    description: 'HTML injection attempt (script/iframe/form)',
    externalOnly: true,
  },
  {
    name: 'markdown_injection',
    pattern: /!\[.*?\]\(javascript:/i,
    severity: 'high',
    description: 'Markdown image with javascript: URL',
    externalOnly: true,
  },

  // ── 9. Multi-turn jailbreak ────────────────────────────────────────
  {
    name: 'jailbreak_attempt',
    pattern: /\b(DAN|Do\s+Anything\s+Now)\s*(mode|prompt)?\b/i,
    severity: 'high',
    description: 'Known jailbreak attempt (DAN)',
    externalOnly: false,
  },
  {
    name: 'jailbreak_attempt',
    pattern: /\bjailbreak(ed)?\b/i,
    severity: 'medium',
    description: 'Jailbreak keyword detected',
    externalOnly: false,
  },
  {
    name: 'jailbreak_attempt',
    pattern: /\b(developer|debug|maintenance|god)\s+mode\b/i,
    severity: 'high',
    description: 'Attempts to activate special mode',
    externalOnly: false,
  },

  // ── 10. Indirect injection via tool results ────────────────────────
  {
    name: 'indirect_injection',
    pattern: /\b(IMPORTANT|URGENT|CRITICAL)\s*:\s*(?:ignore|disregard|forget|override)/i,
    severity: 'high',
    description: 'Indirect injection via urgency prefix',
    externalOnly: true,
  },
  {
    name: 'indirect_injection',
    pattern: /\bnote\s+(?:from|to)\s+(?:the\s+)?(?:admin|developer|system|operator)\s*:/i,
    severity: 'high',
    description: 'Fake admin/system note injection',
    externalOnly: true,
  },
  {
    name: 'indirect_injection',
    pattern: /\b(?:admin|system|root)\s+(?:override|command|instruction)\s*:/i,
    severity: 'high',
    description: 'Fake administrative override',
    externalOnly: true,
  },
];

const BASE64_PATTERN = /(?:[A-Za-z0-9+/]{20,}={0,2})/;
const SUSPICIOUS_DECODED_WORDS = /ignore|execute|run|delete|send|override|bypass|admin|root|sudo/i;

/**
 * Check for prompt injection patterns in input text.
 * Runs on every inbound message and every piece of external content
 * before it enters the context.
 *
 * @param input - The text to scan for injection patterns.
 * @param source - Whether the input comes from the 'user' or 'external' source.
 * @returns A SanitizationResult with threat details.
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
