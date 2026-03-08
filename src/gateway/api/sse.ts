/**
 * Server-Sent Events (SSE) endpoint for real-time dashboard updates.
 * GET /api/v1/events — streaming endpoint that pushes events to connected clients.
 *
 * Events: cron.fired, task.update, cost.update, health.update
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { createModuleLogger } from '../../utils/logger.js';

const sseLogger = createModuleLogger('sse');

/** Internal set of active SSE clients for broadcasting. */
const sseClients = new Set<FastifyReply>();

/**
 * Broadcast an SSE event to all connected clients.
 * @param event - The event type name.
 * @param data - The JSON-serializable payload.
 */
export function broadcastSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const reply of sseClients) {
    try {
      reply.raw.write(payload);
    } catch {
      sseClients.delete(reply);
    }
  }
}

/**
 * Register the SSE events endpoint.
 * @param app - The Fastify server instance.
 * @param _db - The database instance (for future health polling).
 */
export function registerSSERoutes(
  app: FastifyInstance,
  _db: BetterSqlite3.Database,
): void {
  app.get('/api/v1/events', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial heartbeat
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    sseClients.add(reply);
    sseLogger.debug({ clientCount: sseClients.size }, 'SSE client connected');

    // Clean up on disconnect
    request.raw.on('close', () => {
      sseClients.delete(reply);
      sseLogger.debug({ clientCount: sseClients.size }, 'SSE client disconnected');
    });

    // Keep connection open — Fastify will handle the lifecycle
    // We return the raw reply to prevent Fastify from auto-closing
    return reply;
  });
}

/**
 * Get the number of connected SSE clients.
 * @returns The count of active SSE connections.
 */
export function getSSEClientCount(): number {
  return sseClients.size;
}
