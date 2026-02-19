/**
 * Security Defaults — S0.D.1
 *
 * Defines the default dangerous patterns, binary allowlists,
 * directory rules, and domain rules for the security sandbox.
 *
 * These are the baseline security policies. Users can customize
 * via config but can NEVER weaken ALWAYS_BLOCKED rules.
 */

/** Severity level for a dangerous pattern match */
export type DangerousPatternSeverity = 'always_block' | 'needs_approval';

/** A dangerous shell command pattern with description and severity */
export interface DangerousPattern {
  pattern: RegExp;
  description: string;
  severity: DangerousPatternSeverity;
}

/**
 * Dangerous command patterns that are always blocked or require approval.
 * Patterns are checked against the raw command string AND parsed structure.
 *
 * Severity levels:
 * - always_block: NEVER allowed, even with user approval
 * - needs_approval: Requires explicit user confirmation before execution
 */
export const DANGEROUS_PATTERNS: readonly DangerousPattern[] = [
  // rm -rf / or rm -rf ~ (catastrophic deletion)
  {
    pattern: /\brm\b.*\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(?:\/\s*$|\/\s|~\s*$|~\s)/,
    description: 'Recursive force delete on root or home directory',
    severity: 'always_block',
  },
  {
    pattern: /\brm\b.*\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+(?:\/\s*$|\/\s|~\s*$|~\s)/,
    description: 'Recursive force delete on root or home directory (reversed flags)',
    severity: 'always_block',
  },
  // rm with -rf flags (general, not specifically / or ~)
  {
    pattern: /\brm\b.*\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*/,
    description: 'Recursive force delete (rm -rf)',
    severity: 'needs_approval',
  },
  {
    pattern: /\brm\b.*\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*/,
    description: 'Recursive force delete (rm -fr)',
    severity: 'needs_approval',
  },
  // mkfs — format filesystem
  {
    pattern: /\bmkfs\b/,
    description: 'Format filesystem (mkfs)',
    severity: 'always_block',
  },
  // dd writing to /dev/
  {
    pattern: /\bdd\b.*\bof=\/dev\//,
    description: 'Direct disk write (dd of=/dev/)',
    severity: 'always_block',
  },
  // shutdown / reboot / halt / poweroff / init 0 / init 6
  {
    pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/,
    description: 'System shutdown or reboot command',
    severity: 'always_block',
  },
  {
    pattern: /\binit\s+[06]\b/,
    description: 'System shutdown via init (init 0 or init 6)',
    severity: 'always_block',
  },
  // chmod -R 777 /
  {
    pattern: /\bchmod\b.*-R\s+777\s+\//,
    description: 'Recursive chmod 777 on root filesystem',
    severity: 'always_block',
  },
  // Fork bomb pattern :(){ :|:& };:
  {
    pattern: /:\(\)\s*\{.*\|.*&\s*\}\s*;?\s*:/,
    description: 'Fork bomb pattern',
    severity: 'always_block',
  },
  // Redirect to /dev/sd*
  {
    pattern: />\s*\/dev\/sd[a-z]/,
    description: 'Redirect output to raw disk device',
    severity: 'always_block',
  },
  // curl/wget piped to sh/bash/zsh/python
  {
    pattern: /\b(?:curl|wget)\b.*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python|python3)\b/,
    description: 'Remote code execution via curl/wget piped to shell',
    severity: 'always_block',
  },
  // sudo (needs approval, not always blocked)
  {
    pattern: /\bsudo\b/,
    description: 'Elevated privilege command (sudo)',
    severity: 'needs_approval',
  },
  // su (needs approval)
  {
    pattern: /\bsu\b(?:\s|$)/,
    description: 'Switch user command (su)',
    severity: 'needs_approval',
  },
  // Package managers install/uninstall
  {
    pattern: /\b(?:apt|apt-get|yum|dnf|pacman|brew|npm|pip|pip3|gem|cargo)\s+(?:install|uninstall|remove|purge|erase)\b/,
    description: 'Package manager install or uninstall operation',
    severity: 'needs_approval',
  },
] as const;

/**
 * Default binary allowlist.
 * Only these binaries can be executed without special approval.
 */
export const BINARY_ALLOWLIST_DEFAULT: readonly string[] = [
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'echo',
  'date',
  'pwd',
  'whoami',
  'which',
  'env',
  'mkdir',
  'cp',
  'mv',
  'touch',
  'stat',
  'file',
  'node',
  'npx',
  'tsx',
  'python3',
  'git',
  'curl',
  'jq',
  'sed',
  'awk',
  'sort',
  'uniq',
  'tr',
  'cut',
  'tee',
  'xargs',
  'basename',
  'dirname',
  'realpath',
] as const;

/**
 * Directory access rules.
 * ALWAYS_BLOCKED cannot be overridden by user configuration.
 * DEFAULT_ALLOWED can be extended by the user.
 */
export const DIRECTORY_RULES = {
  /** Directories that are NEVER writable, regardless of user config */
  ALWAYS_BLOCKED: [
    /^\/$/,
    /^\/etc\b/,
    /^\/usr\b/,
    /^\/bin\b/,
    /^\/sbin\b/,
    /^\/System\b/,
    /^\/Library\b/,
    /^\/var\b/,
    /^\/boot\b/,
    /^\/root\b/,
    /^\/proc\b/,
    /^\/sys\b/,
  ] as readonly RegExp[],

  /** Directories allowed by default (user can modify) */
  DEFAULT_ALLOWED: [
    /^~\/\.lil-dude\b/,
    /^~\/Documents\b/,
    /^~\/Desktop\b/,
    /^~\/Downloads\b/,
  ] as readonly RegExp[],
} as const;

/**
 * Outbound network domain rules.
 * ALWAYS_BLOCKED_OUTBOUND prevents connections to local/private network addresses.
 * DEFAULT_ALLOWED_OUTBOUND lists approved external API domains.
 */
export const DOMAIN_RULES = {
  /** Domains/IPs that are NEVER allowed for outbound connections */
  ALWAYS_BLOCKED_OUTBOUND: [
    /^localhost$/,
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^0\.0\.0\.0$/,
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
    /^192\.168\.\d{1,3}\.\d{1,3}$/,
    /^169\.254\.\d{1,3}\.\d{1,3}$/,
    /\.internal$/,
    /^\[::1\]$/,
    /^\[fd[0-9a-fA-F]{0,2}:/,
    /^\[fe80:/,
  ] as readonly RegExp[],

  /** Outbound domains allowed by default (user can extend) */
  DEFAULT_ALLOWED_OUTBOUND: [
    'api.anthropic.com',
    'api.openai.com',
    'api.github.com',
    'registry.npmjs.org',
    'pypi.org',
    'raw.githubusercontent.com',
  ] as readonly string[],
} as const;
