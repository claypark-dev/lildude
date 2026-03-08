/**
 * Tests for the agent loop's updateSecurityLevel hot-reload method.
 * Sprint 26: Security Level Hot-Reload.
 *
 * Verifies that updateSecurityLevel mutates deps.securityLevel at runtime
 * and that the updated level is visible to subsequent processMessage calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { createAgentLoop } from '../../../src/orchestrator/agent-loop.js';
import type { AgentLoop, AgentLoopDeps } from '../../../src/orchestrator/agent-loop-helpers.js';
import type { SecurityLevel } from '../../../src/security/permissions.js';
import type { LLMProvider } from '../../../src/types/index.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';

function createMockProvider(): LLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello' }],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
      model: 'mock-model',
    }),
    listModels: vi.fn().mockResolvedValue([]),
  };
}

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('AgentLoop.updateSecurityLevel', () => {
  let dbManager: DatabaseManager;
  let deps: AgentLoopDeps;
  let agentLoop: AgentLoop;

  beforeEach(() => {
    dbManager = createTestDb();
    deps = {
      db: dbManager.db,
      provider: createMockProvider(),
      securityLevel: 3 as SecurityLevel,
      userName: 'TestUser',
      monthlyBudgetUsd: 20,
    };
    agentLoop = createAgentLoop(deps);
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  // ── Basic mutation ──────────────────────────────────────────────

  it('changes deps.securityLevel when called with a new level', () => {
    expect(deps.securityLevel).toBe(3);
    agentLoop.updateSecurityLevel(5);
    expect(deps.securityLevel).toBe(5);
  });

  it('does not throw when called with the current level', () => {
    expect(() => agentLoop.updateSecurityLevel(3)).not.toThrow();
    expect(deps.securityLevel).toBe(3);
  });

  // ── Each valid level (1-5) ──────────────────────────────────────

  it('accepts level 1', () => {
    agentLoop.updateSecurityLevel(1);
    expect(deps.securityLevel).toBe(1);
  });

  it('accepts level 2', () => {
    agentLoop.updateSecurityLevel(2);
    expect(deps.securityLevel).toBe(2);
  });

  it('accepts level 3', () => {
    agentLoop.updateSecurityLevel(3);
    expect(deps.securityLevel).toBe(3);
  });

  it('accepts level 4', () => {
    agentLoop.updateSecurityLevel(4);
    expect(deps.securityLevel).toBe(4);
  });

  it('accepts level 5', () => {
    agentLoop.updateSecurityLevel(5);
    expect(deps.securityLevel).toBe(5);
  });

  // ── Sequential changes ──────────────────────────────────────────

  it('supports multiple sequential updates', () => {
    agentLoop.updateSecurityLevel(1);
    expect(deps.securityLevel).toBe(1);

    agentLoop.updateSecurityLevel(4);
    expect(deps.securityLevel).toBe(4);

    agentLoop.updateSecurityLevel(2);
    expect(deps.securityLevel).toBe(2);
  });

  it('persists the last level after cycling through all levels', () => {
    const levels: SecurityLevel[] = [1, 2, 3, 4, 5];
    for (const level of levels) {
      agentLoop.updateSecurityLevel(level);
    }
    expect(deps.securityLevel).toBe(5);
  });

  // ── Persistence across processMessage calls ─────────────────────

  it('updated level is observable via deps after processMessage returns', async () => {
    agentLoop.updateSecurityLevel(1);

    // processMessage reads deps.securityLevel internally. The mock provider
    // short-circuits the LLM call so this completes quickly.
    await agentLoop.processMessage('conv-sec-1', 'hello', 'webchat');

    // deps.securityLevel should still reflect the hot-reloaded value
    expect(deps.securityLevel).toBe(1);
  });

  it('level change between two processMessage calls is reflected in deps', async () => {
    agentLoop.updateSecurityLevel(2);
    await agentLoop.processMessage('conv-sec-2', 'first message', 'webchat');
    expect(deps.securityLevel).toBe(2);

    agentLoop.updateSecurityLevel(5);
    await agentLoop.processMessage('conv-sec-3', 'second message', 'webchat');
    expect(deps.securityLevel).toBe(5);
  });
});
