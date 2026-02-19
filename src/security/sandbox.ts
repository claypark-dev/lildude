/**
 * Process Sandbox — S0.D.2
 *
 * Executes shell commands in a restricted child process environment.
 * Strips sensitive environment variables, enforces timeouts, and
 * limits output size.
 *
 * See HLD Section 11 (Process Sandbox).
 */

import os from 'node:os';
import { execFile, type ExecFileException } from 'node:child_process';
import { securityLogger } from '../utils/logger.js';

/** Configuration for the sandboxed execution environment */
export interface SandboxOptions {
  /** Working directory for the child process */
  cwd: string;
  /** Maximum execution time in milliseconds (default: 30000) */
  timeout: number;
  /** Maximum output bytes before truncation (default: 1MB) */
  maxOutputBytes: number;
  /** Additional environment variables (merged with sanitized env) */
  env?: Record<string, string>;
}

/** Result of a sandboxed command execution */
export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
}

/** Default sandbox options */
const DEFAULT_OPTIONS: SandboxOptions = {
  cwd: process.cwd(),
  timeout: 30_000,
  maxOutputBytes: 1_048_576, // 1MB
};

/**
 * Environment variable patterns that are ALWAYS stripped from child processes.
 * Prevents leaking API keys, tokens, and secrets.
 */
const SENSITIVE_ENV_PATTERNS = [
  /_?API_?KEY/i,
  /_?SECRET/i,
  /_?TOKEN/i,
  /_?PASSWORD/i,
  /^AUTH_/i,
  /^AWS_/i,
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
  /^DATABASE_URL$/i,
  /^REDIS_URL$/i,
];

/**
 * Create a sanitized environment for child processes.
 * Strips all sensitive variables matching known patterns.
 */
export function createSanitizedEnv(additionalEnv?: Record<string, string>): Record<string, string> {
  const baseEnv = process.env;
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;

    const isSensitive = SENSITIVE_ENV_PATTERNS.some(pattern => pattern.test(key));
    if (!isSensitive) {
      sanitized[key] = value;
    }
  }

  // Restrict PATH to safe directories (platform-aware)
  if (os.platform() === 'win32') {
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
    sanitized['PATH'] = `${systemRoot}\\System32;${systemRoot};${systemRoot}\\System32\\Wbem`;
    // Preserve essential Windows env vars for child processes
    const comSpec = process.env['ComSpec'];
    if (comSpec) {
      sanitized['ComSpec'] = comSpec;
    }
    sanitized['SystemRoot'] = systemRoot;
  } else {
    sanitized['PATH'] = '/usr/local/bin:/usr/bin:/bin';
  }

  // Merge additional env (user-provided values override)
  if (additionalEnv) {
    for (const [key, value] of Object.entries(additionalEnv)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Execute a command in the sandbox with restrictions.
 * The binary and args must already be validated by the permissions engine.
 */
export function executeInSandbox(
  binary: string,
  args: string[],
  options?: Partial<SandboxOptions>,
): Promise<SandboxResult> {
  const opts: SandboxOptions = { ...DEFAULT_OPTIONS, ...options };

  securityLogger.debug({ binary, args, cwd: opts.cwd, timeout: opts.timeout }, 'Sandbox execution starting');

  return new Promise((resolve) => {
    try {
      const childProcess = execFile(
        binary,
        args,
        {
          cwd: opts.cwd,
          timeout: opts.timeout,
          maxBuffer: opts.maxOutputBytes,
          env: createSanitizedEnv(opts.env),
          shell: false, // NEVER use shell — prevents injection
        },
        (error: ExecFileException | null, stdout: string, stderr: string) => {
          const timedOut = error !== null && error.killed === true;
          const truncated = stdout.length >= opts.maxOutputBytes || stderr.length >= opts.maxOutputBytes;

          if (timedOut) {
            securityLogger.warn({ binary, timeout: opts.timeout }, 'Sandbox execution timed out');
          }

          const exitCode = error?.code !== undefined
            ? (typeof error.code === 'number' ? error.code : 1)
            : 0;

          resolve({
            stdout: truncateOutput(stdout, opts.maxOutputBytes),
            stderr: truncateOutput(stderr, opts.maxOutputBytes),
            exitCode,
            timedOut,
            truncated,
          });
        },
      );

      // Safety: kill on unexpected errors
      childProcess.on('error', (spawnError: Error) => {
        securityLogger.error({ binary, error: spawnError.message }, 'Sandbox spawn error');
        resolve({
          stdout: '',
          stderr: spawnError.message,
          exitCode: 1,
          timedOut: false,
          truncated: false,
        });
      });
    } catch (execError: unknown) {
      const message = execError instanceof Error ? execError.message : 'Unknown execution error';
      securityLogger.error({ binary, error: message }, 'Sandbox execution failed');
      resolve({
        stdout: '',
        stderr: message,
        exitCode: 1,
        timedOut: false,
        truncated: false,
      });
    }
  });
}

/** Truncate output to the max byte limit */
function truncateOutput(output: string, maxBytes: number): string {
  if (output.length <= maxBytes) {
    return output;
  }
  return output.substring(0, maxBytes) + '\n[...output truncated...]';
}
