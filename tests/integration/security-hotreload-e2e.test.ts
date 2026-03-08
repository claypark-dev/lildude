/**
 * Integration tests for security level hot-reload.
 * Validates that changing the security level via the REST API updates
 * the agent loop immediately, enforces wave permissions correctly,
 * doesn't crash during active processing, and handles rapid changes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { startApp, type AppContext } from '../../src/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../mocks/provider.js';
import { clearRegistry } from '../../src/waves/registry.js';
import { generateApiKey, storeApiKey } from '../../src/persistence/api-keys.js';
import { checkWaveSafety } from '../../src/waves/safety.js';
import { checkCommand } from '../../src/security/permissions.js';
import type { ChatResponse } from '../../src/types/index.js';
import type { InjectOptions } from 'fastify';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'persistence', 'migrations');

/** Build a mock ChatResponse with the given text and token counts. */
function buildResponse(text: string, inputTokens: number, outputTokens: number): ChatResponse {
  return {
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens, outputTokens },
    stopReason: 'end_turn',
  };
}

/** Create a minimal test config with security level defaulting to 3. */
function createTestConfig(securityLevel: number = 3) {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
    security: { level: securityLevel },
  });
}

describe('Security Level Hot-Reload E2E', () => {
  let appContext: AppContext | undefined;
  let mockProvider: MockProvider;
  let testApiKey: string;

  /** Helper to inject requests with the test API key auth header. */
  function authedInject(opts: InjectOptions) {
    return appContext!.gateway.app.inject({
      ...opts,
      headers: {
        ...opts.headers,
        authorization: `Bearer ${testApiKey}`,
      },
    });
  }

  /** Change the security level via the REST API and return the response. */
  async function changeSecurityLevel(level: number) {
    return authedInject({
      method: 'PUT',
      url: '/api/v1/security/level',
      payload: { level },
    });
  }

  beforeEach(async () => {
    mockProvider = createMockProvider('anthropic');
    mockProvider.setDefault(buildResponse('OK', 10, 5));

    const config = createTestConfig(3);

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    // Clear community waves so they don't interfere with tests
    clearRegistry();

    // Create and store a test API key for authenticated requests
    testApiKey = generateApiKey();
    storeApiKey(appContext.dbManager.db, testApiKey, 'security-hotreload-test');
  });

  afterEach(async () => {
    clearRegistry();
    if (appContext) {
      try {
        await appContext.gateway.stop();
      } catch {
        // best-effort cleanup
      }
      try {
        appContext.dbManager.close();
      } catch {
        // best-effort cleanup
      }
      appContext = undefined;
    }
  });

  // ── Basic Hot-Reload ──────────────────────────────────────────────

  describe('PUT /api/v1/security/level updates agent loop immediately', () => {
    it('changes security level from 3 to 5 and reflects in config', async () => {
      expect(appContext!.config.security.level).toBe(3);

      const response = await changeSecurityLevel(5);

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.previousLevel).toBe(3);
      expect(body.currentLevel).toBe(5);

      // Verify the in-memory config was updated
      expect(appContext!.config.security.level).toBe(5);
    });

    it('changes security level from 3 to 1 (most restrictive)', async () => {
      const response = await changeSecurityLevel(1);

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.previousLevel).toBe(3);
      expect(body.currentLevel).toBe(1);
      expect(appContext!.config.security.level).toBe(1);
    });

    it('rejects invalid security level 0', async () => {
      const response = await changeSecurityLevel(0);

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it('rejects invalid security level 6', async () => {
      const response = await changeSecurityLevel(6);

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it('requires authentication', async () => {
      const response = await appContext!.gateway.app.inject({
        method: 'PUT',
        url: '/api/v1/security/level',
        payload: { level: 5 },
      });

      // Should be rejected without auth header (401 or 403)
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
    });
  });

  // ── Wave Permission Enforcement ───────────────────────────────────

  describe('wave permission enforcement updates after security level change', () => {
    it('destroy-tier wave is blocked at security level 1 but allowed at level 5', async () => {
      // At level 3, destroy-tier for a non-small model requires confirmation
      const resultLevel3 = checkWaveSafety('destroy', 'medium', 3);
      expect(resultLevel3.decision).toBe('confirm');

      // Change to level 1 (most restrictive)
      await changeSecurityLevel(1);

      const resultLevel1 = checkWaveSafety('destroy', 'medium', appContext!.config.security.level);
      expect(resultLevel1.decision).toBe('block');

      // Change to level 5 (most permissive)
      await changeSecurityLevel(5);

      const resultLevel5 = checkWaveSafety('destroy', 'medium', appContext!.config.security.level);
      expect(resultLevel5.decision).toBe('allow');
    });

    it('modify-tier wave with small model transitions correctly across levels', async () => {
      // Level 3: modify + small = confirm
      const resultLevel3 = checkWaveSafety('modify', 'small', appContext!.config.security.level);
      expect(resultLevel3.decision).toBe('confirm');

      // Level 1: modify + small = block
      await changeSecurityLevel(1);
      const resultLevel1 = checkWaveSafety('modify', 'small', appContext!.config.security.level);
      expect(resultLevel1.decision).toBe('block');

      // Level 5: modify + small = allow
      await changeSecurityLevel(5);
      const resultLevel5 = checkWaveSafety('modify', 'small', appContext!.config.security.level);
      expect(resultLevel5.decision).toBe('allow');
    });

    it('shell commands are blocked at level 1 after hot-reload from level 3', async () => {
      // At level 3, a safe command like 'ls' should be allowed
      const resultLevel3 = checkCommand('ls', { securityLevel: appContext!.config.security.level as 1 | 2 | 3 | 4 | 5 });
      expect(resultLevel3.decision).not.toBe('deny');

      // Hot-reload to level 1 — all shell commands blocked
      await changeSecurityLevel(1);

      const resultLevel1 = checkCommand('ls', { securityLevel: appContext!.config.security.level as 1 | 2 | 3 | 4 | 5 });
      expect(resultLevel1.decision).toBe('deny');
      expect(resultLevel1.reason).toContain('level 1');
    });
  });

  // ── Processing During Security Change ─────────────────────────────

  describe('security change during active processing does not crash', () => {
    it('agent loop continues after security level change mid-flight', async () => {
      mockProvider.setDefault(buildResponse('Response after security change', 50, 25));

      // Start processing a message
      const processingPromise = appContext!.agentLoop.processMessage(
        'conv-mid-change',
        'Hello during security change',
        'webchat',
      );

      // Change security level while processing is in flight
      const changeResponse = await changeSecurityLevel(5);
      expect(changeResponse.statusCode).toBe(200);

      // The processing should complete without crashing
      const result = await processingPromise;
      expect(result.responseText).toBeDefined();
      expect(result.responseText.length).toBeGreaterThan(0);
      expect(result.roundTrips).toBeGreaterThanOrEqual(1);
    });

    it('sequential messages work after security level change', async () => {
      mockProvider.setDefault(buildResponse('Before change', 20, 10));

      // Process a message at level 3
      const result1 = await appContext!.agentLoop.processMessage(
        'conv-sequential',
        'First message at level 3',
        'webchat',
      );
      expect(result1.responseText).toBe('Before change');

      // Change security level to 5
      await changeSecurityLevel(5);

      mockProvider.setDefault(buildResponse('After change', 20, 10));

      // Process another message at level 5 — should not crash
      const result2 = await appContext!.agentLoop.processMessage(
        'conv-sequential',
        'Second message at level 5',
        'webchat',
      );
      expect(result2.responseText).toBe('After change');

      // Verify the provider was called for both messages
      expect(mockProvider.getCalls().length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Rapid Security Level Changes ──────────────────────────────────

  describe('rapid security level changes do not corrupt state', () => {
    it('cycling through all levels 1-5 rapidly leaves config consistent', async () => {
      for (let level = 1; level <= 5; level++) {
        const response = await changeSecurityLevel(level);
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.currentLevel).toBe(level);
      }

      // Final state should be level 5
      expect(appContext!.config.security.level).toBe(5);

      // Agent loop should still be functional
      mockProvider.setDefault(buildResponse('After rapid changes', 15, 8));
      const result = await appContext!.agentLoop.processMessage(
        'conv-rapid',
        'Still working?',
        'webchat',
      );
      expect(result.responseText).toBe('After rapid changes');
    });

    it('toggling between 1 and 5 rapidly does not corrupt state', async () => {
      const toggleCount = 20;
      for (let i = 0; i < toggleCount; i++) {
        const level = i % 2 === 0 ? 1 : 5;
        const response = await changeSecurityLevel(level);
        expect(response.statusCode).toBe(200);
      }

      // After even number of toggles, we end on level 1
      // (0→1, 1→5, 2→1, 3→5 ... 18→1, 19→5) — last is level 5
      expect(appContext!.config.security.level).toBe(5);

      // Verify the config and wave safety are consistent
      const safetyResult = checkWaveSafety('observe', 'small', appContext!.config.security.level);
      expect(safetyResult.decision).toBe('allow');
    });

    it('concurrent security level changes via API all succeed', async () => {
      // Fire multiple concurrent requests — all should succeed without error
      const changePromises = [
        changeSecurityLevel(2),
        changeSecurityLevel(4),
        changeSecurityLevel(1),
        changeSecurityLevel(5),
        changeSecurityLevel(3),
      ];

      const responses = await Promise.all(changePromises);

      // All should return 200
      for (const response of responses) {
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.ok).toBe(true);
        expect(body.currentLevel).toBeGreaterThanOrEqual(1);
        expect(body.currentLevel).toBeLessThanOrEqual(5);
      }

      // Config should be at one of the valid levels (whichever resolved last)
      const finalLevel = appContext!.config.security.level;
      expect(finalLevel).toBeGreaterThanOrEqual(1);
      expect(finalLevel).toBeLessThanOrEqual(5);

      // Agent loop should still be operational
      mockProvider.setDefault(buildResponse('Post-concurrent', 10, 5));
      const result = await appContext!.agentLoop.processMessage(
        'conv-concurrent',
        'Are we still ok?',
        'webchat',
      );
      expect(result.responseText).toBe('Post-concurrent');
    });
  });
});
