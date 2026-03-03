/**
 * Shorebreak sandbox — S2.N.4
 *
 * Provides a restricted execution environment for generated wave code
 * using Node.js vm.createContext(). The sandbox exposes only safe globals:
 *   - fetch (domain-checked wrapper)
 *   - JSON (parse/stringify)
 *   - console.log (captured, not written to stdout)
 *   - Date, Math, String, Number, Array, Object, Map, Set, RegExp
 *   - setTimeout/clearTimeout (with max duration cap)
 *
 * Dangerous globals are explicitly excluded: process, require, import,
 * eval, Function constructor, fs, child_process, etc.
 */

import { createContext, Script, type Context } from 'node:vm';
import { createModuleLogger } from '../utils/logger.js';

const sandboxLogger = createModuleLogger('shorebreak-sandbox');

/** Maximum execution time for sandbox scripts (ms). */
const MAX_EXECUTION_MS = 10_000;

/** Maximum setTimeout delay allowed inside the sandbox (ms). */
const MAX_TIMEOUT_DELAY_MS = 5_000;

/** Result of a sandbox execution. */
export interface SandboxResult {
  /** Whether the execution completed without errors. */
  success: boolean;
  /** The return value (serialized as string). */
  output: string;
  /** Error message if execution failed. */
  error?: string;
  /** Console.log output captured during execution. */
  logs: string[];
}

/**
 * Create a domain-checking fetch wrapper for the sandbox.
 * Only allows requests to explicitly allowed domains.
 *
 * @param allowedDomains - Array of hostnames the wave is allowed to contact.
 * @returns A fetch-compatible function that enforces domain restrictions.
 */
function createSandboxFetch(allowedDomains: string[]): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    if (!allowedDomains.includes(hostname)) {
      throw new Error(
        `Domain "${hostname}" is not in the allowed domains list. ` +
        `Allowed: ${allowedDomains.join(', ')}`,
      );
    }

    return fetch(input, init);
  };
}

/**
 * Build a restricted vm context with only safe globals.
 *
 * @param allowedDomains - Domains the sandboxed code may contact via fetch().
 * @param logCapture - Array to push console.log output into.
 * @returns A vm Context with restricted globals.
 */
function buildSandboxContext(
  allowedDomains: string[],
  logCapture: string[],
): Context {
  const sandboxGlobals: Record<string, unknown> = {
    // Safe network access (domain-checked)
    fetch: createSandboxFetch(allowedDomains),

    // Data utilities
    JSON,
    Date,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,

    // Captured console
    console: {
      log: (...args: unknown[]) => {
        const line = args.map((arg) =>
          typeof arg === 'string' ? arg : JSON.stringify(arg),
        ).join(' ');
        logCapture.push(line);
      },
      warn: (...args: unknown[]) => {
        const line = `[WARN] ${args.map((arg) =>
          typeof arg === 'string' ? arg : JSON.stringify(arg),
        ).join(' ')}`;
        logCapture.push(line);
      },
      error: (...args: unknown[]) => {
        const line = `[ERROR] ${args.map((arg) =>
          typeof arg === 'string' ? arg : JSON.stringify(arg),
        ).join(' ')}`;
        logCapture.push(line);
      },
    },

    // Limited timers (capped delay)
    setTimeout: (fn: () => void, delay?: number) => {
      const cappedDelay = Math.min(delay ?? 0, MAX_TIMEOUT_DELAY_MS);
      return setTimeout(fn, cappedDelay);
    },
    clearTimeout,

    // Promise support for async operations
    Promise,

    // Explicitly undefined — block dangerous access
    process: undefined,
    require: undefined,
    module: undefined,
    exports: undefined,
    __dirname: undefined,
    __filename: undefined,
    globalThis: undefined,
    global: undefined,
    eval: undefined,
    Function: undefined,
  };

  return createContext(sandboxGlobals);
}

/**
 * Execute generated wave code in the sandbox.
 *
 * Compiles the code as a vm.Script, runs it in a restricted context with
 * a timeout, and captures the return value and console output.
 *
 * The source code should export a function via a top-level assignment:
 *   `var execute = async function(params) { ... return result; }`
 *
 * After the script runs, we call `execute(params)` in the same context.
 *
 * @param sourceCode - The generated JavaScript source code to execute.
 * @param params - Parameters extracted from the user message to pass to the wave.
 * @param allowedDomains - Domains the code may contact via fetch().
 * @param timeoutMs - Maximum execution time in milliseconds.
 * @returns A SandboxResult with output, logs, and error info.
 */
export async function executeSandboxed(
  sourceCode: string,
  params: Record<string, unknown>,
  allowedDomains: string[] = [],
  timeoutMs: number = MAX_EXECUTION_MS,
): Promise<SandboxResult> {
  const logs: string[] = [];

  try {
    const context = buildSandboxContext(allowedDomains, logs);

    // Compile and run the source code to define the execute function
    const defineScript = new Script(sourceCode, {
      filename: 'generated-wave.js',
    });
    defineScript.runInContext(context, { timeout: timeoutMs });

    // Call the execute function with params
    const callScript = new Script(
      `(async () => {
        if (typeof execute !== 'function') {
          throw new Error('Generated wave must define an execute function');
        }
        return await execute(${JSON.stringify(params)});
      })()`,
      { filename: 'sandbox-runner.js' },
    );

    const resultPromise = callScript.runInContext(context, { timeout: timeoutMs }) as Promise<unknown>;

    // Race the promise against a timeout
    const result = await Promise.race([
      resultPromise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error(`Sandbox execution timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);

    const output = typeof result === 'string' ? result : JSON.stringify(result);

    sandboxLogger.info(
      { outputLength: output.length, logCount: logs.length },
      'Sandbox execution completed successfully',
    );

    return { success: true, output, logs };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    sandboxLogger.warn({ error: message }, 'Sandbox execution failed');
    return { success: false, output: '', error: message, logs };
  }
}
