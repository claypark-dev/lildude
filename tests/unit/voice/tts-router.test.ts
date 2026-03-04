/**
 * Unit tests for the TTS router (tts-router).
 * Mocks tts-say, tts-kokoro, and feature-gate modules to isolate
 * the routing logic, caching, tier gating, and fallback behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ------------------------------------------------------------------ */
/* Module mocks — must be declared before the import under test       */
/* ------------------------------------------------------------------ */

/** Mock say backend factory. */
const mockCreateSayBackend = vi.fn();

/** Mock kokoro backend factory. */
const mockCreateKokoroBackend = vi.fn();

/** Mock feature gate. */
const mockIsFeatureEnabled = vi.fn();

vi.mock('../../../src/voice/tts-say.js', () => ({
  createSayBackend: (...args: unknown[]) => mockCreateSayBackend(...args),
}));

vi.mock('../../../src/voice/tts-kokoro.js', () => ({
  createKokoroBackend: (...args: unknown[]) => mockCreateKokoroBackend(...args),
}));

vi.mock('../../../src/tiers/feature-gate.js', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

/* ------------------------------------------------------------------ */
/* Imports — resolved after mocks are wired                           */
/* ------------------------------------------------------------------ */

import {
  getTtsBackend,
  synthesizeSpeech,
  listAvailableVoices,
  isTtsAvailable,
  resetTtsCache,
} from '../../../src/voice/tts-router.js';
import { ConfigSchema } from '../../../src/config/schema.js';
import type { Config } from '../../../src/config/schema.js';
import type {
  TtsBackend,
  TtsSynthesizeResult,
  TtsVoiceInfo,
} from '../../../src/voice/types.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build a Config with voice settings overridden. */
function makeConfig(overrides: {
  voiceEnabled?: boolean;
  synthesisEnabled?: boolean;
  backend?: 'say' | 'kokoro' | 'elevenlabs';
  sayVoice?: string;
  sayRate?: number;
  kokoroModelId?: string;
  kokoroSpeaker?: string;
  voiceId?: string;
} = {}): Config {
  const base = ConfigSchema.parse({});
  return {
    ...base,
    voice: {
      ...base.voice,
      enabled: overrides.voiceEnabled ?? true,
      transcription: base.voice.transcription,
      synthesis: {
        ...base.voice.synthesis,
        enabled: overrides.synthesisEnabled ?? true,
        backend: overrides.backend ?? 'say',
        sayVoice: overrides.sayVoice ?? base.voice.synthesis.sayVoice,
        sayRate: overrides.sayRate ?? base.voice.synthesis.sayRate,
        kokoroModelId: overrides.kokoroModelId ?? base.voice.synthesis.kokoroModelId,
        kokoroSpeaker: overrides.kokoroSpeaker ?? base.voice.synthesis.kokoroSpeaker,
        voiceId: overrides.voiceId ?? base.voice.synthesis.voiceId,
      },
    },
  };
}

/** Create a fake TtsBackend that responds to isAvailable, listVoices, and synthesize. */
function createMockBackend(
  name: 'say' | 'kokoro',
  options: {
    available?: boolean;
    voices?: TtsVoiceInfo[];
    synthesizeResult?: TtsSynthesizeResult;
  } = {},
): TtsBackend {
  const available = options.available ?? true;
  const voices = options.voices ?? [];
  const synthesizeResult = options.synthesizeResult ?? {
    audio: Buffer.from('fake-audio'),
    format: 'wav' as const,
    durationSec: 1.0,
    backend: name,
  };

  return {
    name,
    isAvailable: vi.fn().mockResolvedValue(available),
    listVoices: vi.fn().mockResolvedValue(voices),
    synthesize: vi.fn().mockResolvedValue(synthesizeResult),
  };
}

/* ------------------------------------------------------------------ */
/* Setup / teardown                                                   */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();
  resetTtsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ================================================================== */
/* Tests                                                              */
/* ================================================================== */

describe('getTtsBackend', () => {
  it('returns a say backend when configured to use say', async () => {
    const config = makeConfig({ backend: 'say' });
    const mockSay = createMockBackend('say');
    mockCreateSayBackend.mockReturnValue(mockSay);

    const backend = await getTtsBackend(config);

    expect(backend).toBe(mockSay);
    expect(mockCreateSayBackend).toHaveBeenCalledTimes(1);
    expect(mockSay.isAvailable).toHaveBeenCalledTimes(1);
  });

  it('returns a kokoro backend when configured and available', async () => {
    const config = makeConfig({
      backend: 'kokoro',
      kokoroModelId: 'kokoro-en-v0_19',
      kokoroSpeaker: 'af_bella',
    });
    const mockKokoro = createMockBackend('kokoro');
    mockCreateKokoroBackend.mockReturnValue(mockKokoro);

    const backend = await getTtsBackend(config);

    expect(backend).toBe(mockKokoro);
    expect(mockCreateKokoroBackend).toHaveBeenCalledWith(
      'kokoro-en-v0_19',
      'af_bella',
    );
    expect(mockKokoro.isAvailable).toHaveBeenCalledTimes(1);
  });

  it('falls back to say when kokoro is configured but unavailable', async () => {
    const config = makeConfig({ backend: 'kokoro' });
    const unavailableKokoro = createMockBackend('kokoro', { available: false });
    const mockSay = createMockBackend('say');

    mockCreateKokoroBackend.mockReturnValue(unavailableKokoro);
    mockCreateSayBackend.mockReturnValue(mockSay);

    const backend = await getTtsBackend(config);

    expect(backend).toBe(mockSay);
    expect(unavailableKokoro.isAvailable).toHaveBeenCalledTimes(1);
    expect(mockCreateSayBackend).toHaveBeenCalledTimes(1);
    expect(mockSay.isAvailable).toHaveBeenCalledTimes(1);
  });

  it('throws when configured backend is say and say is unavailable', async () => {
    const config = makeConfig({ backend: 'say' });
    const unavailableSay = createMockBackend('say', { available: false });
    mockCreateSayBackend.mockReturnValue(unavailableSay);

    await expect(getTtsBackend(config)).rejects.toThrow(
      'No TTS backend available',
    );
  });

  it('throws when kokoro is unavailable and say fallback is also unavailable', async () => {
    const config = makeConfig({ backend: 'kokoro' });
    const unavailableKokoro = createMockBackend('kokoro', { available: false });
    const unavailableSay = createMockBackend('say', { available: false });

    mockCreateKokoroBackend.mockReturnValue(unavailableKokoro);
    mockCreateSayBackend.mockReturnValue(unavailableSay);

    await expect(getTtsBackend(config)).rejects.toThrow(
      'No TTS backend available',
    );
  });

  it('throws for elevenlabs backend (not yet implemented)', async () => {
    const config = makeConfig({ backend: 'elevenlabs' });

    await expect(getTtsBackend(config)).rejects.toThrow(
      'ElevenLabs backend is not yet implemented',
    );
  });

  it('throws for unknown backend name', async () => {
    // Force an unknown backend value by casting
    const config = makeConfig();
    (config.voice.synthesis as { backend: string }).backend = 'unknown_backend';

    await expect(getTtsBackend(config)).rejects.toThrow(
      'Unknown TTS backend: unknown_backend',
    );
  });

  /* ---------------------------------------------------------------- */
  /* Caching behaviour                                                */
  /* ---------------------------------------------------------------- */

  describe('caching', () => {
    it('returns cached backend on repeated calls with same config', async () => {
      const config = makeConfig({ backend: 'say' });
      const mockSay = createMockBackend('say');
      mockCreateSayBackend.mockReturnValue(mockSay);

      const first = await getTtsBackend(config);
      const second = await getTtsBackend(config);

      expect(first).toBe(second);
      // createSayBackend should only be called once — second call uses cache
      expect(mockCreateSayBackend).toHaveBeenCalledTimes(1);
      expect(mockSay.isAvailable).toHaveBeenCalledTimes(1);
    });

    it('refreshes cache when backend config changes', async () => {
      const sayConfig = makeConfig({ backend: 'say' });
      const kokoroConfig = makeConfig({ backend: 'kokoro' });

      const mockSay = createMockBackend('say');
      const mockKokoro = createMockBackend('kokoro');

      mockCreateSayBackend.mockReturnValue(mockSay);
      mockCreateKokoroBackend.mockReturnValue(mockKokoro);

      const first = await getTtsBackend(sayConfig);
      expect(first).toBe(mockSay);

      const second = await getTtsBackend(kokoroConfig);
      expect(second).toBe(mockKokoro);

      expect(mockCreateSayBackend).toHaveBeenCalledTimes(1);
      expect(mockCreateKokoroBackend).toHaveBeenCalledTimes(1);
    });

    it('uses cache even after fallback, keyed by configured backend name', async () => {
      // First call: kokoro configured, falls back to say
      const kokoroConfig = makeConfig({ backend: 'kokoro' });
      const unavailableKokoro = createMockBackend('kokoro', { available: false });
      const mockSay = createMockBackend('say');

      mockCreateKokoroBackend.mockReturnValue(unavailableKokoro);
      mockCreateSayBackend.mockReturnValue(mockSay);

      const first = await getTtsBackend(kokoroConfig);
      expect(first).toBe(mockSay);

      // Second call with same kokoro config — cache was stored with key 'say' (the fallback)
      // Since configured backend is 'kokoro' but cached is 'say', it will re-evaluate
      const mockKokoro2 = createMockBackend('kokoro');
      mockCreateKokoroBackend.mockReturnValue(mockKokoro2);

      const second = await getTtsBackend(kokoroConfig);
      // Cache was stored with backendName 'say', but config says 'kokoro',
      // so it will try again and find kokoro now available
      expect(second).toBe(mockKokoro2);
    });
  });
});

/* ================================================================== */
/* synthesizeSpeech                                                   */
/* ================================================================== */

describe('synthesizeSpeech', () => {
  it('throws when voice is not enabled in config', async () => {
    const config = makeConfig({ voiceEnabled: false, synthesisEnabled: true });

    await expect(
      synthesizeSpeech(config, 'Hello', 'full'),
    ).rejects.toThrow('Voice synthesis is not enabled in configuration');
  });

  it('throws when synthesis is not enabled in config', async () => {
    const config = makeConfig({ voiceEnabled: true, synthesisEnabled: false });

    await expect(
      synthesizeSpeech(config, 'Hello', 'full'),
    ).rejects.toThrow('Voice synthesis is not enabled in configuration');
  });

  it('throws when both voice and synthesis are disabled', async () => {
    const config = makeConfig({ voiceEnabled: false, synthesisEnabled: false });

    await expect(
      synthesizeSpeech(config, 'Hello', 'full'),
    ).rejects.toThrow('Voice synthesis is not enabled in configuration');
  });

  it('throws when tier does not support voice_synthesis', async () => {
    const config = makeConfig({ voiceEnabled: true, synthesisEnabled: true });
    mockIsFeatureEnabled.mockReturnValue(false);

    await expect(
      synthesizeSpeech(config, 'Hello', 'lite'),
    ).rejects.toThrow('Voice synthesis requires the "full" install tier');

    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('lite', 'voice_synthesis');
  });

  it('throws with tier name when standard tier attempts voice synthesis', async () => {
    const config = makeConfig({ voiceEnabled: true, synthesisEnabled: true });
    mockIsFeatureEnabled.mockReturnValue(false);

    await expect(
      synthesizeSpeech(config, 'Hello', 'standard'),
    ).rejects.toThrow('Current tier: standard');
  });

  it('calls backend.synthesize with correct options for say backend', async () => {
    const config = makeConfig({
      backend: 'say',
      sayVoice: 'Samantha',
      sayRate: 1.5,
    });
    mockIsFeatureEnabled.mockReturnValue(true);

    const expectedResult: TtsSynthesizeResult = {
      audio: Buffer.from('say-audio'),
      format: 'wav',
      durationSec: 2.0,
      backend: 'say',
    };
    const mockSay = createMockBackend('say', { synthesizeResult: expectedResult });
    mockCreateSayBackend.mockReturnValue(mockSay);

    const result = await synthesizeSpeech(config, 'Test text', 'full');

    expect(result).toBe(expectedResult);
    expect(mockSay.synthesize).toHaveBeenCalledWith({
      text: 'Test text',
      voice: 'Samantha',
      rate: 1.5,
    });
  });

  it('uses sayVoice and sayRate for say backend voice/rate options', async () => {
    const config = makeConfig({
      backend: 'say',
      sayVoice: 'Daniel',
      sayRate: 0.8,
    });
    mockIsFeatureEnabled.mockReturnValue(true);

    const mockSay = createMockBackend('say');
    mockCreateSayBackend.mockReturnValue(mockSay);

    await synthesizeSpeech(config, 'Speak this', 'full');

    expect(mockSay.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: 'Daniel',
        rate: 0.8,
      }),
    );
  });

  it('uses kokoroSpeaker for kokoro backend voice option and rate 1.0', async () => {
    const config = makeConfig({
      backend: 'kokoro',
      kokoroSpeaker: 'af_bella',
    });
    mockIsFeatureEnabled.mockReturnValue(true);

    const mockKokoro = createMockBackend('kokoro');
    mockCreateKokoroBackend.mockReturnValue(mockKokoro);

    await synthesizeSpeech(config, 'Hello kokoro', 'full');

    expect(mockKokoro.synthesize).toHaveBeenCalledWith({
      text: 'Hello kokoro',
      voice: 'af_bella',
      rate: 1.0,
    });
  });

  it('uses undefined sayVoice when not configured (say backend)', async () => {
    // Default config has sayVoice as undefined
    const config = makeConfig({ backend: 'say' });
    mockIsFeatureEnabled.mockReturnValue(true);

    const mockSay = createMockBackend('say');
    mockCreateSayBackend.mockReturnValue(mockSay);

    await synthesizeSpeech(config, 'Test', 'full');

    expect(mockSay.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: undefined,
        rate: 1.0,
      }),
    );
  });

  it('does not check tier gating before checking config enablement', async () => {
    const config = makeConfig({ voiceEnabled: false, synthesisEnabled: true });

    await expect(
      synthesizeSpeech(config, 'Hello', 'full'),
    ).rejects.toThrow('Voice synthesis is not enabled');

    // isFeatureEnabled should NOT have been called — config check comes first
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/* listAvailableVoices                                                */
/* ================================================================== */

describe('listAvailableVoices', () => {
  it('returns voices from the backend', async () => {
    const config = makeConfig({ backend: 'say' });
    const voices: TtsVoiceInfo[] = [
      { id: 'Samantha', name: 'Samantha', language: 'en-us' },
      { id: 'Daniel', name: 'Daniel', language: 'en-gb', gender: 'male' },
    ];
    const mockSay = createMockBackend('say', { voices });
    mockCreateSayBackend.mockReturnValue(mockSay);

    const result = await listAvailableVoices(config);

    expect(result).toEqual(voices);
    expect(mockSay.listVoices).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when getTtsBackend throws', async () => {
    const config = makeConfig({ backend: 'elevenlabs' });

    const result = await listAvailableVoices(config);

    expect(result).toEqual([]);
  });

  it('propagates error when backend.listVoices rejects', async () => {
    const config = makeConfig({ backend: 'say' });
    const mockSay = createMockBackend('say');
    (mockSay.listVoices as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Voice listing failed'),
    );
    mockCreateSayBackend.mockReturnValue(mockSay);

    // The try/catch uses `return backend.listVoices()` without `await`,
    // so the rejected promise is returned directly without being caught.
    await expect(listAvailableVoices(config)).rejects.toThrow(
      'Voice listing failed',
    );
  });

  it('returns empty array when say backend is unavailable', async () => {
    const config = makeConfig({ backend: 'say' });
    const unavailableSay = createMockBackend('say', { available: false });
    mockCreateSayBackend.mockReturnValue(unavailableSay);

    const result = await listAvailableVoices(config);

    expect(result).toEqual([]);
  });
});

/* ================================================================== */
/* isTtsAvailable                                                     */
/* ================================================================== */

describe('isTtsAvailable', () => {
  it('returns true when a backend is available', async () => {
    const config = makeConfig({ backend: 'say' });
    const mockSay = createMockBackend('say');
    mockCreateSayBackend.mockReturnValue(mockSay);

    const result = await isTtsAvailable(config);

    expect(result).toBe(true);
  });

  it('returns true when kokoro backend is available', async () => {
    const config = makeConfig({ backend: 'kokoro' });
    const mockKokoro = createMockBackend('kokoro');
    mockCreateKokoroBackend.mockReturnValue(mockKokoro);

    const result = await isTtsAvailable(config);

    expect(result).toBe(true);
  });

  it('returns false when getTtsBackend throws (no backend available)', async () => {
    const config = makeConfig({ backend: 'say' });
    const unavailableSay = createMockBackend('say', { available: false });
    mockCreateSayBackend.mockReturnValue(unavailableSay);

    const result = await isTtsAvailable(config);

    expect(result).toBe(false);
  });

  it('returns false for elevenlabs (throws internally)', async () => {
    const config = makeConfig({ backend: 'elevenlabs' });

    const result = await isTtsAvailable(config);

    expect(result).toBe(false);
  });

  it('returns true when kokoro is unavailable but say fallback works', async () => {
    const config = makeConfig({ backend: 'kokoro' });
    const unavailableKokoro = createMockBackend('kokoro', { available: false });
    const mockSay = createMockBackend('say');

    mockCreateKokoroBackend.mockReturnValue(unavailableKokoro);
    mockCreateSayBackend.mockReturnValue(mockSay);

    const result = await isTtsAvailable(config);

    expect(result).toBe(true);
  });
});

/* ================================================================== */
/* resetTtsCache                                                      */
/* ================================================================== */

describe('resetTtsCache', () => {
  it('clears the cached backend so next call re-creates it', async () => {
    const config = makeConfig({ backend: 'say' });
    const mockSay1 = createMockBackend('say');
    const mockSay2 = createMockBackend('say');

    mockCreateSayBackend.mockReturnValueOnce(mockSay1);
    mockCreateSayBackend.mockReturnValueOnce(mockSay2);

    const first = await getTtsBackend(config);
    expect(first).toBe(mockSay1);

    resetTtsCache();

    const second = await getTtsBackend(config);
    expect(second).toBe(mockSay2);

    // createSayBackend called twice — once before reset, once after
    expect(mockCreateSayBackend).toHaveBeenCalledTimes(2);
  });

  it('does not throw when called with no cached backend', () => {
    expect(() => resetTtsCache()).not.toThrow();
  });

  it('allows switching backends after reset', async () => {
    const sayConfig = makeConfig({ backend: 'say' });
    const kokoroConfig = makeConfig({ backend: 'kokoro' });

    const mockSay = createMockBackend('say');
    const mockKokoro = createMockBackend('kokoro');

    mockCreateSayBackend.mockReturnValue(mockSay);
    mockCreateKokoroBackend.mockReturnValue(mockKokoro);

    // First: say backend cached
    const first = await getTtsBackend(sayConfig);
    expect(first).toBe(mockSay);

    // Reset and switch to kokoro
    resetTtsCache();

    const second = await getTtsBackend(kokoroConfig);
    expect(second).toBe(mockKokoro);
  });
});
