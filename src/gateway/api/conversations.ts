/**
 * Conversations route handlers.
 * GET /api/v1/conversations      — List recent conversations.
 * GET /api/v1/conversations/:id  — Get a single conversation by ID.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import {
  getConversation,
  getConversationsByChannel,
} from '../../persistence/conversations.js';

/** Query parameters for the conversations list endpoint. */
interface ConversationsQuerystring {
  channelType?: string;
  channelId?: string;
  limit?: string;
}

/** Route parameters for conversation-specific endpoints. */
interface ConversationParams {
  id: string;
}

/**
 * Register conversation endpoints on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerConversationRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  app.get<{ Querystring: ConversationsQuerystring }>(
    '/api/v1/conversations',
    async (request, reply) => {
      try {
        const channelType = request.query.channelType ?? 'webchat';
        const channelId = request.query.channelId ?? 'default';
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

        const conversations = getConversationsByChannel(db, channelType, channelId, limit);
        return reply.status(200).send({ conversations, count: conversations.length });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: 'Failed to retrieve conversations', detail: message });
      }
    },
  );

  app.get<{ Params: ConversationParams }>(
    '/api/v1/conversations/:id',
    async (request, reply) => {
      try {
        const conversation = getConversation(db, request.params.id);
        if (!conversation) {
          return reply.status(404).send({ error: 'Conversation not found' });
        }
        return reply.status(200).send({ conversation });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: 'Failed to retrieve conversation', detail: message });
      }
    },
  );
}
