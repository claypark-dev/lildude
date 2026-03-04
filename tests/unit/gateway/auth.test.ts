import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { registerAuthMiddleware } from '../../../src/gateway/middleware/auth.js';
import { storeApiKey, generateApiKey, hashApiKey } from '../../../src/persistence/api-keys.js';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

describe('auth middleware', () => {
  let manager: DatabaseManager;
  let app: FastifyInstance;
  let validApiKey: string;

  beforeEach(async () => {
    manager = createTestDb();
    app = Fastify({ logger: false });

    // Store a valid API key
    validApiKey = generateApiKey();
    storeApiKey(manager.db, validApiKey, 'test-key');

    // Register auth middleware
    registerAuthMiddleware(app, manager.db);

    // Register test routes
    app.get('/api/v1/health', async () => ({ status: 'ok' }));
    app.get('/api/v1/protected', async () => ({ data: 'secret' }));
    app.post('/api/v1/protected', async () => ({ created: true }));
    app.get('/api/v1/onboarding/status', async () => ({ onboarded: false }));
    app.get('/api/v1/ollama/status', async () => ({ running: true }));
    app.get('/api/v1/oauth/callback', async () => ({ ok: true }));
    app.get('/not-api', async () => ({ page: 'html' }));

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    try {
      manager.close();
    } catch {
      // best-effort cleanup
    }
  });

  describe('public routes', () => {
    it('allows /api/v1/health without auth', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(response.statusCode).toBe(200);
    });

    it('allows /api/v1/oauth/callback without auth', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/oauth/callback' });

      expect(response.statusCode).toBe(200);
    });

    it('allows /api/v1/onboarding/* without auth', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/onboarding/status' });

      expect(response.statusCode).toBe(200);
    });

    it('allows /api/v1/ollama/* without auth', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/ollama/status' });

      expect(response.statusCode).toBe(200);
    });

    it('allows non-API routes without auth', async () => {
      const response = await app.inject({ method: 'GET', url: '/not-api' });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('protected routes', () => {
    it('rejects requests without Authorization header', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/protected' });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Unauthorized');
    });

    it('rejects requests with empty Authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/protected',
        headers: { authorization: '' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects requests with invalid token format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/protected',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects requests with wrong token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/protected',
        headers: { authorization: 'Bearer ld_wrong_token_here' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.detail).toBe('Invalid API key');
    });

    it('allows requests with valid Bearer token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/protected',
        headers: { authorization: `Bearer ${validApiKey}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBe('secret');
    });

    it('works with POST requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/protected',
        headers: { authorization: `Bearer ${validApiKey}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('rejects revoked keys', async () => {
      // Revoke the key
      const keys = manager.db.prepare(
        `SELECT id FROM api_keys WHERE key_hash = ?`,
      ).get(hashApiKey(validApiKey)) as { id: string };
      manager.db.prepare(
        `UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(keys.id);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/protected',
        headers: { authorization: `Bearer ${validApiKey}` },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('security logging', () => {
    it('logs failed auth attempts', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/v1/protected',
        headers: { authorization: 'Bearer ld_badkey' },
      });

      const logs = manager.db.prepare(
        `SELECT * FROM security_log WHERE action_type = 'gateway_auth'`,
      ).all() as Array<{ allowed: number }>;

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].allowed).toBe(0);
    });

    it('logs missing auth header', async () => {
      await app.inject({ method: 'GET', url: '/api/v1/protected' });

      const logs = manager.db.prepare(
        `SELECT * FROM security_log WHERE action_type = 'gateway_auth' AND reason LIKE '%Missing%'`,
      ).all();

      expect(logs.length).toBe(1);
    });
  });

  describe('query string handling', () => {
    it('handles routes with query strings', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health?verbose=true',
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
