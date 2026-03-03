/**
 * Bearer token authentication middleware for the Fastify gateway.
 * Validates `Authorization: Bearer <token>` on all /api/v1/* routes except /health.
 * Tokens are verified by hashing and comparing against the api_keys table.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { hashApiKey, findApiKeyByHash, touchApiKey } from '../../persistence/api-keys.js';
import { appendSecurityLog } from '../../persistence/security-log.js';
import { gatewayLogger } from '../../utils/logger.js';

const log = gatewayLogger;

/** Routes exempt from authentication. */
const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  '/api/v1/health',
  '/api/v1/oauth/callback',
]);

/** Route prefixes that are exempt from authentication. */
const PUBLIC_PREFIXES: readonly string[] = [
  '/api/v1/onboarding',
];

/**
 * Check if a request URL is exempt from authentication.
 * @param url - The request URL path.
 * @returns True if the route is public and doesn't need auth.
 */
function isPublicRoute(url: string): boolean {
  // Strip query string for matching
  const path = url.split('?')[0];

  if (PUBLIC_ROUTES.has(path)) {
    return true;
  }

  for (const prefix of PUBLIC_PREFIXES) {
    if (path.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract the bearer token from the Authorization header.
 * @param request - The Fastify request object.
 * @returns The token string, or undefined if no valid bearer token is present.
 */
function extractBearerToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return undefined;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return undefined;
  }

  return parts[1];
}

/**
 * Register the authentication middleware on the Fastify instance.
 * Adds a preHandler hook that validates bearer tokens on protected routes.
 *
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerAuthMiddleware(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
): void {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for non-API routes (static files, SPA, WebSocket upgrade)
    if (!request.url.startsWith('/api/')) {
      return;
    }

    // Skip auth for public routes
    if (isPublicRoute(request.url)) {
      return;
    }

    const token = extractBearerToken(request);

    if (!token) {
      appendSecurityLog(db, {
        actionType: 'gateway_auth',
        actionDetail: `Unauthenticated request to ${request.method} ${request.url}`,
        allowed: false,
        securityLevel: 0,
        reason: 'Missing or invalid Authorization header',
      });

      log.warn({ url: request.url, method: request.method }, 'Request missing auth token');
      return reply.status(401).send({ error: 'Unauthorized', detail: 'Missing or invalid Authorization header' });
    }

    const keyHash = hashApiKey(token);
    const apiKey = findApiKeyByHash(db, keyHash);

    if (!apiKey) {
      appendSecurityLog(db, {
        actionType: 'gateway_auth',
        actionDetail: `Invalid token used for ${request.method} ${request.url}`,
        allowed: false,
        securityLevel: 0,
        reason: 'API key not found or revoked',
      });

      log.warn({ url: request.url, method: request.method }, 'Invalid API key presented');
      return reply.status(401).send({ error: 'Unauthorized', detail: 'Invalid API key' });
    }

    // Update last-used timestamp (fire-and-forget, non-blocking)
    try {
      touchApiKey(db, apiKey.id);
    } catch {
      // Non-critical — don't block the request
    }
  });

  log.info('Auth middleware registered');
}
