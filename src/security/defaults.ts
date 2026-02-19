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

  // ─── Windows-specific dangerous patterns ───

  // del /f /s /q on root or system directories
  {
    pattern: /\bdel\b.*\/[fF].*\/[sS].*(?:[A-Za-z]:\\$|[A-Za-z]:\\\s|\\\\)/,
    description: 'Recursive force delete on root or UNC path (del /f /s)',
    severity: 'always_block',
  },
  // rd /s /q (rmdir) on system-critical paths
  {
    pattern: /\b(?:rd|rmdir)\b.*\/[sS].*\/[qQ].*(?:[A-Za-z]:\\$|[A-Za-z]:\\\s|\\Windows|\\System32)/,
    description: 'Recursive directory removal on system path (rd /s /q)',
    severity: 'always_block',
  },
  // format command (Windows disk format)
  {
    pattern: /\bformat\b.*[A-Za-z]:/,
    description: 'Format disk drive (format)',
    severity: 'always_block',
  },
  // diskpart (dangerous disk operations)
  {
    pattern: /\bdiskpart\b/,
    description: 'Disk partition utility (diskpart)',
    severity: 'always_block',
  },
  // bcdedit (boot configuration)
  {
    pattern: /\bbcdedit\b/,
    description: 'Boot configuration editor (bcdedit)',
    severity: 'always_block',
  },
  // reg delete on HKLM (system registry)
  {
    pattern: /\breg\b.*\bdelete\b.*\bHKLM\b/i,
    description: 'Delete system registry keys (reg delete HKLM)',
    severity: 'always_block',
  },
  // icacls/cacls modifying system directory permissions
  {
    pattern: /\b(?:icacls|cacls)\b.*(?:\\Windows|\\System32)/i,
    description: 'Modify system directory permissions (icacls/cacls)',
    severity: 'always_block',
  },
  // takeown on system directories
  {
    pattern: /\btakeown\b.*(?:\\Windows|\\System32)/i,
    description: 'Take ownership of system files (takeown)',
    severity: 'always_block',
  },
  // Windows shutdown command
  {
    pattern: /\bshutdown\b.*\/[sStrR]/,
    description: 'Windows shutdown or restart command',
    severity: 'always_block',
  },
  // sfc /scannow and system file checker
  {
    pattern: /\bsfc\b.*\/scannow/i,
    description: 'System file checker (sfc /scannow)',
    severity: 'needs_approval',
  },
  // PowerShell Remove-Item -Recurse -Force on system paths
  {
    pattern: /\bRemove-Item\b.*-Recurse.*(?:[A-Za-z]:\\$|\\Windows|\\System32)/i,
    description: 'PowerShell recursive delete on system path (Remove-Item -Recurse)',
    severity: 'always_block',
  },
  // PowerShell Set-ExecutionPolicy
  {
    pattern: /\bSet-ExecutionPolicy\b/i,
    description: 'Change PowerShell execution policy',
    severity: 'needs_approval',
  },
  // PowerShell Invoke-Expression / iex (remote code execution risk)
  {
    pattern: /\b(?:Invoke-Expression|iex)\b/i,
    description: 'PowerShell Invoke-Expression (potential remote code execution)',
    severity: 'always_block',
  },
  // PowerShell Invoke-WebRequest piped to Invoke-Expression
  {
    pattern: /\b(?:Invoke-WebRequest|iwr|curl)\b.*\|\s*(?:Invoke-Expression|iex)\b/i,
    description: 'Remote code execution via web request piped to Invoke-Expression',
    severity: 'always_block',
  },
  // runas (Windows privilege escalation)
  {
    pattern: /\brunas\b/,
    description: 'Elevated privilege command (runas)',
    severity: 'needs_approval',
  },
  // Windows device paths (\\.\PhysicalDrive, \\.\C:)
  {
    pattern: /\\\\\.\\(?:PhysicalDrive|[A-Za-z]:)/,
    description: 'Direct access to Windows device path',
    severity: 'always_block',
  },
  // net user / net localgroup (account manipulation)
  {
    pattern: /\bnet\b\s+(?:user|localgroup)\b/i,
    description: 'Windows account or group manipulation (net user/localgroup)',
    severity: 'needs_approval',
  },
  // Windows package managers
  {
    pattern: /\b(?:choco|winget|scoop)\s+(?:install|uninstall|remove)\b/i,
    description: 'Windows package manager install or uninstall operation',
    severity: 'needs_approval',
  },
] as const;

/**
 * Default binary allowlist.
 * Only these binaries can be executed without special approval.
 */
export const BINARY_ALLOWLIST_DEFAULT: readonly string[] = [
  // ─── Unix/macOS ───
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

  // ─── Windows equivalents & common binaries ───
  'dir',
  'type',            // Windows equivalent of cat
  'findstr',         // Windows equivalent of grep
  'where',           // Windows equivalent of which
  'whoami.exe',
  'more',
  'sort.exe',
  'cmd.exe',
  'cmd',
  'powershell.exe',
  'powershell',
  'pwsh.exe',
  'pwsh',
  'node.exe',
  'npx.cmd',
  'git.exe',
  'curl.exe',
  'python.exe',
  'python3.exe',
  'wmic',
  'systeminfo',
  'hostname',
  'set',
  'ver',
  'tree',
  'attrib',
  'robocopy',
  'xcopy',
] as const;

/**
 * Directory access rules.
 * ALWAYS_BLOCKED cannot be overridden by user configuration.
 * DEFAULT_ALLOWED can be extended by the user.
 */
export const DIRECTORY_RULES = {
  /** Directories that are NEVER writable, regardless of user config */
  ALWAYS_BLOCKED: [
    // ─── Unix/macOS ───
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

    // ─── Windows ───
    /^[A-Za-z]:\\$/,                        // Drive root (C:\)
    /^[A-Za-z]:\\Windows\b/i,               // Windows directory
    /^[A-Za-z]:\\Program Files\b/i,         // Program Files
    /^[A-Za-z]:\\Program Files \(x86\)\b/i, // Program Files (x86)
    /^[A-Za-z]:\\ProgramData\b/i,           // ProgramData
    /^[A-Za-z]:\\Recovery\b/i,              // Recovery partition
    /^[A-Za-z]:\\System Volume Information\b/i,
  ] as readonly RegExp[],

  /** Directories allowed by default (user can modify) */
  DEFAULT_ALLOWED: [
    // ─── Unix/macOS ───
    /^~\/\.lil-dude\b/,
    /^~\/Documents\b/,
    /^~\/Desktop\b/,
    /^~\/Downloads\b/,

    // ─── Windows (USERPROFILE-relative) ───
    /^[A-Za-z]:\\Users\\[^\\]+\\\.lil-dude\b/i,
    /^[A-Za-z]:\\Users\\[^\\]+\\Documents\b/i,
    /^[A-Za-z]:\\Users\\[^\\]+\\Desktop\b/i,
    /^[A-Za-z]:\\Users\\[^\\]+\\Downloads\b/i,
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
