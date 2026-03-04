/**
 * TTS backend using kokoro-js (local neural text-to-speech).
 * Kokoro is a lightweight neural TTS model that runs entirely locally.
 * Provides higher quality speech than OS native TTS but requires
 * ~82 MB model download on first use.
 *
 * Uses the kokoro-js npm package (MIT license).
 * Falls back gracefully if the package is not installed.
 *
 * See: https://github.com/hexgrad/kokoro
 */

import type {
  TtsBackend,
  TtsBackendName,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  TtsVoiceInfo,
} from './types.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('tts-kokoro');

/** Default kokoro model ID. */
const DEFAULT_MODEL_ID = 'kokoro-en-v0_19';

/** Default speaker voice. */
const DEFAULT_SPEAKER = 'af_heart';

/** Available kokoro voices (built into the model). */
const KOKORO_VOICES: TtsVoiceInfo[] = [
  { id: 'af_heart', name: 'Heart (Female)', language: 'en', gender: 'female' },
  { id: 'af_bella', name: 'Bella (Female)', language: 'en', gender: 'female' },
  { id: 'af_nicole', name: 'Nicole (Female)', language: 'en', gender: 'female' },
  { id: 'af_sarah', name: 'Sarah (Female)', language: 'en', gender: 'female' },
  { id: 'af_sky', name: 'Sky (Female)', language: 'en', gender: 'female' },
  { id: 'am_adam', name: 'Adam (Male)', language: 'en', gender: 'male' },
  { id: 'am_michael', name: 'Michael (Male)', language: 'en', gender: 'male' },
  { id: 'bf_emma', name: 'Emma (British Female)', language: 'en-GB', gender: 'female' },
  { id: 'bm_george', name: 'George (British Male)', language: 'en-GB', gender: 'male' },
];

/** Kokoro pipeline instance (lazy-loaded). */
let kokoroPipeline: KokoroPipeline | null = null;

/** Kokoro module reference (lazy-loaded). */
let kokoroModule: KokoroModule | null = null;

/** Minimal type for the kokoro-js pipeline. */
interface KokoroPipeline {
  generate(text: string, options?: { voice?: string; speed?: number }): Promise<KokoroResult>;
}

/** Minimal type for kokoro-js result. */
interface KokoroResult {
  audio: Float32Array;
  sampling_rate: number;
}

/** Minimal type for the kokoro-js module. */
interface KokoroModule {
  KokoroTTS: new (modelId: string) => KokoroPipeline;
}

/**
 * Attempt to import the kokoro-js module.
 * Returns null if the package is not installed.
 */
async function loadKokoroModule(): Promise<KokoroModule | null> {
  if (kokoroModule) return kokoroModule;

  try {
    // Dynamic import — won't fail at module load time if kokoro-js isn't installed
    const mod = await import('kokoro-js') as unknown as KokoroModule;
    kokoroModule = mod;
    return mod;
  } catch {
    log.debug('kokoro-js package not installed — kokoro TTS backend unavailable');
    return null;
  }
}

/**
 * Initialize or return the lazy-loaded kokoro pipeline.
 *
 * @param modelId - The kokoro model to load.
 * @returns The initialized pipeline or null if unavailable.
 */
async function getOrCreatePipeline(modelId: string): Promise<KokoroPipeline | null> {
  if (kokoroPipeline) return kokoroPipeline;

  const mod = await loadKokoroModule();
  if (!mod) return null;

  try {
    log.info({ modelId }, 'Initializing kokoro TTS pipeline (first use may download model)');
    const pipeline = new mod.KokoroTTS(modelId);
    kokoroPipeline = pipeline;
    log.info({ modelId }, 'Kokoro TTS pipeline ready');
    return pipeline;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message, modelId }, 'Failed to initialize kokoro TTS pipeline');
    return null;
  }
}

/**
 * Convert Float32Array PCM audio to a WAV buffer.
 *
 * @param samples - Float32 audio samples (-1.0 to 1.0).
 * @param sampleRate - The sample rate in Hz.
 * @returns A Buffer containing a valid WAV file.
 */
export function pcmToWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);

  const buffer = Buffer.alloc(44 + dataSize);

  // WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20);  // AudioFormat (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Convert float32 samples to int16
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    buffer.writeInt16LE(Math.round(int16), 44 + i * 2);
  }

  return buffer;
}

/**
 * Create a TTS backend using kokoro-js neural text-to-speech.
 * Requires the kokoro-js npm package to be installed.
 * Falls back gracefully if not available.
 *
 * @param modelId - The kokoro model ID (default: 'kokoro-en-v0_19').
 * @param defaultSpeaker - The default speaker voice (default: 'af_heart').
 * @returns A TtsBackend implementation using kokoro-js.
 */
export function createKokoroBackend(
  modelId: string = DEFAULT_MODEL_ID,
  defaultSpeaker: string = DEFAULT_SPEAKER,
): TtsBackend {
  return {
    name: 'kokoro' as TtsBackendName,

    async isAvailable(): Promise<boolean> {
      const mod = await loadKokoroModule();
      return mod !== null;
    },

    async listVoices(): Promise<TtsVoiceInfo[]> {
      return KOKORO_VOICES;
    },

    async synthesize(options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
      const pipeline = await getOrCreatePipeline(modelId);
      if (!pipeline) {
        throw new Error(
          'kokoro-js is not installed. Install with: npm install kokoro-js',
        );
      }

      const voice = options.voice ?? defaultSpeaker;
      const speed = options.rate ?? 1.0;

      try {
        const startTime = Date.now();

        const result = await pipeline.generate(options.text, { voice, speed });

        const wavBuffer = pcmToWav(result.audio, result.sampling_rate);
        const durationSec = result.audio.length / result.sampling_rate;
        const elapsedMs = Date.now() - startTime;

        log.info(
          {
            textLength: options.text.length,
            audioBytes: wavBuffer.length,
            durationSec: Math.round(durationSec * 100) / 100,
            elapsedMs,
            voice,
          },
          'Kokoro TTS synthesis complete',
        );

        return {
          audio: wavBuffer,
          format: 'wav',
          durationSec,
          backend: 'kokoro',
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ error: message, voice }, 'Kokoro TTS synthesis failed');
        throw new Error(`Kokoro synthesis failed: ${message}`);
      }
    },
  };
}
