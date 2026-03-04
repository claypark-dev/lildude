/**
 * Unit tests for the voice module coordinator (VoiceProcessor).
 * Tests creation, delegation, enablement, and hardware gating.
 * Updated for the new TTS router API (say/kokoro/elevenlabs backends).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVoiceProcessor } from '../../../src/voice/index.js';
import type { Config } from '../../../src/config/schema.js';
import { ConfigSchema } from '../../../src/config/schema.js';
import { ProviderError } from '../../../src/errors.js';
import type { Attachment, HardwareProfile, InstallTier } from '../../../src/types/index.js';

// Mock the TTS router so we don't need real TTS backends
vi.mock('../../../src/voice/tts-router.js', () => ({
  synthesizeSpeech: vi.fn(),
  listAvailableVoices: vi.fn(),
  isTtsAvailable: vi.fn(),
  resetTtsCache: vi.fn(),
}));

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Build a default Config for testing with voice enabled. */
function buildTestConfig(overrides?: Partial<{
  voiceEnabled: boolean;
  synthesisEnabled: boolean;
  backend: 'say' | 'kokoro' | 'elevenlabs';
}>): Config {
  return ConfigSchema.parse({
    voice: {
      enabled: overrides?.voiceEnabled ?? true,
      transcription: {
        backend: 'groq',
        groqApiKey: 'test-groq-key',
        language: 'en',
      },
      synthesis: {
        enabled: overrides?.synthesisEnabled ?? true,
        backend: overrides?.backend ?? 'say',
      },
    },
  });
}

/** Build a test audio attachment. */
function buildTestAttachment(overrides?: Partial<Attachment>): Attachment {
  return {
    type: 'audio',
    data: Buffer.alloc(1024, 0x42),
    mimeType: 'audio/mpeg',
    filename: 'test.mp3',
    size: 1024,
    ...overrides,
  };
}

/** Hardware features where voice is supported */
const voiceCapableHardware: HardwareProfile['features'] = {
  browserAutomation: true,
  localModels: true,
  voice: true,
};

/** Hardware features where voice is NOT supported */
const voiceIncapableHardware: HardwareProfile['features'] = {
  browserAutomation: true,
  localModels: false,
  voice: false,
};

const defaultTier: InstallTier = 'full';

describe('createVoiceProcessor', () => {
  describe('isEnabled', () => {
    it('returns true when config.voice.enabled is true', () => {
      const config = buildTestConfig({ voiceEnabled: true });
      const processor = createVoiceProcessor(config, defaultTier);
      expect(processor.isEnabled()).toBe(true);
    });

    it('returns false when config.voice.enabled is false and hardware does not support voice', () => {
      const config = buildTestConfig({ voiceEnabled: false });
      const processor = createVoiceProcessor(config, defaultTier, voiceIncapableHardware);
      expect(processor.isEnabled()).toBe(false);
    });

    it('returns true when config.voice.enabled is false but hardware supports voice', () => {
      const config = buildTestConfig({ voiceEnabled: false });
      const processor = createVoiceProcessor(config, defaultTier, voiceCapableHardware);
      expect(processor.isEnabled()).toBe(true);
    });

    it('returns false when config.voice.enabled is false and no hardware info provided', () => {
      const config = buildTestConfig({ voiceEnabled: false });
      const processor = createVoiceProcessor(config, defaultTier);
      expect(processor.isEnabled()).toBe(false);
    });
  });

  describe('processAudioAttachment', () => {
    it('delegates transcription to transcriber and returns result', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify({ text: 'Transcribed audio text' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const config = buildTestConfig();
      const processor = createVoiceProcessor(config, defaultTier);
      const attachment = buildTestAttachment();

      const result = await processor.processAudioAttachment(attachment);

      expect(result.text).toBe('Transcribed audio text');
      expect(result.backend).toBe('groq');
      expect(result.language).toBe('en');
    });

    it('throws ProviderError when voice is not enabled', async () => {
      const config = buildTestConfig({ voiceEnabled: false });
      const processor = createVoiceProcessor(config, defaultTier, voiceIncapableHardware);
      const attachment = buildTestAttachment();

      try {
        await processor.processAudioAttachment(attachment);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.message).toContain('not enabled');
      }
    });

    it('throws ProviderError when attachment has no data', async () => {
      const config = buildTestConfig();
      const processor = createVoiceProcessor(config, defaultTier);
      const attachment = buildTestAttachment({ data: undefined });

      try {
        await processor.processAudioAttachment(attachment);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.message).toContain('no data buffer');
      }
    });
  });

  describe('generateAudioResponse', () => {
    it('delegates synthesis to TTS router and returns result', async () => {
      const { synthesizeSpeech } = await import('../../../src/voice/tts-router.js');
      const mockResult = {
        audio: Buffer.alloc(2048),
        format: 'wav' as const,
        durationSec: 1.5,
        backend: 'say' as const,
      };
      vi.mocked(synthesizeSpeech).mockResolvedValue(mockResult);

      const config = buildTestConfig();
      const processor = createVoiceProcessor(config, defaultTier);

      const result = await processor.generateAudioResponse('Hello world');

      expect(result).not.toBeNull();
      expect(result!.audio).toBeInstanceOf(Buffer);
      expect(result!.backend).toBe('say');
      expect(result!.format).toBe('wav');
    });

    it('returns null when voice is not enabled', async () => {
      const config = buildTestConfig({ voiceEnabled: false });
      const processor = createVoiceProcessor(config, defaultTier, voiceIncapableHardware);

      const result = await processor.generateAudioResponse('Hello');
      expect(result).toBeNull();
    });

    it('returns null when synthesis is disabled', async () => {
      const config = buildTestConfig({ synthesisEnabled: false });
      const processor = createVoiceProcessor(config, defaultTier);

      const result = await processor.generateAudioResponse('Hello');
      expect(result).toBeNull();
    });

    it('wraps non-ProviderError in ProviderError', async () => {
      const { synthesizeSpeech } = await import('../../../src/voice/tts-router.js');
      vi.mocked(synthesizeSpeech).mockRejectedValue(new Error('TTS backend exploded'));

      const config = buildTestConfig();
      const processor = createVoiceProcessor(config, defaultTier);

      try {
        await processor.generateAudioResponse('Hello');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).message).toContain('TTS backend exploded');
      }
    });

    it('re-throws ProviderError as-is', async () => {
      const { synthesizeSpeech } = await import('../../../src/voice/tts-router.js');
      const providerErr = new ProviderError('Tier gating failure', 'tts-router', false);
      vi.mocked(synthesizeSpeech).mockRejectedValue(providerErr);

      const config = buildTestConfig();
      const processor = createVoiceProcessor(config, defaultTier);

      try {
        await processor.generateAudioResponse('Hello');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBe(providerErr);
      }
    });
  });

  describe('hardware gating', () => {
    it('enables voice when hardware meets requirements even if config.voice.enabled is false', () => {
      const config = buildTestConfig({ voiceEnabled: false });
      const processor = createVoiceProcessor(config, defaultTier, voiceCapableHardware);
      expect(processor.isEnabled()).toBe(true);
    });

    it('disables voice when hardware does not meet requirements and config.voice.enabled is false', () => {
      const config = buildTestConfig({ voiceEnabled: false });
      const processor = createVoiceProcessor(config, defaultTier, voiceIncapableHardware);
      expect(processor.isEnabled()).toBe(false);
    });
  });
});
