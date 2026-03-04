/**
 * Unit tests for the kokoro-js TTS backend (tts-kokoro).
 * Mocks the dynamic import of kokoro-js and the logger to isolate
 * lazy-loading, WAV conversion, and synthesis behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ------------------------------------------------------------------ */
/* Module mocks — must be declared before the import under test       */
/* ------------------------------------------------------------------ */

vi.mock('../../../src/utils/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

/* ------------------------------------------------------------------ */
/* Mock pipeline & module factories                                   */
/* ------------------------------------------------------------------ */

/** Create a mock KokoroPipeline with a configurable generate function. */
function createMockPipeline(generateFn?: (text: string, opts?: { voice?: string; speed?: number }) => Promise<{ audio: Float32Array; sampling_rate: number }>) {
  return {
    generate: generateFn ?? vi.fn(async () => ({
      audio: new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]),
      sampling_rate: 22050,
    })),
  };
}

/** Create a mock kokoro-js module with a configurable KokoroTTS constructor. */
function createMockKokoroModule(pipeline?: ReturnType<typeof createMockPipeline>) {
  const mockPipeline = pipeline ?? createMockPipeline();
  return {
    KokoroTTS: vi.fn(() => mockPipeline),
    __pipeline: mockPipeline,
  };
}

/* ------------------------------------------------------------------ */
/* Imports — these must come after mock setup but before tests that   */
/* use vi.resetModules(), which will re-import as needed              */
/* ------------------------------------------------------------------ */

import type { TtsBackend, TtsSynthesizeOptions } from '../../../src/voice/types.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Dynamically import the tts-kokoro module after resetting module state.
 * This ensures each test gets a fresh module with cleared caches.
 */
async function freshImport() {
  vi.resetModules();
  // Re-apply the logger mock after reset
  vi.doMock('../../../src/utils/logger.js', () => ({
    createModuleLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  }));
  const mod = await import('../../../src/voice/tts-kokoro.js');
  return mod;
}

/**
 * Import a fresh module with kokoro-js mocked to the given mock module.
 * Useful for synthesize/isAvailable tests that need to control the import.
 */
async function freshImportWithKokoro(mockModule: ReturnType<typeof createMockKokoroModule>) {
  vi.resetModules();
  vi.doMock('../../../src/utils/logger.js', () => ({
    createModuleLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  }));
  vi.doMock('kokoro-js', () => mockModule);
  const mod = await import('../../../src/voice/tts-kokoro.js');
  return mod;
}

/**
 * Import a fresh module with kokoro-js mocked to throw on import.
 * Simulates the package not being installed.
 */
async function freshImportWithoutKokoro() {
  vi.resetModules();
  vi.doMock('../../../src/utils/logger.js', () => ({
    createModuleLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  }));
  vi.doMock('kokoro-js', () => {
    throw new Error('Cannot find module \'kokoro-js\'');
  });
  const mod = await import('../../../src/voice/tts-kokoro.js');
  return mod;
}

/* ------------------------------------------------------------------ */
/* Setup / teardown                                                   */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ================================================================== */
/* pcmToWav tests                                                     */
/* ================================================================== */

describe('pcmToWav', () => {
  /* ---------------------------------------------------------------- */
  /* WAV header structure                                             */
  /* ---------------------------------------------------------------- */

  describe('WAV header structure', () => {
    it('writes RIFF header at offset 0', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    });

    it('writes correct overall file size at offset 4', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0, 0.5, -0.5]);
      const wav = pcmToWav(samples, 16000);

      // File size = 36 + dataSize, where dataSize = 3 samples * 2 bytes = 6
      const expectedFileSize = 36 + 6;
      expect(wav.readUInt32LE(4)).toBe(expectedFileSize);
    });

    it('writes WAVE format at offset 8', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    });

    it('writes fmt subchunk header at offset 12', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    });

    it('writes subchunk1 size (16 for PCM) at offset 16', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readUInt32LE(16)).toBe(16);
    });

    it('writes PCM audio format (1) at offset 20', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readUInt16LE(20)).toBe(1);
    });

    it('writes mono channel count (1) at offset 22', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readUInt16LE(22)).toBe(1);
    });

    it('writes sample rate at offset 24', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);

      const wav16k = pcmToWav(samples, 16000);
      expect(wav16k.readUInt32LE(24)).toBe(16000);

      const wav44k = pcmToWav(samples, 44100);
      expect(wav44k.readUInt32LE(24)).toBe(44100);
    });

    it('writes correct byte rate at offset 28', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 22050);

      // byteRate = sampleRate * numChannels * bitsPerSample/8 = 22050 * 1 * 2 = 44100
      expect(wav.readUInt32LE(28)).toBe(44100);
    });

    it('writes correct block align at offset 32', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 16000);

      // blockAlign = numChannels * bitsPerSample/8 = 1 * 2 = 2
      expect(wav.readUInt16LE(32)).toBe(2);
    });

    it('writes 16 bits per sample at offset 34', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readUInt16LE(34)).toBe(16);
    });

    it('writes data subchunk header at offset 36', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.toString('ascii', 36, 40)).toBe('data');
    });

    it('writes correct data size at offset 40', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0, 0.5, -0.5, 1.0]);
      const wav = pcmToWav(samples, 16000);

      // dataSize = 4 samples * 2 bytes = 8
      expect(wav.readUInt32LE(40)).toBe(8);
    });

    it('produces correct total buffer length (44-byte header + data)', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
      const wav = pcmToWav(samples, 16000);

      // 44 header + 5 samples * 2 bytes = 54
      expect(wav.length).toBe(54);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Float32 to Int16 sample conversion                               */
  /* ---------------------------------------------------------------- */

  describe('sample conversion', () => {
    it('converts silence (0.0) to int16 zero', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readInt16LE(44)).toBe(0);
    });

    it('converts positive maximum (1.0) to 0x7FFF', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([1.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readInt16LE(44)).toBe(0x7FFF);
    });

    it('converts negative maximum (-1.0) to -0x8000', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([-1.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readInt16LE(44)).toBe(-0x8000);
    });

    it('converts 0.5 to approximately half of positive max', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.5]);
      const wav = pcmToWav(samples, 16000);

      // 0.5 * 0x7FFF = 16383.5 => rounded to 16384
      const int16Value = wav.readInt16LE(44);
      expect(int16Value).toBeCloseTo(0x7FFF * 0.5, -1);
    });

    it('converts -0.5 to approximately half of negative max', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([-0.5]);
      const wav = pcmToWav(samples, 16000);

      // -0.5 * 0x8000 = -16384
      const int16Value = wav.readInt16LE(44);
      expect(int16Value).toBeCloseTo(-0x8000 * 0.5, -1);
    });

    it('converts multiple samples in correct order', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0, 1.0, -1.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readInt16LE(44)).toBe(0);
      expect(wav.readInt16LE(46)).toBe(0x7FFF);
      expect(wav.readInt16LE(48)).toBe(-0x8000);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Clamping out-of-range values                                     */
  /* ---------------------------------------------------------------- */

  describe('clamping', () => {
    it('clamps values above 1.0 to 1.0 (positive max int16)', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([2.5]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readInt16LE(44)).toBe(0x7FFF);
    });

    it('clamps values below -1.0 to -1.0 (negative max int16)', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([-3.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readInt16LE(44)).toBe(-0x8000);
    });

    it('clamps mixed out-of-range and in-range values', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([5.0, 0.0, -5.0]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.readInt16LE(44)).toBe(0x7FFF);
      expect(wav.readInt16LE(46)).toBe(0);
      expect(wav.readInt16LE(48)).toBe(-0x8000);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Various sample rates                                             */
  /* ---------------------------------------------------------------- */

  describe('various sample rates', () => {
    it('handles 8000 Hz sample rate', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 8000);

      expect(wav.readUInt32LE(24)).toBe(8000);
      expect(wav.readUInt32LE(28)).toBe(16000); // byteRate = 8000 * 1 * 2
    });

    it('handles 22050 Hz sample rate', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 22050);

      expect(wav.readUInt32LE(24)).toBe(22050);
      expect(wav.readUInt32LE(28)).toBe(44100);
    });

    it('handles 44100 Hz sample rate', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 44100);

      expect(wav.readUInt32LE(24)).toBe(44100);
      expect(wav.readUInt32LE(28)).toBe(88200);
    });

    it('handles 48000 Hz sample rate', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([0.0]);
      const wav = pcmToWav(samples, 48000);

      expect(wav.readUInt32LE(24)).toBe(48000);
      expect(wav.readUInt32LE(28)).toBe(96000);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Empty input                                                      */
  /* ---------------------------------------------------------------- */

  describe('empty input', () => {
    it('produces a valid 44-byte WAV with zero data for empty samples', async () => {
      const { pcmToWav } = await freshImport();
      const samples = new Float32Array([]);
      const wav = pcmToWav(samples, 16000);

      expect(wav.length).toBe(44);
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
      expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
      expect(wav.readUInt32LE(40)).toBe(0); // data size = 0
      expect(wav.readUInt32LE(4)).toBe(36);  // file size = 36 + 0
    });
  });
});

/* ================================================================== */
/* createKokoroBackend tests                                          */
/* ================================================================== */

describe('createKokoroBackend', () => {
  /* ---------------------------------------------------------------- */
  /* Backend identity                                                 */
  /* ---------------------------------------------------------------- */

  describe('backend identity', () => {
    it('returns a backend with name "kokoro"', async () => {
      const { createKokoroBackend } = await freshImport();
      const backend = createKokoroBackend();
      expect(backend.name).toBe('kokoro');
    });
  });

  /* ---------------------------------------------------------------- */
  /* isAvailable                                                      */
  /* ---------------------------------------------------------------- */

  describe('isAvailable', () => {
    it('returns true when kokoro-js can be imported', async () => {
      const mockModule = createMockKokoroModule();
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend();

      const available = await backend.isAvailable();

      expect(available).toBe(true);
    });

    it('returns false when kokoro-js import throws', async () => {
      const { createKokoroBackend } = await freshImportWithoutKokoro();
      const backend = createKokoroBackend();

      const available = await backend.isAvailable();

      expect(available).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- */
  /* listVoices                                                       */
  /* ---------------------------------------------------------------- */

  describe('listVoices', () => {
    it('returns exactly 9 built-in voices', async () => {
      const { createKokoroBackend } = await freshImport();
      const backend = createKokoroBackend();

      const voices = await backend.listVoices();

      expect(voices).toHaveLength(9);
    });

    it('includes all expected voice IDs', async () => {
      const { createKokoroBackend } = await freshImport();
      const backend = createKokoroBackend();

      const voices = await backend.listVoices();
      const voiceIds = voices.map((v) => v.id);

      expect(voiceIds).toEqual([
        'af_heart',
        'af_bella',
        'af_nicole',
        'af_sarah',
        'af_sky',
        'am_adam',
        'am_michael',
        'bf_emma',
        'bm_george',
      ]);
    });

    it('each voice has id, name, language, and gender fields', async () => {
      const { createKokoroBackend } = await freshImport();
      const backend = createKokoroBackend();

      const voices = await backend.listVoices();

      for (const voice of voices) {
        expect(voice).toHaveProperty('id');
        expect(voice).toHaveProperty('name');
        expect(voice).toHaveProperty('language');
        expect(voice).toHaveProperty('gender');
        expect(typeof voice.id).toBe('string');
        expect(typeof voice.name).toBe('string');
        expect(typeof voice.language).toBe('string');
      }
    });

    it('contains both English (en) and British English (en-GB) voices', async () => {
      const { createKokoroBackend } = await freshImport();
      const backend = createKokoroBackend();

      const voices = await backend.listVoices();
      const languages = new Set(voices.map((v) => v.language));

      expect(languages.has('en')).toBe(true);
      expect(languages.has('en-GB')).toBe(true);
    });

    it('contains both male and female voices', async () => {
      const { createKokoroBackend } = await freshImport();
      const backend = createKokoroBackend();

      const voices = await backend.listVoices();
      const genders = new Set(voices.map((v) => v.gender));

      expect(genders.has('male')).toBe(true);
      expect(genders.has('female')).toBe(true);
    });

    it('returns the same array on repeated calls', async () => {
      const { createKokoroBackend } = await freshImport();
      const backend = createKokoroBackend();

      const first = await backend.listVoices();
      const second = await backend.listVoices();

      expect(first).toEqual(second);
    });
  });

  /* ---------------------------------------------------------------- */
  /* synthesize                                                       */
  /* ---------------------------------------------------------------- */

  describe('synthesize', () => {
    const baseOptions: TtsSynthesizeOptions = { text: 'Hello world' };

    it('calls pipeline.generate with text and default voice/speed', async () => {
      const mockPipeline = createMockPipeline();
      const mockModule = createMockKokoroModule(mockPipeline);
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend();

      await backend.synthesize(baseOptions);

      expect(mockPipeline.generate).toHaveBeenCalledWith(
        'Hello world',
        { voice: 'af_heart', speed: 1.0 },
      );
    });

    it('uses custom voice from options when provided', async () => {
      const mockPipeline = createMockPipeline();
      const mockModule = createMockKokoroModule(mockPipeline);
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend();

      await backend.synthesize({ text: 'Hi', voice: 'am_adam' });

      expect(mockPipeline.generate).toHaveBeenCalledWith(
        'Hi',
        { voice: 'am_adam', speed: 1.0 },
      );
    });

    it('uses custom rate from options when provided', async () => {
      const mockPipeline = createMockPipeline();
      const mockModule = createMockKokoroModule(mockPipeline);
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend();

      await backend.synthesize({ text: 'Hi', rate: 1.5 });

      expect(mockPipeline.generate).toHaveBeenCalledWith(
        'Hi',
        { voice: 'af_heart', speed: 1.5 },
      );
    });

    it('uses both custom voice and rate when provided', async () => {
      const mockPipeline = createMockPipeline();
      const mockModule = createMockKokoroModule(mockPipeline);
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend();

      await backend.synthesize({ text: 'Hi', voice: 'bf_emma', rate: 0.8 });

      expect(mockPipeline.generate).toHaveBeenCalledWith(
        'Hi',
        { voice: 'bf_emma', speed: 0.8 },
      );
    });

    it('uses custom defaultSpeaker from createKokoroBackend when options.voice is absent', async () => {
      const mockPipeline = createMockPipeline();
      const mockModule = createMockKokoroModule(mockPipeline);
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend(undefined, 'am_michael');

      await backend.synthesize({ text: 'Hi' });

      expect(mockPipeline.generate).toHaveBeenCalledWith(
        'Hi',
        { voice: 'am_michael', speed: 1.0 },
      );
    });

    it('uses custom modelId when constructing the pipeline', async () => {
      const mockPipeline = createMockPipeline();
      const mockModule = createMockKokoroModule(mockPipeline);
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend('custom-model-v2');

      await backend.synthesize(baseOptions);

      expect(mockModule.KokoroTTS).toHaveBeenCalledWith('custom-model-v2');
    });

    it('uses default modelId when none is specified', async () => {
      const mockPipeline = createMockPipeline();
      const mockModule = createMockKokoroModule(mockPipeline);
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend();

      await backend.synthesize(baseOptions);

      expect(mockModule.KokoroTTS).toHaveBeenCalledWith('kokoro-en-v0_19');
    });

    /* -------------------------------------------------------------- */
    /* Result shape                                                   */
    /* -------------------------------------------------------------- */

    describe('result shape', () => {
      it('returns format "wav"', async () => {
        const mockModule = createMockKokoroModule();
        const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
        const backend = createKokoroBackend();

        const result = await backend.synthesize(baseOptions);

        expect(result.format).toBe('wav');
      });

      it('returns backend "kokoro"', async () => {
        const mockModule = createMockKokoroModule();
        const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
        const backend = createKokoroBackend();

        const result = await backend.synthesize(baseOptions);

        expect(result.backend).toBe('kokoro');
      });

      it('returns a Buffer containing valid WAV data', async () => {
        const mockModule = createMockKokoroModule();
        const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
        const backend = createKokoroBackend();

        const result = await backend.synthesize(baseOptions);

        expect(result.audio).toBeInstanceOf(Buffer);
        expect(result.audio.toString('ascii', 0, 4)).toBe('RIFF');
        expect(result.audio.toString('ascii', 8, 12)).toBe('WAVE');
      });

      it('calculates durationSec from audio length and sampling_rate', async () => {
        const mockPipeline = createMockPipeline(async () => ({
          audio: new Float32Array(44100), // 44100 samples
          sampling_rate: 22050,           // 22050 Hz
        }));
        const mockModule = createMockKokoroModule(mockPipeline);
        const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
        const backend = createKokoroBackend();

        const result = await backend.synthesize(baseOptions);

        // 44100 / 22050 = 2.0 seconds
        expect(result.durationSec).toBeCloseTo(2.0, 2);
      });

      it('includes the generated WAV audio with correct sample data', async () => {
        const testSamples = new Float32Array([0.0, 1.0, -1.0]);
        const mockPipeline = createMockPipeline(async () => ({
          audio: testSamples,
          sampling_rate: 16000,
        }));
        const mockModule = createMockKokoroModule(mockPipeline);
        const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
        const backend = createKokoroBackend();

        const result = await backend.synthesize(baseOptions);

        // Verify the WAV data portion has correct int16 values
        expect(result.audio.readInt16LE(44)).toBe(0);
        expect(result.audio.readInt16LE(46)).toBe(0x7FFF);
        expect(result.audio.readInt16LE(48)).toBe(-0x8000);
      });
    });

    /* -------------------------------------------------------------- */
    /* Pipeline caching                                                */
    /* -------------------------------------------------------------- */

    describe('pipeline caching', () => {
      it('reuses the same pipeline for multiple synthesize calls', async () => {
        const mockPipeline = createMockPipeline();
        const mockModule = createMockKokoroModule(mockPipeline);
        const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
        const backend = createKokoroBackend();

        await backend.synthesize({ text: 'First' });
        await backend.synthesize({ text: 'Second' });
        await backend.synthesize({ text: 'Third' });

        // KokoroTTS constructor called only once
        expect(mockModule.KokoroTTS).toHaveBeenCalledTimes(1);
        // generate called three times
        expect(mockPipeline.generate).toHaveBeenCalledTimes(3);
      });
    });

    /* -------------------------------------------------------------- */
    /* Error handling                                                  */
    /* -------------------------------------------------------------- */

    describe('error handling', () => {
      it('throws when kokoro-js is not installed', async () => {
        const { createKokoroBackend } = await freshImportWithoutKokoro();
        const backend = createKokoroBackend();

        await expect(backend.synthesize(baseOptions)).rejects.toThrow(
          'kokoro-js is not installed',
        );
      });

      it('throws with install instructions when kokoro-js is unavailable', async () => {
        const { createKokoroBackend } = await freshImportWithoutKokoro();
        const backend = createKokoroBackend();

        await expect(backend.synthesize(baseOptions)).rejects.toThrow(
          'npm install kokoro-js',
        );
      });

      it('throws when pipeline.generate fails', async () => {
        const mockPipeline = createMockPipeline(async () => {
          throw new Error('Model inference failed');
        });
        const mockModule = createMockKokoroModule(mockPipeline);
        const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
        const backend = createKokoroBackend();

        await expect(backend.synthesize(baseOptions)).rejects.toThrow(
          'Kokoro synthesis failed: Model inference failed',
        );
      });

      it('wraps non-Error throws from pipeline.generate', async () => {
        const mockPipeline = createMockPipeline(async () => {
          throw 'string error';
        });
        const mockModule = createMockKokoroModule(mockPipeline);
        const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
        const backend = createKokoroBackend();

        await expect(backend.synthesize(baseOptions)).rejects.toThrow(
          'Kokoro synthesis failed: string error',
        );
      });

      it('returns null pipeline when KokoroTTS constructor throws', async () => {
        vi.resetModules();
        vi.doMock('../../../src/utils/logger.js', () => ({
          createModuleLogger: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
          }),
        }));
        vi.doMock('kokoro-js', () => ({
          KokoroTTS: vi.fn(() => {
            throw new Error('Failed to load model');
          }),
        }));
        const { createKokoroBackend } = await import('../../../src/voice/tts-kokoro.js');
        const backend = createKokoroBackend();

        await expect(backend.synthesize(baseOptions)).rejects.toThrow(
          'kokoro-js is not installed',
        );
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /* Default parameters                                               */
  /* ---------------------------------------------------------------- */

  describe('default parameters', () => {
    it('uses default modelId "kokoro-en-v0_19" when not specified', async () => {
      const mockPipeline = createMockPipeline();
      const mockModule = createMockKokoroModule(mockPipeline);
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend();

      await backend.synthesize({ text: 'test' });

      expect(mockModule.KokoroTTS).toHaveBeenCalledWith('kokoro-en-v0_19');
    });

    it('uses default speaker "af_heart" when not specified', async () => {
      const mockPipeline = createMockPipeline();
      const mockModule = createMockKokoroModule(mockPipeline);
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend();

      await backend.synthesize({ text: 'test' });

      expect(mockPipeline.generate).toHaveBeenCalledWith(
        'test',
        { voice: 'af_heart', speed: 1.0 },
      );
    });

    it('uses default speed 1.0 when rate is not specified', async () => {
      const mockPipeline = createMockPipeline();
      const mockModule = createMockKokoroModule(mockPipeline);
      const { createKokoroBackend } = await freshImportWithKokoro(mockModule);
      const backend = createKokoroBackend();

      await backend.synthesize({ text: 'test' });

      expect(mockPipeline.generate).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ speed: 1.0 }),
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /* Module cache isolation between fresh imports                     */
  /* ---------------------------------------------------------------- */

  describe('module cache isolation', () => {
    it('does not share pipeline state across freshImport calls', async () => {
      // First fresh import with a working kokoro module
      const mockModule1 = createMockKokoroModule();
      const { createKokoroBackend: factory1 } = await freshImportWithKokoro(mockModule1);
      const backend1 = factory1();
      await backend1.synthesize({ text: 'first' });

      // Second fresh import — should start with clean state
      const mockModule2 = createMockKokoroModule();
      const { createKokoroBackend: factory2 } = await freshImportWithKokoro(mockModule2);
      const backend2 = factory2();
      await backend2.synthesize({ text: 'second' });

      // Each module should have its own KokoroTTS call
      expect(mockModule1.KokoroTTS).toHaveBeenCalledTimes(1);
      expect(mockModule2.KokoroTTS).toHaveBeenCalledTimes(1);
    });
  });
});
