/**
 * Tests for the onboarding API routes.
 * Covers status, key verification, and config completion endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerOnboardingRoutes } from '../../../src/gateway/api/onboarding.js';

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock('../../../src/index.js', () => ({
  isOnboarded: vi.fn(() => false),
}));

vi.mock('../../../src/utils/hardware.js', () => ({
  detectHardware: vi.fn(() => ({
    os: 'darwin',
    arch: 'arm64',
    ramGb: 16,
    cpuCores: 8,
    diskFreeGb: 100,
    hasGpu: true,
    features: {
      browserAutomation: true,
      localModels: true,
      voice: true,
    },
  })),
}));

vi.mock('../../../src/onboarding/verify-provider.js', () => ({
  verifyApiKey: vi.fn(async (provider: string, _apiKey: string) => {
    if (provider === 'anthropic') {
      return { provider: 'anthropic', valid: true };
    }
    return { provider, valid: false, error: 'Invalid API key' };
  }),
}));

vi.mock('../../../src/config/loader.js', () => ({
  saveConfig: vi.fn(async () => {}),
  deleteConfig: vi.fn(async () => {}),
  homeDir: vi.fn(() => '/tmp/test-lil-dude'),
}));

vi.mock('../../../src/config/schema.js', async () => {
  const actual = await vi.importActual('../../../src/config/schema.js');
  return actual;
});

vi.mock('../../../src/utils/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  securityLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Tests ─────────────────────────────────────────────────────────

describe('Onboarding API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerOnboardingRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/onboarding/status', () => {
    it('returns onboarded false and hardware profile', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/onboarding/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { onboarded: boolean; hardware: { ramGb: number } };
      expect(body.onboarded).toBe(false);
      expect(body.hardware.ramGb).toBe(16);
      expect(body.hardware.os).toBe('darwin');
    });
  });

  describe('POST /api/v1/onboarding/verify-key', () => {
    it('returns valid true for a known-good key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/verify-key',
        payload: { provider: 'anthropic', apiKey: 'sk-test-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { valid: boolean };
      expect(body.valid).toBe(true);
    });

    it('returns valid false for an invalid key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/verify-key',
        payload: { provider: 'openai', apiKey: 'bad-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { valid: boolean; error?: string };
      expect(body.valid).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('returns 400 for missing apiKey', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/verify-key',
        payload: { provider: 'anthropic' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for unsupported provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/verify-key',
        payload: { provider: 'unsupported', apiKey: 'key' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/onboarding/complete', () => {
    it('saves config and returns success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/complete',
        payload: {
          config: {
            version: 1,
            user: { name: 'Test User' },
            providers: {
              anthropic: { enabled: true, apiKey: 'sk-test' },
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { ok: boolean; restartRequired: boolean };
      expect(body.ok).toBe(true);
      expect(body.restartRequired).toBe(true);
    });

    it('returns 400 for missing config payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/complete',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/onboarding/reset', () => {
    it('deletes config and returns success', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/onboarding/reset',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { ok: boolean; message: string };
      expect(body.ok).toBe(true);
      expect(body.message).toContain('cleared');
    });
  });
});
