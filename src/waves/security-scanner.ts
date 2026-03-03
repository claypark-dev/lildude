/**
 * Security scanner for generated wave code — S2.N.4
 *
 * Performs AST-based static analysis on JavaScript/TypeScript source code
 * to detect dangerous patterns before user review. Uses string-based pattern
 * matching against parsed tokens (not full AST parsing to avoid heavy deps).
 *
 * Severity levels:
 *   critical — auto-fail, wave cannot be approved
 *   high     — requires manual review override
 *   medium   — warning, reviewer discretion
 *   low      — informational only
 */

import { createModuleLogger } from '../utils/logger.js';

const scannerLogger = createModuleLogger('security-scanner');

/** Severity levels for security findings. */
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

/** A single security finding from the scan. */
export interface SecurityFinding {
  /** Severity of the finding. */
  severity: FindingSeverity;
  /** Short identifier for the finding category. */
  category: string;
  /** Human-readable description of the issue. */
  message: string;
  /** The matched pattern or code snippet. */
  matchedText: string;
  /** Approximate line number (1-based) where the pattern was found. */
  line: number;
}

/** Result of a security scan. */
export interface ScanResult {
  /** Whether the scan passed (no critical findings). */
  passed: boolean;
  /** All findings ordered by severity (critical first). */
  findings: SecurityFinding[];
  /** Summary counts by severity. */
  summary: Record<FindingSeverity, number>;
}

/** A pattern rule used during scanning. */
interface ScanRule {
  /** Regex pattern to match against source code. */
  pattern: RegExp;
  /** Severity when matched. */
  severity: FindingSeverity;
  /** Category identifier. */
  category: string;
  /** Human-readable message. */
  message: string;
}

/**
 * Scan rules organized by category.
 * Each rule has a regex pattern, severity, and description.
 */
const SCAN_RULES: readonly ScanRule[] = [
  // === Critical: Dangerous globals ===
  {
    pattern: /\beval\s*\(/g,
    severity: 'critical',
    category: 'dangerous-global',
    message: 'eval() can execute arbitrary code',
  },
  {
    pattern: /\bnew\s+Function\s*\(/g,
    severity: 'critical',
    category: 'dangerous-global',
    message: 'new Function() can execute arbitrary code',
  },
  {
    pattern: /\bprocess\.exit\s*\(/g,
    severity: 'critical',
    category: 'dangerous-global',
    message: 'process.exit() can terminate the host process',
  },
  {
    pattern: /\bprocess\.env\b/g,
    severity: 'high',
    category: 'env-access',
    message: 'process.env access may leak secrets',
  },
  {
    pattern: /\bprocess\.kill\s*\(/g,
    severity: 'critical',
    category: 'dangerous-global',
    message: 'process.kill() can terminate processes',
  },

  // === Critical: Module system abuse ===
  {
    pattern: /\brequire\s*\(/g,
    severity: 'critical',
    category: 'module-abuse',
    message: 'require() can load arbitrary modules',
  },
  {
    pattern: /\bimport\s*\(/g,
    severity: 'critical',
    category: 'module-abuse',
    message: 'Dynamic import() can load arbitrary modules',
  },

  // === Critical: Child process ===
  {
    pattern: /\bchild_process\b/g,
    severity: 'critical',
    category: 'child-process',
    message: 'child_process module enables arbitrary command execution',
  },
  {
    pattern: /\bexecFile\s*\(/g,
    severity: 'critical',
    category: 'child-process',
    message: 'execFile() can execute arbitrary commands',
  },
  {
    pattern: /\bexecSync\s*\(/g,
    severity: 'critical',
    category: 'child-process',
    message: 'execSync() can execute arbitrary commands',
  },
  {
    pattern: /\bspawn\s*\(/g,
    severity: 'high',
    category: 'child-process',
    message: 'spawn() can execute arbitrary commands',
  },

  // === High: Filesystem abuse ===
  {
    pattern: /\bfs\.unlink\b/g,
    severity: 'high',
    category: 'fs-abuse',
    message: 'fs.unlink can delete files',
  },
  {
    pattern: /\bfs\.rmdir\b/g,
    severity: 'high',
    category: 'fs-abuse',
    message: 'fs.rmdir can delete directories',
  },
  {
    pattern: /\bfs\.rm\b/g,
    severity: 'high',
    category: 'fs-abuse',
    message: 'fs.rm can delete files and directories',
  },
  {
    pattern: /\bfs\.chmod\b/g,
    severity: 'high',
    category: 'fs-abuse',
    message: 'fs.chmod can change file permissions',
  },

  // === High: Network patterns not using fetch ===
  {
    pattern: /\brequire\s*\(\s*['"]https?['"]\s*\)/g,
    severity: 'high',
    category: 'network-abuse',
    message: 'Direct http/https module usage bypasses domain checks',
  },
  {
    pattern: /\bnet\.createServer\b/g,
    severity: 'critical',
    category: 'network-abuse',
    message: 'Creating a server from wave code is not allowed',
  },

  // === High: Prototype pollution ===
  {
    pattern: /__proto__/g,
    severity: 'high',
    category: 'prototype-pollution',
    message: '__proto__ access can lead to prototype pollution',
  },
  {
    pattern: /constructor\s*\.\s*prototype/g,
    severity: 'high',
    category: 'prototype-pollution',
    message: 'constructor.prototype access can lead to prototype pollution',
  },

  // === Medium: Potentially dangerous patterns ===
  {
    pattern: /\bsetTimeout\s*\(\s*['"`]/g,
    severity: 'medium',
    category: 'string-eval',
    message: 'setTimeout with string argument acts like eval()',
  },
  {
    pattern: /\bsetInterval\s*\(\s*['"`]/g,
    severity: 'medium',
    category: 'string-eval',
    message: 'setInterval with string argument acts like eval()',
  },
  {
    pattern: /\bvm\b/g,
    severity: 'high',
    category: 'module-abuse',
    message: 'vm module usage could escape sandbox',
  },

  // === Low: Informational ===
  {
    pattern: /\bconsole\.(warn|error)\s*\(/g,
    severity: 'low',
    category: 'logging',
    message: 'Non-standard console output (warn/error) — ensure intentional',
  },
];

/**
 * Find the line number (1-based) for a character offset in source code.
 * @param source - The full source code string.
 * @param offset - The character offset to find the line for.
 * @returns The 1-based line number.
 */
function getLineNumber(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

/**
 * Check for base64-encoded payloads that might hide dangerous code.
 * Decodes base64 strings and scans them for dangerous patterns.
 *
 * @param source - The source code to scan.
 * @returns Array of findings for encoded payloads.
 */
function scanEncodedPayloads(source: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const base64Pattern = /['"`]([A-Za-z0-9+/]{40,}={0,2})['"`]/g;
  let match: RegExpExecArray | null;

  while ((match = base64Pattern.exec(source)) !== null) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
      const dangerousPatterns = [
        /eval\s*\(/,
        /require\s*\(/,
        /import\s*\(/,
        /child_process/,
        /process\.exit/,
        /\bexec\s*\(/,
      ];

      for (const dangerousPattern of dangerousPatterns) {
        if (dangerousPattern.test(decoded)) {
          findings.push({
            severity: 'critical',
            category: 'encoded-payload',
            message: `Base64-encoded string decodes to dangerous pattern: ${dangerousPattern.source}`,
            matchedText: match[0].slice(0, 60),
            line: getLineNumber(source, match.index),
          });
          break;
        }
      }
    } catch {
      // Not valid base64, skip
    }
  }

  return findings;
}

/**
 * Check that fetch() calls only target domains declared in the manifest.
 *
 * @param source - The source code to scan.
 * @param allowedDomains - Domains declared in the wave manifest permissions.
 * @returns Array of findings for undeclared domain usage.
 */
function scanUndeclaredDomains(
  source: string,
  allowedDomains: string[],
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const fetchPattern = /\bfetch\s*\(\s*['"`](https?:\/\/[^'"`\s]+)['"`]/g;
  let match: RegExpExecArray | null;

  while ((match = fetchPattern.exec(source)) !== null) {
    try {
      const fetchUrl = new URL(match[1]);
      const hostname = fetchUrl.hostname;

      if (!allowedDomains.includes(hostname)) {
        findings.push({
          severity: 'high',
          category: 'undeclared-domain',
          message: `fetch() targets domain "${hostname}" not declared in manifest permissions`,
          matchedText: match[0].slice(0, 80),
          line: getLineNumber(source, match.index),
        });
      }
    } catch {
      // Malformed URL, flag it
      findings.push({
        severity: 'medium',
        category: 'malformed-url',
        message: 'fetch() call with unparseable URL',
        matchedText: match[0].slice(0, 80),
        line: getLineNumber(source, match.index),
      });
    }
  }

  return findings;
}

/** Sort order for severity levels. */
const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Scan source code for security issues.
 *
 * Runs all scan rules against the source code, checks for encoded payloads,
 * and verifies fetch() domains against the manifest. Returns a structured
 * result with findings sorted by severity.
 *
 * @param source - The JavaScript/TypeScript source code to scan.
 * @param allowedDomains - Domains declared in the wave manifest permissions.
 * @returns A ScanResult with pass/fail status, findings, and summary.
 */
export function scanWaveCode(
  source: string,
  allowedDomains: string[] = [],
): ScanResult {
  const findings: SecurityFinding[] = [];

  // Run all pattern-based rules
  for (const rule of SCAN_RULES) {
    // Reset regex state for each rule
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = rule.pattern.exec(source)) !== null) {
      findings.push({
        severity: rule.severity,
        category: rule.category,
        message: rule.message,
        matchedText: match[0],
        line: getLineNumber(source, match.index),
      });
    }
  }

  // Check for encoded payloads
  findings.push(...scanEncodedPayloads(source));

  // Check for undeclared domains
  findings.push(...scanUndeclaredDomains(source, allowedDomains));

  // Sort by severity
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  // Build summary
  const summary: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    summary[finding.severity]++;
  }

  const passed = summary.critical === 0;

  scannerLogger.info(
    { passed, critical: summary.critical, high: summary.high, medium: summary.medium, low: summary.low },
    'Security scan complete',
  );

  return { passed, findings, summary };
}
