/**
 * Tests for Sprint 29: Auto-TTS Chat Mode.
 *
 * Covers:
 * - generateOutboundVoice() with autoSpeak enabled
 * - Voice config API autoSpeak field (GET/PUT)
 * - Config schema autoSpeak default
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigSchema } from '../../../src/config/schema.js';
import type { Config } from '../../../src/config/schema.js';
import type { InstallTier } from '../../../src/types/index.js';
import { generateOutboundVoice } from '../../../src/voice/voice-middleware.js';
import { registerVoiceConfigRoutes } from '../../../src/gateway/api/voice-config.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../src/voice/transcriber.js', () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock('../../../src/voice/tts-router.js', () => ({
  synthesizeSpeech: vi.fn(),
  listAvailableVoices: vi.fn().mockResolvedValue([]),
  isTtsAvailable: vi.fn(),
  resetTtsCache: vi.fn(),
}));

vi.mock('../../../src/tiers/feature-gate.js', () => ({
  isFeatureEnabled: vi.fn(),
}));

vi.mock('../../../src/config/loader.js', () => ({
  saveConfig: vi.fn().mockResolvedValue(undefined),
  loadConfig: vi.fn(),
  homeDir: vi.fn().mockReturnValue('/tmp/test'),
  deleteConfig: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
  securityLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { saveConfig } from '../../../src/config/loader.js';
import { resetTtsCache } from '../../../src/voice/tts-router.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<{
  voiceEnabled: boolean;
  synthesisEnabled: boolean;
  autoSpeak: boolean;
  backend: 'say' | 'kokoro' | 'elevenlabs';
}>): Config {
  return ConfigSchema.parse({
    voice: {
      enabled: overrides?.voiceEnabled ?? true,
      transcription: {
        backend: 'groq',
        groqApiKey: 'test-key',
        language: 'en',
      },
      synthesis: {
        enabled: overrides?.synthesisEnabled ?? true,
        backend: overrides?.backend ?? 'say',
        autoSpeak: overrides?.autoSpeak ?? false,
      },
    },
  });
}

// ─── Config Schema Tests ────────────────────────────────────────────────────

describe('Config schema — autoSpeak', () => {
  it('defaults autoSpeak to false', () => {
    const config = ConfigSchema.parse({});
    expect(config.voice.synthesis.autoSpeak).toBe(false);
  });

  it('accepts autoSpeak = true', () => {
    const config = ConfigSchema.parse({
      voice: { synthesis: { autoSpeak: true } },
    });
    expect(config.voice.synthesis.autoSpeak).toBe(true);
  });

  it('accepts autoSpeak = false', () => {
    const config = ConfigSchema.parse({
      voice: { synthesis: { autoSpeak: false } },
    });
    expect(config.voice.synthesis.autoSpeak).toBe(false);
  });
});

// ─── generateOutboundVoice + autoSpeak ──────────────────────────────────────

describe('generateOutboundVoice — autoSpeak', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates audio when autoSpeak enabled even without hadAudio', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const { isTtsAvailable, synthesizeSpeech } = await import('../../../src/voice/tts-router.js');
    vi.mocked(isTtsAvailable).mockResolvedValue(true);
    vi.mocked(synthesizeSpeech).mockResolvedValue({
      audio: Buffer.alloc(2048),
      format: 'wav',
      durationSec: 1.5,
      backend: 'say',
    });

    const config = makeConfig({ autoSpeak: true });
    const result = await generateOutboundVoice('Hello world', false, config, 'full');

    expect(result.audioAttachment).not.toBeNull();
    expect(result.audioAttachment!.data.length).toBe(2048);
  });

  it('returns null when autoSpeak disabled and no audio', async () => {
    const config = makeConfig({ autoSpeak: false });
    const result = await generateOutboundVoice('Hello world', false, config, 'full');

    expect(result.audioAttachment).toBeNull();
  });

  it('generates audio when hadAudio true regardless of autoSpeak', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const { isTtsAvailable, synthesizeSpeech } = await import('../../../src/voice/tts-router.js');
    vi.mocked(isTtsAvailable).mockResolvedValue(true);
    vi.mocked(synthesizeSpeech).mockResolvedValue({
      audio: Buffer.alloc(1024),
      format: 'wav',
      durationSec: 1.0,
      backend: 'say',
    });

    const config = makeConfig({ autoSpeak: false });
    const result = await generateOutboundVoice('Hello', true, config, 'full');

    expect(result.audioAttachment).not.toBeNull();
  });

  it('returns null when voice disabled even with autoSpeak', async () => {
    const config = makeConfig({ voiceEnabled: false, autoSpeak: true });
    const result = await generateOutboundVoice('Hello', false, config, 'full');

    expect(result.audioAttachment).toBeNull();
  });

  it('returns null when synthesis disabled even with autoSpeak', async () => {
    const config = makeConfig({ synthesisEnabled: false, autoSpeak: true });
    const result = await generateOutboundVoice('Hello', false, config, 'full');

    expect(result.audioAttachment).toBeNull();
  });

  it('returns null when tier unsupported even with autoSpeak', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(false);

    const config = makeConfig({ autoSpeak: true });
    const result = await generateOutboundVoice('Hello', false, config, 'standard');

    expect(result.audioAttachment).toBeNull();
  });

  it('returns null when TTS unavailable even with autoSpeak', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const { isTtsAvailable } = await import('../../../src/voice/tts-router.js');
    vi.mocked(isTtsAvailable).mockResolvedValue(false);

    const config = makeConfig({ autoSpeak: true });
    const result = await generateOutboundVoice('Hello', false, config, 'full');

    expect(result.audioAttachment).toBeNull();
  });

  it('handles synthesis failure gracefully with autoSpeak', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const { isTtsAvailable, synthesizeSpeech } = await import('../../../src/voice/tts-router.js');
    vi.mocked(isTtsAvailable).mockResolvedValue(true);
    vi.mocked(synthesizeSpeech).mockRejectedValue(new Error('TTS crash'));

    const config = makeConfig({ autoSpeak: true });
    const result = await generateOutboundVoice('Hello', false, config, 'full');

    expect(result.audioAttachment).toBeNull();
  });
});

// ─── Voice Config API — autoSpeak field ─────────────────────────────────────

describe('Voice Config API — autoSpeak', () => {
  let app: FastifyInstance;
  let config: Config;
  const getTier = (): InstallTier => 'full';

  beforeEach(async () => {
    vi.clearAllMocks();
    config = ConfigSchema.parse({});
    app = Fastify({ logger: false });
    registerVoiceConfigRoutes(app, config, getTier);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET returns autoSpeak field in synthesis', async () => {
    const { listAvailableVoices } = await import('../../../src/voice/tts-router.js');
    vi.mocked(listAvailableVoices).mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/voice/config',
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.synthesis).toHaveProperty('autoSpeak');
    expect(body.synthesis.autoSpeak).toBe(false);
  });

  it('GET returns autoSpeak as true when enabled in config', async () => {
    const { listAvailableVoices } = await import('../../../src/voice/tts-router.js');
    vi.mocked(listAvailableVoices).mockResolvedValue([]);

    config.voice.synthesis.autoSpeak = true;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/voice/config',
    });

    const body = response.json();
    expect(body.synthesis.autoSpeak).toBe(true);
  });

  it('PUT updates autoSpeak to true', async () => {
    expect(config.voice.synthesis.autoSpeak).toBe(false);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/voice/config',
      payload: { synthesis: { autoSpeak: true } },
    });

    expect(response.statusCode).toBe(200);
    expect(config.voice.synthesis.autoSpeak).toBe(true);
    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(resetTtsCache).toHaveBeenCalledTimes(1);
  });

  it('PUT updates autoSpeak to false', async () => {
    config.voice.synthesis.autoSpeak = true;

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/voice/config',
      payload: { synthesis: { autoSpeak: false } },
    });

    expect(response.statusCode).toBe(200);
    expect(config.voice.synthesis.autoSpeak).toBe(false);
  });

  it('PUT does not change autoSpeak when not specified', async () => {
    config.voice.synthesis.autoSpeak = true;

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/voice/config',
      payload: { synthesis: { backend: 'kokoro' } },
    });

    expect(response.statusCode).toBe(200);
    expect(config.voice.synthesis.autoSpeak).toBe(true);
  });

  it('PUT rejects non-boolean autoSpeak', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/voice/config',
      payload: { synthesis: { autoSpeak: 'yes' } },
    });

    expect(response.statusCode).toBe(400);
  });

  it('PUT accepts autoSpeak with other synthesis fields', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/voice/config',
      payload: {
        synthesis: {
          backend: 'kokoro',
          kokoroSpeaker: 'bf_emma',
          autoSpeak: true,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(config.voice.synthesis.backend).toBe('kokoro');
    expect(config.voice.synthesis.kokoroSpeaker).toBe('bf_emma');
    expect(config.voice.synthesis.autoSpeak).toBe(true);
  });
});
