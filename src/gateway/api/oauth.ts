/**
 * OAuth route handlers.
 * GET  /api/v1/oauth/providers        — List available OAuth providers and connection status.
 * POST /api/v1/oauth/initiate         — Start an OAuth flow for a provider.
 * GET  /api/v1/oauth/callback         — Handle the OAuth provider's redirect callback.
 * DELETE /api/v1/oauth/tokens/:provider — Disconnect an OAuth provider.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import {
  initiateOAuthFlow,
  handleOAuthCallback,
  OAUTH_PRESETS,
  type OAuthProviderConfig,
} from '../../integrations/oauth.js';
import { listTokens, deleteToken } from '../../integrations/oauth-store.js';

/** Route parameters for provider-specific endpoints. */
interface ProviderParams {
  provider: string;
}

const InitiateBodySchema = z.object({
  provider: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  scopes: z.array(z.string()).optional(),
});

/**
 * Register OAuth endpoints on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 * @param baseUrl - The base URL of the server (for redirect URIs).
 */
export function registerOAuthRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
  baseUrl: string = 'http://localhost:3000',
): void {
  /** List available OAuth providers and their connection status. */
  app.get('/api/v1/oauth/providers', async (_request, reply) => {
    try {
      const storedTokens = listTokens(db);
      const connected = new Set(storedTokens.map((t) => t.provider));

      const providers = Object.entries(OAUTH_PRESETS).map(([key, preset]) => ({
        name: key,
        displayName: key.charAt(0).toUpperCase() + key.slice(1),
        scopes: preset.defaultScopes,
        connected: connected.has(key),
      }));

      return reply.status(200).send({ providers });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to list providers', detail: message });
    }
  });

  /** Start an OAuth flow — returns the authorization URL. */
  app.post('/api/v1/oauth/initiate', async (request, reply) => {
    try {
      const parsed = InitiateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
      }

      const { provider, clientId, clientSecret, scopes } = parsed.data;
      const preset = OAUTH_PRESETS[provider];

      if (!preset) {
        return reply.status(400).send({
          error: `Unknown provider: "${provider}". Available: ${Object.keys(OAUTH_PRESETS).join(', ')}`,
        });
      }

      const providerConfig: OAuthProviderConfig = {
        ...preset,
        clientId,
        clientSecret,
        redirectUri: `${baseUrl}/api/v1/oauth/callback`,
      };

      const result = initiateOAuthFlow(db, providerConfig, scopes);

      return reply.status(200).send({
        authorizationUrl: result.authorizationUrl,
        state: result.state,
        message: 'Redirect the user to the authorization URL to complete the OAuth flow.',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to initiate OAuth flow', detail: message });
    }
  });

  /** Handle the OAuth callback from the provider. */
  app.get('/api/v1/oauth/callback', async (request, reply) => {
    try {
      const query = request.query as Record<string, string>;
      const code = query['code'];
      const state = query['state'];
      const errorParam = query['error'];

      if (errorParam) {
        return reply.status(400).send({
          error: 'OAuth authorization denied',
          detail: query['error_description'] ?? errorParam,
        });
      }

      if (!code || !state) {
        return reply.status(400).send({ error: 'Missing code or state parameter' });
      }

      // Look up the state to find the provider
      const stateRow = db.prepare(
        'SELECT provider FROM oauth_state WHERE state = ?',
      ).get(state) as { provider: string } | undefined;

      if (!stateRow) {
        return reply.status(400).send({ error: 'Invalid or expired state parameter' });
      }

      const preset = OAUTH_PRESETS[stateRow.provider];
      if (!preset) {
        return reply.status(400).send({ error: `Unknown provider: ${stateRow.provider}` });
      }

      // For the callback, we need the client credentials.
      // In a real app, these would be stored in config. For now, we use a placeholder
      // since the actual exchange happens with the stored state's code_verifier.
      const providerConfig: OAuthProviderConfig = {
        ...preset,
        clientId: '', // Will need to come from config
        redirectUri: `${baseUrl}/api/v1/oauth/callback`,
      };

      const tokenId = await handleOAuthCallback(db, providerConfig, code, state);

      if (!tokenId) {
        return reply.status(400).send({ error: 'Token exchange failed' });
      }

      // Redirect to the web panel's settings page with success message
      return reply.redirect(`/?oauth_success=${stateRow.provider}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'OAuth callback failed', detail: message });
    }
  });

  /** Disconnect an OAuth provider (delete stored tokens). */
  app.delete<{ Params: ProviderParams }>('/api/v1/oauth/tokens/:provider', async (request, reply) => {
    try {
      const { provider } = request.params;
      const deleted = deleteToken(db, provider);

      if (!deleted) {
        return reply.status(404).send({ error: `No tokens found for provider: ${provider}` });
      }

      return reply.status(200).send({ message: `Disconnected from ${provider}` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to disconnect provider', detail: message });
    }
  });
}
