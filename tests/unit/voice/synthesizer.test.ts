/**
 * Unit tests for the voice synthesizer module.
 * Stubs global fetch to simulate the ElevenLabs API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { synthesizeSpeech } from '../../../src/voice/synthesizer.js';
import { ProviderError } from '../../../src/errors.js';
import type { SynthesizeOptions } from '../../../src/voice/synthesizer.js';

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const defaultOptions: SynthesizeOptions = {
  backend: 'elevenlabs',
  apiKey: 'test-elevenlabs-key',
  voiceId: 'pNInz6obpgDQGcFmaJgB',
};

/** Create a test audio response buffer */
function createTestAudioResponse(sizeBytes: number = 2048): ArrayBuffer {
  const buffer = new ArrayBuffer(sizeBytes);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < sizeBytes; i++) {
    view[i] = 0xFF;
  }
  return buffer;
}

describe('synthesizeSpeech', () => {
  describe('ElevenLabs cloud backend', () => {
    it('sends correct request to ElevenLabs API', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody = '';

      vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = typeof url === 'string' ? url : url.toString();
        const headers = init?.headers as Record<string, string> | undefined;
        capturedHeaders = headers ?? {};
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          createTestAudioResponse(),
          { status: 200, headers: { 'Content-Type': 'audio/mpeg' } },
        );
      });

      await synthesizeSpeech('Hello world', defaultOptions);

      expect(capturedUrl).toContain('api.elevenlabs.io');
      expect(capturedUrl).toContain('text-to-speech');
      expect(capturedUrl).toContain('pNInz6obpgDQGcFmaJgB');
      expect(capturedHeaders['xi-api-key']).toBe('test-elevenlabs-key');
      expect(capturedHeaders['Content-Type']).toBe('application/json');

      const parsedBody = JSON.parse(capturedBody) as Record<string, unknown>;
      expect(parsedBody.text).toBe('Hello world');
      expect(parsedBody.model_id).toBe('eleven_monolingual_v1');
    });

    it('returns audio data from ElevenLabs API response', async () => {
      const testAudio = createTestAudioResponse(4096);

      vi.stubGlobal('fetch', async () => {
        return new Response(testAudio, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        });
      });

      const result = await synthesizeSpeech('Test speech', defaultOptions);

      expect(result.audioData).toBeInstanceOf(Buffer);
      expect(result.audioData.length).toBe(4096);
      expect(result.mimeType).toBe('audio/mpeg');
      expect(result.backend).toBe('elevenlabs');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('throws ProviderError on API rate limit (429)', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          'Rate limit exceeded',
          { status: 429, headers: { 'Content-Type': 'text/plain' } },
        );
      });

      try {
        await synthesizeSpeech('Hello', defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(true);
        expect(providerError.message).toContain('rate limited');
      }
    });

    it('throws ProviderError on authentication failure (401)', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          'Unauthorized',
          { status: 401, headers: { 'Content-Type': 'text/plain' } },
        );
      });

      try {
        await synthesizeSpeech('Hello', defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(false);
        expect(providerError.message).toContain('authentication failed');
      }
    });

    it('throws ProviderError when API key is missing', async () => {
      const optionsNoKey: SynthesizeOptions = { backend: 'elevenlabs' };

      try {
        await synthesizeSpeech('Hello', optionsNoKey);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.message).toContain('API key is required');
      }
    });

    it('throws ProviderError on network error', async () => {
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('fetch failed: network error');
      });

      try {
        await synthesizeSpeech('Hello', defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(true);
        expect(providerError.message).toContain('Network error');
      }
    });
  });

  describe('input validation', () => {
    it('throws ProviderError for empty text', async () => {
      try {
        await synthesizeSpeech('', defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.message).toContain('empty');
      }
    });

    it('throws ProviderError for whitespace-only text', async () => {
      try {
        await synthesizeSpeech('   \n\t  ', defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.message).toContain('empty');
      }
    });

    it('throws ProviderError for text exceeding character limit', async () => {
      const longText = 'a'.repeat(5001);

      try {
        await synthesizeSpeech(longText, defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.message).toContain('too long');
      }
    });
  });

  describe('local backend', () => {
    it('returns stub synthesis result', async () => {
      const localOptions: SynthesizeOptions = { backend: 'local' };
      const result = await synthesizeSpeech('Hello world', localOptions);

      expect(result.backend).toBe('local');
      expect(result.audioData).toBeInstanceOf(Buffer);
      expect(result.audioData.length).toBe(0);
      expect(result.mimeType).toBe('audio/wav');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
