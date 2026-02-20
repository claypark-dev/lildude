/**
 * Tests for the Ollama API routes and lifecycle module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerOllamaRoutes } from '../../../src/gateway/api/ollama.js';
import type { WSManager } from '../../../src/gateway/ws.js';

// ── Mocks ─────────────────────────────────────────────────────────

let ollamaRunning = true;

vi.mock('../../../src/providers/ollama-lifecycle.js', () => ({
  isOllamaRunning: vi.fn(async () => ollamaRunning),
  stopOllamaProcess: vi.fn(async () => {}),
  markOllamaManaged: vi.fn(),
  isOllamaManagedByUs: vi.fn(() => false),
  clearOllamaManagedFlag: vi.fn(),
}));

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

// Mock global fetch for Ollama API calls
const originalFetch = global.fetch;

function createMockWSManager(): WSManager {
  return {
    addClient: vi.fn(() => 'mock-client'),
    removeClient: vi.fn(),
    broadcast: vi.fn(),
    sendTo: vi.fn(),
    onMessage: vi.fn(),
    clientCount: vi.fn(() => 0),
    disconnectAll: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Ollama API', () => {
  let app: FastifyInstance;
  let wsManager: WSManager;

  beforeEach(async () => {
    ollamaRunning = true;
    app = Fastify({ logger: false });
    wsManager = createMockWSManager();
    registerOllamaRoutes(app, wsManager);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    global.fetch = originalFetch;
  });

  describe('GET /api/v1/ollama/status', () => {
    it('returns running true when Ollama is reachable', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '0.5.1' }),
      }) as unknown as typeof fetch;

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/ollama/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { running: boolean; version?: string };
      expect(body.running).toBe(true);
      expect(body.version).toBe('0.5.1');
    });

    it('returns running false when Ollama is not reachable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused')) as unknown as typeof fetch;

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/ollama/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { running: boolean };
      expect(body.running).toBe(false);
    });
  });

  describe('GET /api/v1/ollama/models', () => {
    it('returns 503 when Ollama is not running', async () => {
      ollamaRunning = false;

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/ollama/models',
      });

      expect(response.statusCode).toBe(503);
    });
  });

  describe('POST /api/v1/ollama/pull', () => {
    it('returns 400 for invalid model name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/ollama/pull',
        payload: { model: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 503 when Ollama is not running', async () => {
      ollamaRunning = false;

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/ollama/pull',
        payload: { model: 'llama3.2' },
      });

      expect(response.statusCode).toBe(503);
    });
  });

  describe('POST /api/v1/ollama/stop', () => {
    it('stops the Ollama process', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/ollama/stop',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });
});

describe('Ollama Lifecycle', () => {
  it('exports expected lifecycle functions', async () => {
    const lifecycle = await import('../../../src/providers/ollama-lifecycle.js');
    expect(typeof lifecycle.isOllamaRunning).toBe('function');
    expect(typeof lifecycle.isOllamaManagedByUs).toBe('function');
    expect(typeof lifecycle.markOllamaManaged).toBe('function');
    expect(typeof lifecycle.clearOllamaManagedFlag).toBe('function');
    expect(typeof lifecycle.stopOllamaProcess).toBe('function');
  });
});
