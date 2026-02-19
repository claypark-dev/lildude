/**
 * HTTP client tool — S1.H.1
 *
 * Makes outbound HTTP requests after checking domain permissions.
 * All requests are logged to the security audit log.
 *
 * Uses native fetch() — no external HTTP library dependencies.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ToolResult } from '../types/index.js';
import type { SecurityLevel } from '../security/permissions.js';
import { checkDomain } from '../security/permissions.js';
import { appendSecurityLog } from '../persistence/security-log.js';

/** Action type constant used in security log entries for HTTP requests. */
const ACTION_TYPE = 'http_request';

/** Supported HTTP methods. */
type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Default request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Maximum response body size in bytes (5 MB). */
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

/**
 * Extract the hostname from a URL string for domain-level permission checks.
 *
 * @param urlString - The full URL to extract the hostname from.
 * @returns The hostname portion of the URL.
 * @throws {Error} If the URL cannot be parsed.
 */
function extractHostname(urlString: string): string {
  const parsed = new URL(urlString);
  return parsed.hostname;
}

/**
 * Make an HTTP request after passing domain security checks.
 *
 * Flow:
 * 1. Parse the URL and extract the hostname.
 * 2. Run the domain through checkDomain permission check.
 * 3. If denied — log and return error ToolResult.
 * 4. If needs_approval — log and return ToolResult indicating approval needed.
 * 5. If allowed — execute the fetch with a 30-second timeout, log, and return result.
 *
 * @param db - The better-sqlite3 Database instance for security logging.
 * @param url - The full URL to request.
 * @param method - The HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD).
 * @param securityLevel - The current security level (1-5).
 * @param headers - Optional request headers.
 * @param body - Optional request body (serialized as string).
 * @param taskId - Optional task ID for audit trail correlation.
 * @returns A ToolResult containing the response or an error (never throws).
 */
export async function httpRequest(
  db: BetterSqlite3.Database,
  url: string,
  method: HttpMethod,
  securityLevel: SecurityLevel,
  headers?: Record<string, string>,
  body?: string,
  taskId?: string,
): Promise<ToolResult> {
  try {
    let hostname: string;
    try {
      hostname = extractHostname(url);
    } catch {
      return {
        success: false,
        output: '',
        error: `Invalid URL: ${url}`,
      };
    }

    const actionDetail = `${method} ${url}`;
    const permissionResult = checkDomain(hostname, { securityLevel });

    if (permissionResult.decision === 'deny') {
      appendSecurityLog(db, {
        actionType: ACTION_TYPE,
        actionDetail,
        allowed: false,
        securityLevel,
        reason: permissionResult.reason,
        taskId,
      });

      return {
        success: false,
        output: '',
        error: `HTTP request denied: ${permissionResult.reason}`,
        metadata: {
          decision: permissionResult.decision,
          riskLevel: permissionResult.riskLevel,
          hostname,
        },
      };
    }

    if (permissionResult.decision === 'needs_approval') {
      appendSecurityLog(db, {
        actionType: ACTION_TYPE,
        actionDetail,
        allowed: false,
        securityLevel,
        reason: permissionResult.reason,
        taskId,
      });

      return {
        success: false,
        output: '',
        error: `HTTP request requires approval: ${permissionResult.reason}`,
        metadata: {
          decision: permissionResult.decision,
          riskLevel: permissionResult.riskLevel,
          needsApproval: true,
          hostname,
        },
      };
    }

    // Execute the HTTP request with a timeout via AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: headers ?? undefined,
        body: body ?? undefined,
        signal: controller.signal,
      };

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      // Read response body with size limit
      const responseBody = await readResponseBody(response, MAX_RESPONSE_SIZE);

      appendSecurityLog(db, {
        actionType: ACTION_TYPE,
        actionDetail,
        allowed: true,
        securityLevel,
        reason: `HTTP ${response.status} ${response.statusText}`,
        taskId,
      });

      const isSuccess = response.ok;

      return {
        success: isSuccess,
        output: responseBody,
        error: isSuccess ? undefined : `HTTP ${response.status}: ${response.statusText}`,
        metadata: {
          statusCode: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          hostname,
        },
      };
    } catch (fetchError: unknown) {
      clearTimeout(timeoutId);

      const isAbortError = fetchError instanceof Error && fetchError.name === 'AbortError';
      const errorMessage = isAbortError
        ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : fetchError instanceof Error
          ? fetchError.message
          : String(fetchError);

      appendSecurityLog(db, {
        actionType: ACTION_TYPE,
        actionDetail,
        allowed: true,
        securityLevel,
        reason: `Request failed: ${errorMessage}`,
        taskId,
      });

      return {
        success: false,
        output: '',
        error: `HTTP request failed: ${errorMessage}`,
        metadata: {
          timedOut: isAbortError,
          hostname,
        },
      };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: '',
      error: `HTTP tool error: ${message}`,
    };
  }
}

/**
 * Read a response body with a size limit to prevent memory exhaustion.
 *
 * @param response - The fetch Response object.
 * @param maxBytes - Maximum number of bytes to read.
 * @returns The response body as a string (truncated if needed).
 */
async function readResponseBody(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return `[Response body too large: ${contentLength} bytes, limit: ${maxBytes} bytes]`;
  }

  const text = await response.text();
  if (text.length > maxBytes) {
    return text.substring(0, maxBytes) + '\n[...response truncated...]';
  }
  return text;
}
