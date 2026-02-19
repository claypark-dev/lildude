/**
 * Unit tests for the voice transcriber module.
 * Stubs global fetch to simulate the Groq Whisper API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transcribeAudio, calculateTranscriptionCost } from '../../../src/voice/transcriber.js';
import { ProviderError } from '../../../src/errors.js';
import type { TranscribeOptions } from '../../../src/voice/transcriber.js';

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const defaultOptions: TranscribeOptions = {
  backend: 'groq',
  apiKey: 'test-groq-key',
  language: 'en',
};

/** Create a test audio buffer of the given size in bytes */
function createTestAudioBuffer(sizeBytes: number = 1024): Buffer {
  return Buffer.alloc(sizeBytes, 0x42);
}

describe('transcribeAudio', () => {
  describe('Groq cloud backend', () => {
    it('sends correct multipart request to Groq API', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: FormData | undefined;

      vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = typeof url === 'string' ? url : url.toString();
        const headers = init?.headers as Record<string, string> | undefined;
        capturedHeaders = headers ?? {};
        capturedBody = init?.body as FormData | undefined;
        return new Response(
          JSON.stringify({ text: 'Hello world' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const audioData = createTestAudioBuffer();
      await transcribeAudio(audioData, defaultOptions, 'audio/mpeg');

      expect(capturedUrl).toContain('api.groq.com');
      expect(capturedUrl).toContain('audio/transcriptions');
      expect(capturedHeaders['Authorization']).toBe('Bearer test-groq-key');
      expect(capturedBody).toBeInstanceOf(FormData);
    });

    it('returns transcription text from Groq API response', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify({ text: 'This is a transcription test.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const audioData = createTestAudioBuffer();
      const result = await transcribeAudio(audioData, defaultOptions, 'audio/mpeg');

      expect(result.text).toBe('This is a transcription test.');
      expect(result.backend).toBe('groq');
      expect(result.language).toBe('en');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('throws ProviderError on API rate limit (429)', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          'Rate limit exceeded',
          { status: 429, headers: { 'Content-Type': 'text/plain' } },
        );
      });

      const audioData = createTestAudioBuffer();

      try {
        await transcribeAudio(audioData, defaultOptions, 'audio/mpeg');
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
          'Invalid API key',
          { status: 401, headers: { 'Content-Type': 'text/plain' } },
        );
      });

      const audioData = createTestAudioBuffer();

      try {
        await transcribeAudio(audioData, defaultOptions, 'audio/mpeg');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(false);
        expect(providerError.message).toContain('authentication failed');
      }
    });

    it('throws ProviderError on server error (500)', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          'Internal server error',
          { status: 500, headers: { 'Content-Type': 'text/plain' } },
        );
      });

      const audioData = createTestAudioBuffer();

      try {
        await transcribeAudio(audioData, defaultOptions, 'audio/mpeg');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(true);
      }
    });

    it('throws ProviderError when API key is missing', async () => {
      const audioData = createTestAudioBuffer();
      const optionsNoKey: TranscribeOptions = { backend: 'groq' };

      try {
        await transcribeAudio(audioData, optionsNoKey, 'audio/mpeg');
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

      const audioData = createTestAudioBuffer();

      try {
        await transcribeAudio(audioData, defaultOptions, 'audio/mpeg');
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
    it('throws ProviderError for file exceeding 25MB limit', async () => {
      const oversizedBuffer = createTestAudioBuffer(26 * 1024 * 1024);

      try {
        await transcribeAudio(oversizedBuffer, defaultOptions, 'audio/mpeg');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.message).toContain('too large');
        expect(providerError.retryable).toBe(false);
      }
    });

    it('throws ProviderError for empty audio data', async () => {
      const emptyBuffer = Buffer.alloc(0);

      try {
        await transcribeAudio(emptyBuffer, defaultOptions, 'audio/mpeg');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.message).toContain('empty');
      }
    });

    it('throws ProviderError for unsupported audio format', async () => {
      const audioData = createTestAudioBuffer();

      try {
        await transcribeAudio(audioData, defaultOptions, 'audio/aiff');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.message).toContain('Unsupported audio format');
      }
    });
  });

  describe('local backend', () => {
    it('returns stub transcription result', async () => {
      const audioData = createTestAudioBuffer();
      const localOptions: TranscribeOptions = {
        backend: 'local',
        language: 'en',
      };

      const result = await transcribeAudio(audioData, localOptions, 'audio/mpeg');

      expect(result.backend).toBe('local');
      expect(result.text).toContain('stub');
      expect(result.language).toBe('en');
      expect(result.durationMs).toBe(0);
    });

    it('uses provided language for local backend', async () => {
      const audioData = createTestAudioBuffer();
      const localOptions: TranscribeOptions = {
        backend: 'local',
        language: 'ja',
      };

      const result = await transcribeAudio(audioData, localOptions, 'audio/mpeg');

      expect(result.language).toBe('ja');
    });
  });
});

describe('calculateTranscriptionCost', () => {
  it('calculates cost for 1 hour of audio', () => {
    const oneHourMs = 60 * 60 * 1000;
    const cost = calculateTranscriptionCost(oneHourMs);
    expect(cost).toBeCloseTo(0.111, 3);
  });

  it('calculates cost for 30 seconds of audio', () => {
    const thirtySecondsMs = 30 * 1000;
    const cost = calculateTranscriptionCost(thirtySecondsMs);
    const expectedCost = (30 / 3600) * 0.111;
    expect(cost).toBeCloseTo(expectedCost, 6);
  });

  it('returns 0 for 0 duration', () => {
    expect(calculateTranscriptionCost(0)).toBe(0);
  });
});
