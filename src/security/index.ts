/**
 * Security module — re-exports all security components.
 */

export { checkForInjection } from './injection.js';
export { wrapUntrustedContent, isContentTooLong, EXTERNAL_CONTENT_MAX_LENGTH, generateNonce } from './spotlighting.js';
export { filterOutput } from './output-filter.js';
export type { OutputLeak, OutputFilterResult } from './output-filter.js';
export { generateCanary, buildCanaryInstruction, detectCanaryLeak, stripCanary } from './canary.js';
export { classifyIntent, shouldBlockInput } from './intent-classifier.js';
export type { IntentClass, ClassificationResult } from './intent-classifier.js';
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
