/**
 * Shared types for the voice / text-to-speech subsystem.
 * All TTS backends implement the TtsBackend interface.
 */

/** Options for synthesizing speech. */
export interface TtsSynthesizeOptions {
  /** The text to convert to speech. */
  text: string;
  /** Optional voice name/ID (backend-specific). */
  voice?: string;
  /** Speaking rate multiplier (1.0 = normal). */
  rate?: number;
  /** Output format hint. */
  format?: 'wav' | 'mp3' | 'pcm';
}

/** Result of a TTS synthesis operation. */
export interface TtsSynthesizeResult {
  /** The generated audio data. */
  audio: Buffer;
  /** The audio format. */
  format: 'wav' | 'mp3' | 'pcm';
  /** Duration of the audio in seconds (estimated). */
  durationSec: number;
  /** The backend that produced this audio. */
  backend: TtsBackendName;
}

/** Available TTS backend names. */
export type TtsBackendName = 'say' | 'kokoro' | 'elevenlabs';

/**
 * Interface all TTS backends must implement.
 * Allows uniform access regardless of the underlying engine.
 */
export interface TtsBackend {
  /** Human-readable name of the backend. */
  readonly name: TtsBackendName;

  /**
   * Check if this backend is available on the current system.
   * @returns True if the backend can be used.
   */
  isAvailable(): Promise<boolean>;

  /**
   * List available voices for this backend.
   * @returns Array of voice identifiers.
   */
  listVoices(): Promise<TtsVoiceInfo[]>;

  /**
   * Synthesize text to speech.
   * @param options - Synthesis options including text, voice, and rate.
   * @returns The synthesized audio result.
   */
  synthesize(options: TtsSynthesizeOptions): Promise<TtsSynthesizeResult>;
}

/** Information about an available TTS voice. */
export interface TtsVoiceInfo {
  /** Voice identifier (used in synthesis). */
  id: string;
  /** Display name. */
  name: string;
  /** Language code (e.g., 'en', 'es'). */
  language: string;
  /** Gender hint. */
  gender?: 'male' | 'female' | 'neutral';
}
