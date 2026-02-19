/**
 * Security module — re-exports all security components.
 */

export { checkForInjection } from './injection.js';
export { wrapUntrustedContent, isContentTooLong, EXTERNAL_CONTENT_MAX_LENGTH } from './spotlighting.js';
export { parseCommand, hasCommandSubstitution, hasVariableExpansion } from './command-parser.js';
export {
  DANGEROUS_PATTERNS,
  BINARY_ALLOWLIST_DEFAULT,
  DIRECTORY_RULES,
  DOMAIN_RULES,
} from './defaults.js';
export type { DangerousPatternSeverity, DangerousPattern } from './defaults.js';
export { checkCommand, checkDomain, checkFilePath } from './permissions.js';
export type { SecurityLevel, PermissionsCheckOptions } from './permissions.js';
export { executeInSandbox, createSanitizedEnv } from './sandbox.js';
export type { SandboxOptions, SandboxResult } from './sandbox.js';
