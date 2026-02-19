/**
 * Unit tests for the voice module coordinator (VoiceProcessor).
 * Tests creation, delegation, enablement, and hardware gating.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVoiceProcessor } from '../../../src/voice/index.js';
import type { VoiceConfig } from '../../../src/voice/index.js';
import { ProviderError } from '../../../src/errors.js';
import type { Attachment, HardwareProfile } from '../../../src/types/index.js';

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Build a default VoiceConfig for testing */
function buildTestConfig(overrides?: Partial<VoiceConfig>): VoiceConfig {
  return {
    enabled: true,
    transcription: {
      backend: 'groq',
      apiKey: 'test-groq-key',
      language: 'en',
    },
    synthesis: {
      enabled: true,
      backend: 'elevenlabs',
      apiKey: 'test-elevenlabs-key',
      voiceId: 'pNInz6obpgDQGcFmaJgB',
    },
    ...overrides,
  };
}

/** Build a test audio attachment */
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

describe('createVoiceProcessor', () => {
  describe('isEnabled', () => {
    it('returns true when config.enabled is true', () => {
      const config = buildTestConfig({ enabled: true });
      const processor = createVoiceProcessor(config);
      expect(processor.isEnabled()).toBe(true);
    });

    it('returns false when config.enabled is false and hardware does not support voice', () => {
      const config = buildTestConfig({ enabled: false });
      const processor = createVoiceProcessor(config, voiceIncapableHardware);
      expect(processor.isEnabled()).toBe(false);
    });

    it('returns true when config.enabled is false but hardware supports voice', () => {
      const config = buildTestConfig({ enabled: false });
      const processor = createVoiceProcessor(config, voiceCapableHardware);
      expect(processor.isEnabled()).toBe(true);
    });

    it('returns false when config.enabled is false and no hardware info provided', () => {
      const config = buildTestConfig({ enabled: false });
      const processor = createVoiceProcessor(config);
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
      const processor = createVoiceProcessor(config);
      const attachment = buildTestAttachment();

      const result = await processor.processAudioAttachment(attachment);

      expect(result.text).toBe('Transcribed audio text');
      expect(result.backend).toBe('groq');
      expect(result.language).toBe('en');
    });

    it('throws ProviderError when voice is not enabled', async () => {
      const config = buildTestConfig({ enabled: false });
      const processor = createVoiceProcessor(config, voiceIncapableHardware);
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
      const processor = createVoiceProcessor(config);
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
    it('delegates synthesis to synthesizer and returns result', async () => {
      const testAudio = new ArrayBuffer(2048);

      vi.stubGlobal('fetch', async () => {
        return new Response(testAudio, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        });
      });

      const config = buildTestConfig();
      const processor = createVoiceProcessor(config);

      const result = await processor.generateAudioResponse('Hello world');

      expect(result).not.toBeNull();
      expect(result!.audioData).toBeInstanceOf(Buffer);
      expect(result!.backend).toBe('elevenlabs');
      expect(result!.mimeType).toBe('audio/mpeg');
    });

    it('returns null when voice is not enabled', async () => {
      const config = buildTestConfig({ enabled: false });
      const processor = createVoiceProcessor(config, voiceIncapableHardware);

      const result = await processor.generateAudioResponse('Hello');
      expect(result).toBeNull();
    });

    it('returns null when synthesis is disabled', async () => {
      const config = buildTestConfig({
        synthesis: {
          enabled: false,
          backend: 'elevenlabs',
          apiKey: 'test-key',
        },
      });
      const processor = createVoiceProcessor(config);

      const result = await processor.generateAudioResponse('Hello');
      expect(result).toBeNull();
    });
  });

  describe('hardware gating', () => {
    it('enables voice when hardware meets requirements even if config.enabled is false', () => {
      const config = buildTestConfig({ enabled: false });
      const processor = createVoiceProcessor(config, voiceCapableHardware);
      expect(processor.isEnabled()).toBe(true);
    });

    it('disables voice when hardware does not meet requirements and config.enabled is false', () => {
      const config = buildTestConfig({ enabled: false });
      const processor = createVoiceProcessor(config, voiceIncapableHardware);
      expect(processor.isEnabled()).toBe(false);
    });
  });
});
