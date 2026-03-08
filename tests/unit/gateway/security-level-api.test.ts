/**
 * Tests for the PUT /api/v1/security/level endpoint.
 * Sprint 26: Security Level Hot-Reload.
 *
 * Validates request validation, agent loop integration, config persistence,
 * and audit logging for the security level hot-reload API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDatabase } from '../../../src/persistence/db.js';
import { registerSecurityLevelRoute } from '../../../src/gateway/api/security-level.js';
import { ConfigSchema, type Config } from '../../../src/config/schema.js';
import type { AgentLoop } from '../../../src/orchestrator/agent-loop-helpers.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';

vi.mock('../../../src/config/loader.js', () => ({
  saveConfig: vi.fn().mockResolvedValue(undefined),
  loadConfig: vi.fn(),
  homeDir: vi.fn().mockReturnValue('/tmp/test'),
  deleteConfig: vi.fn(),
}));

import { saveConfig } from '../../../src/config/loader.js';
const mockedSaveConfig = vi.mocked(saveConfig);

function createMockAgentLoop(): AgentLoop {
  return {
    processMessage: vi.fn().mockResolvedValue({
      responseText: '',
      tokensUsed: { input: 0, output: 0 },
      costUsd: 0,
      toolCallCount: 0,
      roundTrips: 0,
    }),
    updateSecurityLevel: vi.fn(),
  };
}

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('PUT /api/v1/security/level', () => {
  let app: FastifyInstance;
  let dbManager: DatabaseManager;
  let mockAgentLoop: AgentLoop;
  let config: Config;

  beforeEach(async () => {
    dbManager = createTestDb();
    mockAgentLoop = createMockAgentLoop();
    config = ConfigSchema.parse({});
    mockedSaveConfig.mockResolvedValue(undefined);

    app = Fastify({ logger: false });
    registerSecurityLevelRoute(app, dbManager.db, mockAgentLoop, config);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
    vi.clearAllMocks();
  });

  // ── Valid levels return 200 ──────────────────────────────────────

  it('returns 200 for level 1', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 1 },
    });
    expect(response.statusCode).toBe(200);
  });

  it('returns 200 for level 2', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 2 },
    });
    expect(response.statusCode).toBe(200);
  });

  it('returns 200 for level 3', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 3 },
    });
    expect(response.statusCode).toBe(200);
  });

  it('returns 200 for level 4', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 4 },
    });
    expect(response.statusCode).toBe(200);
  });

  it('returns 200 for level 5', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 5 },
    });
    expect(response.statusCode).toBe(200);
  });

  // ── Response format ─────────────────────────────────────────────

  it('returns previousLevel and currentLevel in the response body', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 5 },
    });

    const body = JSON.parse(response.body) as {
      ok: boolean;
      previousLevel: number;
      currentLevel: number;
    };
    expect(body.ok).toBe(true);
    expect(body.previousLevel).toBe(3); // default from ConfigSchema
    expect(body.currentLevel).toBe(5);
  });

  it('reflects the correct previousLevel after a prior change', async () => {
    // First change: 3 -> 1
    await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 1 },
    });

    // Second change: 1 -> 4
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 4 },
    });

    const body = JSON.parse(response.body) as {
      ok: boolean;
      previousLevel: number;
      currentLevel: number;
    };
    expect(body.previousLevel).toBe(1);
    expect(body.currentLevel).toBe(4);
  });

  // ── Agent loop integration ──────────────────────────────────────

  it('calls agentLoop.updateSecurityLevel with the correct level', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 4 },
    });

    expect(mockAgentLoop.updateSecurityLevel).toHaveBeenCalledWith(4);
    expect(mockAgentLoop.updateSecurityLevel).toHaveBeenCalledTimes(1);
  });

  // ── Config persistence ──────────────────────────────────────────

  it('calls saveConfig with the updated config', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 2 },
    });

    expect(mockedSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockedSaveConfig.mock.calls[0]![0] as Config;
    expect(savedConfig.security.level).toBe(2);
  });

  it('updates config.security.level in memory', async () => {
    expect(config.security.level).toBe(3);

    await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 5 },
    });

    expect(config.security.level).toBe(5);
  });

  // ── Audit log ───────────────────────────────────────────────────

  it('writes an audit log entry to security_log', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 4 },
    });

    const rows = dbManager.db
      .prepare('SELECT * FROM security_log WHERE action_type = ?')
      .all('security_level_change') as Array<{
      action_type: string;
      action_detail: string;
      allowed: number;
      security_level: number;
      reason: string | null;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_detail).toContain('3');
    expect(rows[0]!.action_detail).toContain('4');
    expect(rows[0]!.allowed).toBe(1);
    expect(rows[0]!.security_level).toBe(4);
  });

  // ── Invalid inputs return 400 ───────────────────────────────────

  it('returns 400 for level 0', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 0 },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBeDefined();
  });

  it('returns 400 for level 6', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 6 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for negative level', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: -1 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for string level', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 'abc' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for floating-point level', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 2.5 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when level field is missing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain('level');
  });

  // ── saveConfig failure returns 500 ──────────────────────────────

  it('returns 500 when saveConfig throws', async () => {
    mockedSaveConfig.mockRejectedValueOnce(new Error('Disk write failed'));

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 4 },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { error: string; detail: string };
    expect(body.error).toBeDefined();
    expect(body.detail).toContain('Disk write failed');
  });

  // ── Does not call updateSecurityLevel on invalid input ──────────

  it('does not call agentLoop.updateSecurityLevel for invalid level', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level: 99 },
    });

    expect(mockAgentLoop.updateSecurityLevel).not.toHaveBeenCalled();
  });
});
