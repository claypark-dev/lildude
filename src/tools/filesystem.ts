/**
 * Filesystem tools — S1.H.1
 *
 * Provides read, write, and directory listing operations with full
 * security permission checks and audit logging.
 *
 * RULE: NEVER access SQLite directly — always go through src/persistence/.
 * RULE: ALWAYS validate file paths via the permissions engine before operating.
 */

import { readFile as fsReadFile, writeFile as fsWriteFile, readdir, stat } from 'node:fs/promises';
import type BetterSqlite3 from 'better-sqlite3';
import type { ToolResult, SecurityCheckResult } from '../types/index.js';
import type { SecurityLevel } from '../security/permissions.js';
import { checkFilePath } from '../security/permissions.js';
import { appendSecurityLog } from '../persistence/security-log.js';

/** Action type constants used in security log entries. */
const ACTION_TYPE_READ = 'file_read';
const ACTION_TYPE_WRITE = 'file_write';
const ACTION_TYPE_LIST = 'directory_list';

/** Maximum file size (in bytes) that can be read to prevent memory exhaustion. */
const MAX_READ_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Check file path permissions and return an error ToolResult if not allowed.
 * Logs the security decision and returns null when the path is allowed.
 */
function checkPathPermission(
  db: BetterSqlite3.Database,
  path: string,
  actionType: string,
  operationLabel: string,
  securityLevel: SecurityLevel,
  taskId?: string,
): ToolResult | null {
  const permissionResult: SecurityCheckResult = checkFilePath(path, { securityLevel });

  if (permissionResult.decision === 'allow') {
    return null;
  }

  appendSecurityLog(db, {
    actionType,
    actionDetail: path,
    allowed: false,
    securityLevel,
    reason: permissionResult.reason,
    taskId,
  });

  const isApproval = permissionResult.decision === 'needs_approval';
  const errorPrefix = isApproval ? `${operationLabel} requires approval` : `${operationLabel} denied`;

  return {
    success: false,
    output: '',
    error: `${errorPrefix}: ${permissionResult.reason}`,
    metadata: {
      decision: permissionResult.decision,
      riskLevel: permissionResult.riskLevel,
      ...(isApproval ? { needsApproval: true } : {}),
    },
  };
}

/**
 * Read the contents of a file after passing security checks.
 *
 * @param db - The better-sqlite3 Database instance for security logging.
 * @param filePath - Absolute path to the file to read.
 * @param securityLevel - The current security level (1-5).
 * @param taskId - Optional task ID for audit trail correlation.
 * @returns A ToolResult containing the file contents or an error (never throws).
 */
export async function readFile(
  db: BetterSqlite3.Database,
  filePath: string,
  securityLevel: SecurityLevel,
  taskId?: string,
): Promise<ToolResult> {
  try {
    const denied = checkPathPermission(db, filePath, ACTION_TYPE_READ, 'File read', securityLevel, taskId);
    if (denied) return denied;

    const fileStat = await stat(filePath);
    if (fileStat.size > MAX_READ_SIZE) {
      appendSecurityLog(db, {
        actionType: ACTION_TYPE_READ,
        actionDetail: filePath,
        allowed: false,
        securityLevel,
        reason: `File exceeds maximum read size (${fileStat.size} bytes > ${MAX_READ_SIZE} bytes)`,
        taskId,
      });
      return {
        success: false,
        output: '',
        error: `File too large to read: ${fileStat.size} bytes exceeds limit of ${MAX_READ_SIZE} bytes`,
        metadata: { fileSize: fileStat.size, maxSize: MAX_READ_SIZE },
      };
    }

    const content = await fsReadFile(filePath, 'utf-8');

    appendSecurityLog(db, {
      actionType: ACTION_TYPE_READ,
      actionDetail: filePath,
      allowed: true,
      securityLevel,
      reason: 'File read successfully',
      taskId,
    });

    return {
      success: true,
      output: content,
      metadata: { fileSize: fileStat.size },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, output: '', error: `File read error: ${message}` };
  }
}

/**
 * Write content to a file after passing security checks.
 *
 * @param db - The better-sqlite3 Database instance for security logging.
 * @param filePath - Absolute path to the file to write.
 * @param content - The string content to write to the file.
 * @param securityLevel - The current security level (1-5).
 * @param taskId - Optional task ID for audit trail correlation.
 * @returns A ToolResult indicating success or failure (never throws).
 */
export async function writeFile(
  db: BetterSqlite3.Database,
  filePath: string,
  content: string,
  securityLevel: SecurityLevel,
  taskId?: string,
): Promise<ToolResult> {
  try {
    const denied = checkPathPermission(db, filePath, ACTION_TYPE_WRITE, 'File write', securityLevel, taskId);
    if (denied) return denied;

    await fsWriteFile(filePath, content, 'utf-8');

    appendSecurityLog(db, {
      actionType: ACTION_TYPE_WRITE,
      actionDetail: filePath,
      allowed: true,
      securityLevel,
      reason: 'File written successfully',
      taskId,
    });

    return {
      success: true,
      output: `File written successfully: ${filePath}`,
      metadata: { bytesWritten: Buffer.byteLength(content, 'utf-8') },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, output: '', error: `File write error: ${message}` };
  }
}

/**
 * List directory contents after passing security checks.
 *
 * @param db - The better-sqlite3 Database instance for security logging.
 * @param dirPath - Absolute path to the directory to list.
 * @param securityLevel - The current security level (1-5).
 * @param taskId - Optional task ID for audit trail correlation.
 * @returns A ToolResult containing the directory listing or an error (never throws).
 */
export async function listDirectory(
  db: BetterSqlite3.Database,
  dirPath: string,
  securityLevel: SecurityLevel,
  taskId?: string,
): Promise<ToolResult> {
  try {
    const denied = checkPathPermission(db, dirPath, ACTION_TYPE_LIST, 'Directory listing', securityLevel, taskId);
    if (denied) return denied;

    const entries = await readdir(dirPath, { withFileTypes: true });
    const listing = entries.map((entry) => {
      const entryType = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other';
      return `${entryType}\t${entry.name}`;
    });

    appendSecurityLog(db, {
      actionType: ACTION_TYPE_LIST,
      actionDetail: dirPath,
      allowed: true,
      securityLevel,
      reason: 'Directory listed successfully',
      taskId,
    });

    return {
      success: true,
      output: listing.join('\n'),
      metadata: { entryCount: entries.length },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, output: '', error: `Directory listing error: ${message}` };
  }
}
