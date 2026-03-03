/**
 * Daily briefing API route handler.
 * GET /api/v1/briefing — Returns a structured daily briefing with wave,
 * task, schedule, cost, email, and calendar data. No LLM calls.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { generateBriefing, type DailyBriefing, type BriefingOAuthDeps } from '../../orchestrator/briefing-generator.js';
import { getValidAccessToken, type OAuthProviderConfig } from '../../integrations/oauth.js';
import { createModuleLogger } from '../../utils/logger.js';

const briefingApiLogger = createModuleLogger('briefing-api');

/**
 * Register the briefing endpoint on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerBriefingRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
): void {
  app.get<{ Reply: DailyBriefing }>(
    '/api/v1/briefing',
    async (_request, reply) => {
      try {
        // Build OAuth deps for fetching email/calendar data
        const oauthDeps: BriefingOAuthDeps = {
          getAccessToken: async (provider: string) => {
            try {
              // Build a minimal provider config for token refresh
              const providerConfig: OAuthProviderConfig = {
                name: provider,
                authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
                tokenUrl: 'https://oauth2.googleapis.com/token',
                clientId: process.env.GOOGLE_CLIENT_ID ?? '',
                clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
                defaultScopes: [],
                redirectUri: process.env.OAUTH_REDIRECT_URI ?? 'http://localhost:18421/api/v1/oauth/callback',
              };
              return await getValidAccessToken(db, providerConfig);
            } catch {
              return null;
            }
          },
        };

        const briefing = await generateBriefing(db, oauthDeps);
        return reply.status(200).send(briefing);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        briefingApiLogger.error({ error: message }, 'Failed to generate briefing');
        return reply.status(500).send({
          error: 'Failed to generate briefing',
          detail: message,
        } as never);
      }
    },
  );
}
