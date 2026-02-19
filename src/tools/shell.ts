/**
 * Shell tool — S1.H.1
 *
 * Executes shell commands through the security sandbox after
 * permission checks. Every invocation is logged to the security audit log.
 *
 * RULE: NEVER use child_process directly — always go through sandbox.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ToolResult } from '../types/index.js';
import type { SecurityLevel } from '../security/permissions.js';
import { checkCommand } from '../security/permissions.js';
import { executeInSandbox } from '../security/sandbox.js';
import { appendSecurityLog } from '../persistence/security-log.js';
import { parseCommand } from '../security/command-parser.js';

/** Action type constant used in security log entries for shell commands. */
const ACTION_TYPE = 'shell_command';

/**
 * Execute a shell command with full security checks and audit logging.
 *
 * Flow:
 * 1. Run the command through the permissions engine (checkCommand).
 * 2. If denied — log the denial and return an error ToolResult.
 * 3. If needs_approval — log the request and return a ToolResult indicating approval is needed.
 * 4. If allowed — execute via the process sandbox, log the outcome, and return the result.
 *
 * @param db - The better-sqlite3 Database instance for security logging.
 * @param command - The raw shell command string to execute.
 * @param securityLevel - The current security level (1-5).
 * @param cwd - Optional working directory for the command (defaults to process.cwd()).
 * @param taskId - Optional task ID for audit trail correlation.
 * @returns A ToolResult describing the outcome (never throws).
 */
export async function executeShellCommand(
  db: BetterSqlite3.Database,
  command: string,
  securityLevel: SecurityLevel,
  cwd?: string,
  taskId?: string,
): Promise<ToolResult> {
  try {
    const permissionResult = checkCommand(command, { securityLevel });

    if (permissionResult.decision === 'deny') {
      appendSecurityLog(db, {
        actionType: ACTION_TYPE,
        actionDetail: command,
        allowed: false,
        securityLevel,
        reason: permissionResult.reason,
        taskId,
      });

      return {
        success: false,
        output: '',
        error: `Command denied: ${permissionResult.reason}`,
        metadata: {
          decision: permissionResult.decision,
          riskLevel: permissionResult.riskLevel,
        },
      };
    }

    if (permissionResult.decision === 'needs_approval') {
      appendSecurityLog(db, {
        actionType: ACTION_TYPE,
        actionDetail: command,
        allowed: false,
        securityLevel,
        reason: permissionResult.reason,
        taskId,
      });

      return {
        success: false,
        output: '',
        error: `Command requires approval: ${permissionResult.reason}`,
        metadata: {
          decision: permissionResult.decision,
          riskLevel: permissionResult.riskLevel,
          needsApproval: true,
        },
      };
    }

    // Decision is 'allow' — parse and execute through sandbox
    const parsedCommands = parseCommand(command);
    if (parsedCommands.length === 0) {
      return {
        success: false,
        output: '',
        error: 'Empty command after parsing',
      };
    }

    // Execute the first parsed command through the sandbox
    const primaryCommand = parsedCommands[0];
    const sandboxResult = await executeInSandbox(
      primaryCommand.binary,
      primaryCommand.args,
      {
        cwd: cwd ?? process.cwd(),
        timeout: 30_000,
        maxOutputBytes: 1_048_576,
      },
    );

    const commandSucceeded = sandboxResult.exitCode === 0 && !sandboxResult.timedOut;

    appendSecurityLog(db, {
      actionType: ACTION_TYPE,
      actionDetail: command,
      allowed: true,
      securityLevel,
      reason: commandSucceeded
        ? 'Command executed successfully'
        : `Command exited with code ${sandboxResult.exitCode}${sandboxResult.timedOut ? ' (timed out)' : ''}`,
      taskId,
    });

    return {
      success: commandSucceeded,
      output: sandboxResult.stdout,
      error: sandboxResult.stderr || undefined,
      metadata: {
        exitCode: sandboxResult.exitCode,
        timedOut: sandboxResult.timedOut,
        truncated: sandboxResult.truncated,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: '',
      error: `Shell tool error: ${message}`,
    };
  }
}
