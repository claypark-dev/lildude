/**
 * Tests for Sprint 28: Voice Settings Panel — voice-config API routes.
 *
 * Covers:
 * - GET  /api/v1/voice/config  (retrieve full voice config + available voices)
 * - PUT  /api/v1/voice/config  (update voice config, persist, reset TTS cache)
 * - POST /api/v1/voice/preview (text-to-speech preview)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerVoiceConfigRoutes } from '../../../src/gateway/api/voice-config.js';
import { ConfigSchema } from '../../../src/config/schema.js';
import type { Config } from '../../../src/config/schema.js';
import type { InstallTier } from '../../../src/types/index.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../src/config/loader.js', () => ({
  saveConfig: vi.fn().mockResolvedValue(undefined),
  loadConfig: vi.fn(),
  homeDir: vi.fn().mockReturnValue('/tmp/test'),
  deleteConfig: vi.fn(),
}));

vi.mock('../../../src/voice/tts-router.js', () => ({
  synthesizeSpeech: vi.fn(),
  listAvailableVoices: vi.fn(),
  isTtsAvailable: vi.fn(),
  resetTtsCache: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  createModuleLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Re-import mocked modules for assertions ───────────────────────────────

import { saveConfig } from '../../../src/config/loader.js';
import {
  synthesizeSpeech,
  listAvailableVoices,
  resetTtsCache,
} from '../../../src/voice/tts-router.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function freshConfig(): Config {
  return ConfigSchema.parse({});
}

const MOCK_VOICES = [
  { id: 'samantha', name: 'Samantha', language: 'en', gender: 'female' as const },
  { id: 'daniel', name: 'Daniel', language: 'en', gender: 'male' as const },
];

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('Voice Config API routes', () => {
  let app: FastifyInstance;
  let config: Config;
  const getTier = (): InstallTier => 'full';

  beforeEach(async () => {
    vi.clearAllMocks();
    config = freshConfig();
    app = Fastify({ logger: false });
    registerVoiceConfigRoutes(app, config, getTier);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  GET /api/v1/voice/config
  // ─────────────────────────────────────────────────────────────────────────

  describe('GET /api/v1/voice/config', () => {
    it('returns 200 with the expected voice config shape', async () => {
      vi.mocked(listAvailableVoices).mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/voice/config',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('enabled');
      expect(body).toHaveProperty('synthesis');
      expect(body).toHaveProperty('transcription');
      expect(body).toHaveProperty('availableVoices');
      expect(body.synthesis).toHaveProperty('enabled');
      expect(body.synthesis).toHaveProperty('backend');
      expect(body.synthesis).toHaveProperty('voiceId');
      expect(body.synthesis).toHaveProperty('sayVoice');
      expect(body.synthesis).toHaveProperty('sayRate');
      expect(body.synthesis).toHaveProperty('kokoroSpeaker');
      expect(body.synthesis).toHaveProperty('kokoroModelId');
      expect(body.transcription).toHaveProperty('backend');
      expect(body.transcription).toHaveProperty('language');
    });

    it('returns correct default values from ConfigSchema', async () => {
      vi.mocked(listAvailableVoices).mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/voice/config',
      });

      const body = response.json();
      expect(body.enabled).toBe(false);
      expect(body.synthesis.enabled).toBe(false);
      expect(body.synthesis.backend).toBe('say');
      expect(body.synthesis.voiceId).toBe('pNInz6obpgDQGcFmaJgB');
      expect(body.synthesis.sayVoice).toBeNull();
      expect(body.synthesis.sayRate).toBe(1.0);
      expect(body.synthesis.kokoroSpeaker).toBe('af_heart');
      expect(body.synthesis.kokoroModelId).toBe('kokoro-en-v0_19');
      expect(body.transcription.backend).toBe('groq');
      expect(body.transcription.language).toBe('en');
    });

    it('returns available voices from the backend', async () => {
      vi.mocked(listAvailableVoices).mockResolvedValue(MOCK_VOICES);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/voice/config',
      });

      const body = response.json();
      expect(body.availableVoices).toEqual(MOCK_VOICES);
      expect(body.availableVoices).toHaveLength(2);
    });

    it('returns hasElevenLabsApiKey and hasGroqApiKey booleans', async () => {
      vi.mocked(listAvailableVoices).mockResolvedValue([]);

      // Defaults: no API keys set -> false
      const responseBefore = await app.inject({
        method: 'GET',
        url: '/api/v1/voice/config',
      });
      const bodyBefore = responseBefore.json();
      expect(bodyBefore.synthesis.hasElevenLabsApiKey).toBe(false);
      expect(bodyBefore.transcription.hasGroqApiKey).toBe(false);

      // Set API keys on config
      config.voice.synthesis.elevenLabsApiKey = 'sk-eleven-test';
      config.voice.transcription.groqApiKey = 'gsk-groq-test';

      const responseAfter = await app.inject({
        method: 'GET',
        url: '/api/v1/voice/config',
      });
      const bodyAfter = responseAfter.json();
      expect(bodyAfter.synthesis.hasElevenLabsApiKey).toBe(true);
      expect(bodyAfter.transcription.hasGroqApiKey).toBe(true);
    });

    it('returns empty voices array when listAvailableVoices fails', async () => {
      vi.mocked(listAvailableVoices).mockRejectedValue(
        new Error('Backend unavailable'),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/voice/config',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.availableVoices).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  PUT /api/v1/voice/config
  // ─────────────────────────────────────────────────────────────────────────

  describe('PUT /api/v1/voice/config', () => {
    it('returns 200 and updates config.voice.enabled', async () => {
      expect(config.voice.enabled).toBe(false);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: { enabled: true },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.voice.enabled).toBe(true);
      expect(config.voice.enabled).toBe(true);
    });

    it('updates synthesis backend', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: { synthesis: { backend: 'kokoro' } },
      });

      expect(response.statusCode).toBe(200);
      expect(config.voice.synthesis.backend).toBe('kokoro');
      expect(response.json().voice.synthesis.backend).toBe('kokoro');
    });

    it('updates sayVoice and sayRate', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: {
          synthesis: { sayVoice: 'Samantha', sayRate: 1.5 },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(config.voice.synthesis.sayVoice).toBe('Samantha');
      expect(config.voice.synthesis.sayRate).toBe(1.5);
    });

    it('updates kokoroSpeaker', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: { synthesis: { kokoroSpeaker: 'bf_emma' } },
      });

      expect(response.statusCode).toBe(200);
      expect(config.voice.synthesis.kokoroSpeaker).toBe('bf_emma');
    });

    it('calls saveConfig with updated config', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: { enabled: true },
      });

      expect(saveConfig).toHaveBeenCalledTimes(1);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          voice: expect.objectContaining({ enabled: true }),
        }),
      );
    });

    it('calls resetTtsCache after update', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: { synthesis: { backend: 'kokoro' } },
      });

      expect(resetTtsCache).toHaveBeenCalledTimes(1);
    });

    it('returns 400 for invalid backend value', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: { synthesis: { backend: 'invalid-backend' } },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error).toContain('synthesis.backend');
    });

    it('returns 400 for sayRate out of range', async () => {
      // sayRate too high (max 3.0)
      const responseTooHigh = await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: { synthesis: { sayRate: 5.0 } },
      });
      expect(responseTooHigh.statusCode).toBe(400);

      // sayRate too low (min 0.1)
      const responseTooLow = await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: { synthesis: { sayRate: 0.0 } },
      });
      expect(responseTooLow.statusCode).toBe(400);
    });

    it('partially updates only the specified fields', async () => {
      // Set an initial state
      config.voice.enabled = true;
      config.voice.synthesis.backend = 'say';
      config.voice.synthesis.sayVoice = 'Samantha';
      config.voice.synthesis.sayRate = 1.2;

      // Only update sayRate, leave everything else
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: { synthesis: { sayRate: 2.0 } },
      });

      expect(response.statusCode).toBe(200);
      // Changed field
      expect(config.voice.synthesis.sayRate).toBe(2.0);
      // Unchanged fields
      expect(config.voice.enabled).toBe(true);
      expect(config.voice.synthesis.backend).toBe('say');
      expect(config.voice.synthesis.sayVoice).toBe('Samantha');
    });

    it('returns 500 when saveConfig throws', async () => {
      vi.mocked(saveConfig).mockRejectedValueOnce(
        new Error('Disk write failed'),
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/voice/config',
        payload: { enabled: true },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe('Failed to save voice config');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  POST /api/v1/voice/preview
  // ─────────────────────────────────────────────────────────────────────────

  describe('POST /api/v1/voice/preview', () => {
    it('returns 200 with audio binary when synthesis succeeds', async () => {
      const fakeAudio = Buffer.from('fake-wav-data');
      vi.mocked(synthesizeSpeech).mockResolvedValue({
        audio: fakeAudio,
        format: 'wav',
        durationSec: 1.5,
        backend: 'say',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/voice/preview',
        payload: { text: 'Hello world' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(fakeAudio);
      expect(synthesizeSpeech).toHaveBeenCalledWith(
        config,
        'Hello world',
        'full',
        undefined,
      );
    });

    it('returns correct Content-Type header for wav format', async () => {
      const fakeAudio = Buffer.from('fake-wav-data');
      vi.mocked(synthesizeSpeech).mockResolvedValue({
        audio: fakeAudio,
        format: 'wav',
        durationSec: 1.0,
        backend: 'say',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/voice/preview',
        payload: { text: 'Test audio' },
      });

      expect(response.headers['content-type']).toBe('audio/wav');
      expect(response.headers['content-length']).toBe(String(fakeAudio.length));
    });

    it('returns correct Content-Type header for mp3 format', async () => {
      const fakeAudio = Buffer.from('fake-mp3-data');
      vi.mocked(synthesizeSpeech).mockResolvedValue({
        audio: fakeAudio,
        format: 'mp3',
        durationSec: 2.0,
        backend: 'elevenlabs',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/voice/preview',
        payload: { text: 'Test audio mp3' },
      });

      expect(response.headers['content-type']).toBe('audio/mpeg');
    });

    it('returns 400 for empty text', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/voice/preview',
        payload: { text: '' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it('returns 400 for text exceeding 500 characters', async () => {
      const longText = 'A'.repeat(501);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/voice/preview',
        payload: { text: longText },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('max 500');
    });

    it('returns 500 when synthesizeSpeech throws', async () => {
      vi.mocked(synthesizeSpeech).mockRejectedValue(
        new Error('Backend crashed'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/voice/preview',
        payload: { text: 'Hello' },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toContain('Preview failed');
      expect(body.error).toContain('Backend crashed');
    });
  });
});
