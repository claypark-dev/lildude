/**
 * Permissions Engine — S0.D.2
 *
 * Checks parsed commands against security rules to produce a SecurityCheckResult.
 * Implements the 5-level security preset system from HLD Section 5.4.
 *
 * Security check flow:
 * 1. Parse the raw command string into ParsedCommand[]
 * 2. Check each command against DANGEROUS_PATTERNS → always_block or needs_approval
 * 3. Check binary against allowlist/blocklist based on security level
 * 4. Check directory access for file path arguments
 * 5. Check domain for URL arguments
 * 6. Return SecurityCheckResult with decision and reasoning
 */

import type { ParsedCommand, SecurityCheckResult, SecurityDecision, RiskLevel } from '../types/index.js';
import type { DangerousPattern } from './defaults.js';
import {
  DANGEROUS_PATTERNS,
  BINARY_ALLOWLIST_DEFAULT,
  DIRECTORY_RULES,
  DOMAIN_RULES,
} from './defaults.js';
import { parseCommand, hasCommandSubstitution, hasVariableExpansion } from './command-parser.js';
import { securityLogger } from '../utils/logger.js';

/** Security level presets (1-5) */
export type SecurityLevel = 1 | 2 | 3 | 4 | 5;

/** Options for the permissions check */
export interface PermissionsCheckOptions {
  securityLevel: SecurityLevel;
  shellAllowlistOverride?: string[];
  shellBlocklistOverride?: string[];
  dirAllowlistOverride?: string[];
  dirBlocklistOverride?: string[];
  domainAllowlistOverride?: string[];
  domainBlocklistOverride?: string[];
}

/**
 * Check a raw shell command against all security rules.
 * Returns a SecurityCheckResult with decision, reason, and risk level.
 */
export function checkCommand(rawCommand: string, options: PermissionsCheckOptions): SecurityCheckResult {
  const { securityLevel } = options;

  // Level 1: All shell commands blocked
  if (securityLevel === 1) {
    securityLogger.info({ rawCommand, level: securityLevel }, 'Shell blocked at level 1');
    return { decision: 'deny', reason: 'All shell commands blocked at security level 1', riskLevel: 'critical' };
  }

  // Check for command substitution and variable expansion (always suspicious)
  if (hasCommandSubstitution(rawCommand)) {
    return { decision: 'deny', reason: 'Command substitution detected ($() or backticks)', riskLevel: 'high' };
  }
  if (hasVariableExpansion(rawCommand)) {
    return { decision: 'needs_approval', reason: 'Variable expansion detected ($VAR or ${VAR})', riskLevel: 'medium' };
  }

  // Parse the command
  let parsedCommands: ParsedCommand[];
  try {
    parsedCommands = parseCommand(rawCommand);
  } catch (parseError: unknown) {
    const message = parseError instanceof Error ? parseError.message : 'Unknown parse error';
    return { decision: 'deny', reason: `Command parse failed: ${message}`, riskLevel: 'high' };
  }

  if (parsedCommands.length === 0) {
    return { decision: 'deny', reason: 'Empty command', riskLevel: 'low' };
  }

  // Check every command in the chain (including piped commands)
  const allCommands = flattenCommands(parsedCommands);

  // Phase 1: Check dangerous patterns against raw command
  const patternResult = checkDangerousPatterns(rawCommand, allCommands);
  if (patternResult) {
    return patternResult;
  }

  // Phase 2: Check binary allowlist/blocklist per security level
  const binaryResult = checkBinaries(allCommands, options);
  if (binaryResult) {
    return binaryResult;
  }

  // Phase 3: Check directory access for file arguments
  const dirResult = checkDirectoryAccess(allCommands, options);
  if (dirResult) {
    return dirResult;
  }

  // Phase 4: Check for sudo
  const hasSudo = allCommands.some(cmd => cmd.hasSudo);
  if (hasSudo) {
    return { decision: 'needs_approval', reason: 'Command uses sudo (elevated privileges)', riskLevel: 'high' };
  }

  // Phase 5: Check redirects at lower security levels
  const hasRedirects = allCommands.some(cmd => cmd.hasRedirects);
  if (hasRedirects && securityLevel <= 2) {
    return { decision: 'needs_approval', reason: 'Command uses file redirects', riskLevel: 'medium' };
  }

  return { decision: 'allow', reason: 'Command passed all security checks', riskLevel: 'low' };
}

/**
 * Check a domain against outbound network rules.
 * Returns a SecurityCheckResult.
 */
export function checkDomain(domain: string, options: PermissionsCheckOptions): SecurityCheckResult {
  const { securityLevel } = options;

  // Level 1: All network blocked
  if (securityLevel === 1) {
    return { decision: 'deny', reason: 'All outbound network blocked at security level 1', riskLevel: 'critical' };
  }

  // Always-blocked domains (private/internal IPs)
  for (const blockedPattern of DOMAIN_RULES.ALWAYS_BLOCKED_OUTBOUND) {
    if (blockedPattern.test(domain)) {
      return { decision: 'deny', reason: `Domain '${domain}' matches always-blocked pattern (private/internal network)`, riskLevel: 'critical' };
    }
  }

  // User blocklist override
  const userBlocklist = options.domainBlocklistOverride ?? [];
  if (userBlocklist.includes(domain)) {
    return { decision: 'deny', reason: `Domain '${domain}' is in user blocklist`, riskLevel: 'high' };
  }

  // Default allowed domains
  const defaultAllowed = DOMAIN_RULES.DEFAULT_ALLOWED_OUTBOUND as readonly string[];
  const userAllowlist = options.domainAllowlistOverride ?? [];
  const isAllowed = defaultAllowed.includes(domain) || userAllowlist.includes(domain);

  // Level 2-3: Must be in allowlist
  if (securityLevel <= 3) {
    if (isAllowed) {
      return { decision: 'allow', reason: `Domain '${domain}' is in allowlist`, riskLevel: 'low' };
    }
    return { decision: 'needs_approval', reason: `Domain '${domain}' is not in allowlist`, riskLevel: 'medium' };
  }

  // Level 4-5: Allow unless explicitly blocked
  return { decision: 'allow', reason: `Domain '${domain}' allowed at security level ${securityLevel}`, riskLevel: 'low' };
}

/**
 * Check a file path against directory access rules.
 * Returns a SecurityCheckResult or null if path is allowed.
 */
export function checkFilePath(filePath: string, options: PermissionsCheckOptions): SecurityCheckResult {
  const { securityLevel } = options;

  // Always-blocked directories
  for (const blockedPattern of DIRECTORY_RULES.ALWAYS_BLOCKED) {
    if (blockedPattern.test(filePath)) {
      return { decision: 'deny', reason: `Path '${filePath}' is in always-blocked directory`, riskLevel: 'critical' };
    }
  }

  // Level 5: Allow everything not always-blocked
  if (securityLevel === 5) {
    return { decision: 'allow', reason: `Path '${filePath}' allowed at security level 5`, riskLevel: 'low' };
  }

  // Check default allowed + user overrides
  const userAllowDirs = options.dirAllowlistOverride ?? [];
  const userBlockDirs = options.dirBlocklistOverride ?? [];

  // User blocklist takes priority
  for (const blocked of userBlockDirs) {
    if (filePath.startsWith(blocked)) {
      return { decision: 'deny', reason: `Path '${filePath}' is in user-blocked directories`, riskLevel: 'high' };
    }
  }

  // Check default + user allowed
  const isDefaultAllowed = DIRECTORY_RULES.DEFAULT_ALLOWED.some(p => p.test(filePath));
  const isUserAllowed = userAllowDirs.some(allowed => filePath.startsWith(allowed));

  if (isDefaultAllowed || isUserAllowed) {
    return { decision: 'allow', reason: `Path '${filePath}' is in allowed directories`, riskLevel: 'low' };
  }

  // Level 4: Allow paths not blocked
  if (securityLevel === 4) {
    return { decision: 'allow', reason: `Path '${filePath}' allowed at security level 4`, riskLevel: 'low' };
  }

  // Level 2-3: Need approval for unknown paths
  return { decision: 'needs_approval', reason: `Path '${filePath}' requires approval`, riskLevel: 'medium' };
}

/** Flatten parsed commands including piped sub-commands into a flat list */
function flattenCommands(commands: ParsedCommand[]): ParsedCommand[] {
  const flat: ParsedCommand[] = [];
  for (const cmd of commands) {
    flat.push(cmd);
    if (cmd.pipes.length > 0) {
      flat.push(...flattenCommands(cmd.pipes));
    }
  }
  return flat;
}

/** Check raw command and parsed commands against dangerous patterns */
function checkDangerousPatterns(
  rawCommand: string,
  allCommands: ParsedCommand[],
): SecurityCheckResult | null {
  for (const dangerousPattern of DANGEROUS_PATTERNS) {
    // Check against raw command string
    if (dangerousPattern.pattern.test(rawCommand)) {
      return patternToResult(dangerousPattern, rawCommand);
    }
    // Check against each parsed command's rawCommand fragment
    for (const cmd of allCommands) {
      if (dangerousPattern.pattern.test(cmd.rawCommand)) {
        return patternToResult(dangerousPattern, cmd.rawCommand);
      }
    }
  }
  return null;
}

/** Convert a DangerousPattern match to a SecurityCheckResult */
function patternToResult(matched: DangerousPattern, command: string): SecurityCheckResult {
  const riskLevel: RiskLevel = matched.severity === 'always_block' ? 'critical' : 'high';
  const decision: SecurityDecision = matched.severity === 'always_block' ? 'deny' : 'needs_approval';

  securityLogger.warn({ command, pattern: matched.description, severity: matched.severity }, 'Dangerous pattern matched');

  return {
    decision,
    reason: `${matched.description} (pattern: ${matched.severity})`,
    riskLevel,
  };
}

/** Check binary names against allowlist/blocklist based on security level */
function checkBinaries(
  allCommands: ParsedCommand[],
  options: PermissionsCheckOptions,
): SecurityCheckResult | null {
  const { securityLevel } = options;
  const userAllowlist = options.shellAllowlistOverride ?? [];
  const userBlocklist = options.shellBlocklistOverride ?? [];

  const allowlist = new Set([...BINARY_ALLOWLIST_DEFAULT, ...userAllowlist]);

  // Remove user-blocklisted binaries from allowlist
  for (const blocked of userBlocklist) {
    allowlist.delete(blocked);
  }

  for (const cmd of allCommands) {
    const binary = cmd.binary;

    // User blocklist always applies
    if (userBlocklist.includes(binary)) {
      return { decision: 'deny', reason: `Binary '${binary}' is in user blocklist`, riskLevel: 'high' };
    }

    const isInAllowlist = allowlist.has(binary);

    switch (securityLevel) {
      case 2:
        // Allowlist only — unlisted binaries denied
        if (!isInAllowlist) {
          return { decision: 'deny', reason: `Binary '${binary}' not in allowlist (level 2)`, riskLevel: 'high' };
        }
        break;

      case 3:
        // Allowlisted → allow, others → needs_approval
        if (!isInAllowlist) {
          return { decision: 'needs_approval', reason: `Binary '${binary}' not in allowlist (level 3)`, riskLevel: 'medium' };
        }
        break;

      case 4:
        // All except blocklist
        break;

      case 5:
        // All except ALWAYS_BLOCK (already handled by dangerous patterns)
        break;
    }
  }

  return null;
}

/** Check directory access for file-path arguments in commands */
function checkDirectoryAccess(
  allCommands: ParsedCommand[],
  options: PermissionsCheckOptions,
): SecurityCheckResult | null {
  for (const cmd of allCommands) {
    for (const arg of cmd.args) {
      // Only check args that look like file paths
      if (arg.startsWith('/') || arg.startsWith('~') || arg.startsWith('./') || arg.startsWith('../')) {
        const pathResult = checkFilePath(arg, options);
        if (pathResult.decision !== 'allow') {
          return pathResult;
        }
      }
    }
  }
  return null;
}
