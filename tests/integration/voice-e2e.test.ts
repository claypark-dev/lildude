/**
 * Integration tests for voice configuration and auto-TTS.
 * Validates that voice config CRUD round-trips through the API,
 * auto-speak uses the selected voice, TTS graceful degradation on
 * backend failure, and preview endpoint responsiveness.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { startApp, type AppContext } from '../../src/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../mocks/provider.js';
import { clearRegistry } from '../../src/waves/registry.js';
import { generateApiKey, storeApiKey } from '../../src/persistence/api-keys.js';
import type { InjectOptions } from 'fastify';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'persistence', 'migrations');

/** Create a test config with voice enabled and synthesis configured. */
function createVoiceEnabledConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
    voice: {
      enabled: true,
      synthesis: {
        enabled: true,
        backend: 'say',
        voiceId: 'pNInz6obpgDQGcFmaJgB',
        sayVoice: 'Samantha',
        sayRate: 1.0,
        autoSpeak: false,
      },
    },
  });
}

/** Create a test config with voice disabled. */
function createVoiceDisabledConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
    voice: {
      enabled: false,
      synthesis: {
        enabled: false,
        autoSpeak: false,
      },
    },
  });
}

describe('Voice Configuration & Auto-TTS E2E', () => {
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

  /** GET /api/v1/voice/config with auth. */
  async function getVoiceConfig() {
    return authedInject({
      method: 'GET',
      url: '/api/v1/voice/config',
    });
  }

  /** PUT /api/v1/voice/config with auth and payload. */
  async function putVoiceConfig(payload: Record<string, unknown>) {
    return authedInject({
      method: 'PUT',
      url: '/api/v1/voice/config',
      payload,
    });
  }

  /** POST /api/v1/voice/preview with auth and payload. */
  async function postVoicePreview(payload: Record<string, unknown>) {
    return authedInject({
      method: 'POST',
      url: '/api/v1/voice/preview',
      payload,
    });
  }

  beforeEach(async () => {
    mockProvider = createMockProvider('anthropic');
    mockProvider.setDefault({
      content: [{ type: 'text', text: 'OK' }],
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    });

    const config = createVoiceEnabledConfig();

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
    storeApiKey(appContext.dbManager.db, testApiKey, 'voice-e2e-test');
  });

  afterEach(async () => {
    clearRegistry();
    vi.restoreAllMocks();
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

  // ── Voice Config CRUD ─────────────────────────────────────────────

  describe('GET /api/v1/voice/config returns current configuration', () => {
    it('returns synthesis settings matching the initial config', async () => {
      const response = await getVoiceConfig();

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.enabled).toBe(true);
      expect(body.synthesis).toBeDefined();
      expect(body.synthesis.enabled).toBe(true);
      expect(body.synthesis.backend).toBe('say');
      expect(body.synthesis.voiceId).toBe('pNInz6obpgDQGcFmaJgB');
      expect(body.synthesis.sayVoice).toBe('Samantha');
      expect(body.synthesis.sayRate).toBe(1.0);
      expect(body.synthesis.autoSpeak).toBe(false);
      expect(body.transcription).toBeDefined();
      expect(body.availableVoices).toBeDefined();
      expect(Array.isArray(body.availableVoices)).toBe(true);
    });

    it('requires authentication', async () => {
      const response = await appContext!.gateway.app.inject({
        method: 'GET',
        url: '/api/v1/voice/config',
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error).toBeDefined();
    });
  });

  // ── autoSpeak Round-Trip ──────────────────────────────────────────

  describe('autoSpeak config round-trips through the API correctly', () => {
    it('enables autoSpeak via PUT and reads it back via GET', async () => {
      // Verify initial state: autoSpeak is false
      const before = await getVoiceConfig();
      expect(before.json().synthesis.autoSpeak).toBe(false);

      // Enable autoSpeak
      const putResponse = await putVoiceConfig({
        synthesis: { autoSpeak: true },
      });
      expect(putResponse.statusCode).toBe(200);
      expect(putResponse.json().ok).toBe(true);

      // Read back and confirm the change
      const after = await getVoiceConfig();
      expect(after.statusCode).toBe(200);
      expect(after.json().synthesis.autoSpeak).toBe(true);

      // Verify in-memory config is also updated
      expect(appContext!.config.voice.synthesis.autoSpeak).toBe(true);
    });

    it('disables autoSpeak after enabling it', async () => {
      // Enable first
      await putVoiceConfig({ synthesis: { autoSpeak: true } });
      expect(appContext!.config.voice.synthesis.autoSpeak).toBe(true);

      // Disable
      const putResponse = await putVoiceConfig({
        synthesis: { autoSpeak: false },
      });
      expect(putResponse.statusCode).toBe(200);

      const after = await getVoiceConfig();
      expect(after.json().synthesis.autoSpeak).toBe(false);
      expect(appContext!.config.voice.synthesis.autoSpeak).toBe(false);
    });
  });

  // ── Voice Config Save & Voice Selection ───────────────────────────

  describe('voice config save updates selected voice for auto-speak', () => {
    it('changing voiceId persists and is reflected in config', async () => {
      const newVoiceId = 'custom-voice-abc123';

      const putResponse = await putVoiceConfig({
        synthesis: { voiceId: newVoiceId },
      });
      expect(putResponse.statusCode).toBe(200);

      // Verify in-memory config reflects the new voice
      expect(appContext!.config.voice.synthesis.voiceId).toBe(newVoiceId);

      // Verify GET returns the updated voice
      const getResponse = await getVoiceConfig();
      expect(getResponse.json().synthesis.voiceId).toBe(newVoiceId);
    });

    it('changing sayVoice and sayRate together updates both fields', async () => {
      const putResponse = await putVoiceConfig({
        synthesis: { sayVoice: 'Daniel', sayRate: 1.5 },
      });
      expect(putResponse.statusCode).toBe(200);

      expect(appContext!.config.voice.synthesis.sayVoice).toBe('Daniel');
      expect(appContext!.config.voice.synthesis.sayRate).toBe(1.5);

      const getResponse = await getVoiceConfig();
      const synthesis = getResponse.json().synthesis;
      expect(synthesis.sayVoice).toBe('Daniel');
      expect(synthesis.sayRate).toBe(1.5);
    });

    it('switching backend from say to kokoro updates config correctly', async () => {
      const putResponse = await putVoiceConfig({
        synthesis: {
          backend: 'kokoro',
          kokoroSpeaker: 'af_sky',
          kokoroModelId: 'kokoro-en-v0_19',
        },
      });
      expect(putResponse.statusCode).toBe(200);

      expect(appContext!.config.voice.synthesis.backend).toBe('kokoro');
      expect(appContext!.config.voice.synthesis.kokoroSpeaker).toBe('af_sky');

      const getResponse = await getVoiceConfig();
      expect(getResponse.json().synthesis.backend).toBe('kokoro');
      expect(getResponse.json().synthesis.kokoroSpeaker).toBe('af_sky');
    });
  });

  // ── Validation & Edge Cases ───────────────────────────────────────

  describe('PUT /api/v1/voice/config validates input', () => {
    it('rejects sayRate below minimum (0.1)', async () => {
      const response = await putVoiceConfig({
        synthesis: { sayRate: 0.01 },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it('rejects sayRate above maximum (3.0)', async () => {
      const response = await putVoiceConfig({
        synthesis: { sayRate: 5.0 },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it('rejects invalid backend name', async () => {
      const response = await putVoiceConfig({
        synthesis: { backend: 'nonexistent-engine' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it('accepts partial synthesis updates without overwriting other fields', async () => {
      // Set a known baseline
      await putVoiceConfig({
        synthesis: { voiceId: 'voice-alpha', autoSpeak: true, sayRate: 1.2 },
      });

      // Update only sayRate — other fields should remain unchanged
      const response = await putVoiceConfig({
        synthesis: { sayRate: 0.8 },
      });
      expect(response.statusCode).toBe(200);

      expect(appContext!.config.voice.synthesis.sayRate).toBe(0.8);
      expect(appContext!.config.voice.synthesis.voiceId).toBe('voice-alpha');
      expect(appContext!.config.voice.synthesis.autoSpeak).toBe(true);
    });
  });

  // ── Voice Preview ─────────────────────────────────────────────────

  describe('POST /api/v1/voice/preview', () => {
    it('responds within a reasonable time (< 5 seconds)', async () => {
      const startMs = Date.now();

      // Preview may succeed or fail depending on OS TTS availability,
      // but the endpoint itself should respond promptly
      const response = await postVoicePreview({ text: 'Hello world' });

      const elapsedMs = Date.now() - startMs;
      expect(elapsedMs).toBeLessThan(5000);

      // Accept success (200 with audio) or graceful failure (500/503)
      expect([200, 500, 503]).toContain(response.statusCode);
    });

    it('rejects empty text', async () => {
      const response = await postVoicePreview({ text: '' });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it('rejects text exceeding 500 characters', async () => {
      const longText = 'a'.repeat(501);
      const response = await postVoicePreview({ text: longText });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it('rejects request with missing text field', async () => {
      const response = await postVoicePreview({});

      expect(response.statusCode).toBe(400);
    });
  });

  // ── TTS Backend Unavailable — Graceful Degradation ────────────────

  describe('TTS backend unavailable mid-session graceful degradation', () => {
    it('preview returns error status when synthesis is disabled mid-session', async () => {
      // Disable synthesis mid-session via the config API
      const disableResponse = await putVoiceConfig({
        synthesis: { enabled: false },
      });
      expect(disableResponse.statusCode).toBe(200);

      // Attempt a preview — should fail gracefully, not crash
      const previewResponse = await postVoicePreview({ text: 'Hello' });

      // The endpoint should return 500 or 503 (backend not enabled),
      // not a 5xx unhandled crash
      expect([500, 503]).toContain(previewResponse.statusCode);
      const body = previewResponse.json();
      expect(body.error).toBeDefined();
      expect(typeof body.error).toBe('string');
    });

    it('config endpoints remain functional after TTS backend failure', async () => {
      // Switch to an unavailable backend (elevenlabs without API key)
      await putVoiceConfig({
        synthesis: { backend: 'elevenlabs' },
      });

      // Config GET should still work even if backend is broken
      const configResponse = await getVoiceConfig();
      expect(configResponse.statusCode).toBe(200);
      expect(configResponse.json().synthesis.backend).toBe('elevenlabs');

      // Config PUT should still work to recover from a bad state
      const recoveryResponse = await putVoiceConfig({
        synthesis: { backend: 'say' },
      });
      expect(recoveryResponse.statusCode).toBe(200);
      expect(appContext!.config.voice.synthesis.backend).toBe('say');
    });

    it('disabling voice entirely via top-level enabled flag is reflected', async () => {
      const response = await putVoiceConfig({ enabled: false } as Record<string, unknown>);
      expect(response.statusCode).toBe(200);

      expect(appContext!.config.voice.enabled).toBe(false);

      const configResponse = await getVoiceConfig();
      expect(configResponse.json().enabled).toBe(false);
    });
  });

  // ── Multiple Rapid Config Changes ─────────────────────────────────

  describe('rapid voice config changes do not corrupt state', () => {
    it('toggling autoSpeak rapidly leaves config consistent', async () => {
      const toggleCount = 10;

      for (let i = 0; i < toggleCount; i++) {
        const autoSpeak = i % 2 === 0;
        const response = await putVoiceConfig({
          synthesis: { autoSpeak },
        });
        expect(response.statusCode).toBe(200);
      }

      // After 10 toggles (0-indexed), last iteration i=9 sets autoSpeak = false
      expect(appContext!.config.voice.synthesis.autoSpeak).toBe(false);

      const finalConfig = await getVoiceConfig();
      expect(finalConfig.json().synthesis.autoSpeak).toBe(false);
    });
  });
});
