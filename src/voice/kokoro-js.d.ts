/**
 * Minimal type declarations for the kokoro-js package.
 * kokoro-js is an optional dependency for neural TTS.
 * These declarations cover only the API surface used by tts-kokoro.ts.
 */
declare module 'kokoro-js' {
  export class KokoroTTS {
    constructor(modelId: string);
    generate(
      text: string,
      options?: { voice?: string; speed?: number },
    ): Promise<{ audio: Float32Array; sampling_rate: number }>;
  }
}
