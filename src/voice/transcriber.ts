/**
 * Audio transcription module for Lil Dude.
 * Provides speech-to-text via Groq cloud (Whisper) or local stub.
 * Tracks cost based on audio duration.
 * See S4.T.2 for voice input/output feature.
 */

import { ProviderError } from '../errors.js';
import { createModuleLogger, securityLogger } from '../utils/logger.js';

const log = createModuleLogger('voice-transcriber');

/** Maximum audio file size in bytes (25 MB) */
const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;

/** Groq Whisper API endpoint */
const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/** Groq Whisper model identifier */
const GROQ_WHISPER_MODEL = 'whisper-large-v3';

/** Cost per hour of audio for Groq Whisper in USD */
const GROQ_WHISPER_COST_PER_HOUR_USD = 0.111;

/** Supported audio MIME types for transcription */
const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
  'audio/x-m4a',
]);

/** Options for configuring the transcription backend and behavior */
export interface TranscribeOptions {
  backend: 'groq' | 'local';
  apiKey?: string;
  language?: string;
}

/** Result returned after successful transcription */
export interface TranscribeResult {
  text: string;
  language: string;
  durationMs: number;
  backend: 'groq' | 'local';
}

/** Response shape from the Groq Whisper API */
interface GroqWhisperResponse {
  text: string;
  x_groq?: {
    id?: string;
  };
}

/**
 * Calculate the transcription cost in USD based on audio duration.
 *
 * @param durationMs - Audio duration in milliseconds
 * @returns Cost in USD
 */
export function calculateTranscriptionCost(durationMs: number): number {
  const hours = durationMs / (1000 * 60 * 60);
  return hours * GROQ_WHISPER_COST_PER_HOUR_USD;
}

/**
 * Validate that the audio data meets requirements before transcription.
 * Checks file size and MIME type.
 *
 * @param audioData - The raw audio buffer
 * @param mimeType - The MIME type of the audio
 * @throws ProviderError if validation fails
 */
function validateAudioInput(audioData: Buffer, mimeType?: string): void {
  if (audioData.length === 0) {
    throw new ProviderError(
      'Audio data is empty',
      'voice-transcriber',
      false,
    );
  }

  if (audioData.length > MAX_AUDIO_SIZE_BYTES) {
    throw new ProviderError(
      `Audio file too large: ${Math.round(audioData.length / (1024 * 1024))}MB exceeds ${MAX_AUDIO_SIZE_BYTES / (1024 * 1024)}MB limit`,
      'voice-transcriber',
      false,
    );
  }

  if (mimeType && !SUPPORTED_AUDIO_TYPES.has(mimeType)) {
    throw new ProviderError(
      `Unsupported audio format: ${mimeType}. Supported: ${[...SUPPORTED_AUDIO_TYPES].join(', ')}`,
      'voice-transcriber',
      false,
    );
  }
}

/**
 * Derive a file extension from a MIME type for the multipart form upload.
 *
 * @param mimeType - The MIME type string
 * @returns A file extension string including the dot
 */
function extensionFromMimeType(mimeType?: string): string {
  const extensionMap: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.mp4',
    'audio/wav': '.wav',
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/flac': '.flac',
    'audio/x-m4a': '.m4a',
  };
  return extensionMap[mimeType ?? ''] ?? '.mp3';
}

/**
 * Transcribe audio using the Groq Whisper cloud API.
 *
 * @param audioData - Raw audio buffer
 * @param options - Transcription options including API key and language
 * @param mimeType - Optional MIME type of the audio
 * @returns TranscribeResult with transcribed text and metadata
 * @throws ProviderError on API failures or missing API key
 */
async function transcribeWithGroq(
  audioData: Buffer,
  options: TranscribeOptions,
  mimeType?: string,
): Promise<TranscribeResult> {
  if (!options.apiKey) {
    throw new ProviderError(
      'Groq API key is required for cloud transcription',
      'voice-transcriber',
      false,
    );
  }

  const startTime = Date.now();
  const extension = extensionFromMimeType(mimeType);
  const filename = `audio${extension}`;

  const formData = new FormData();
  const blob = new Blob([audioData], { type: mimeType ?? 'audio/mpeg' });
  formData.append('file', blob, filename);
  formData.append('model', GROQ_WHISPER_MODEL);

  if (options.language) {
    formData.append('language', options.language);
  }

  try {
    const response = await fetch(GROQ_WHISPER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${options.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');

      if (response.status === 429) {
        throw new ProviderError(
          `Groq API rate limited: ${errorBody}`,
          'voice-transcriber',
          true,
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          `Groq API authentication failed: ${errorBody}`,
          'voice-transcriber',
          false,
        );
      }

      throw new ProviderError(
        `Groq API error (${response.status}): ${errorBody}`,
        'voice-transcriber',
        response.status >= 500,
      );
    }

    const result = await response.json() as GroqWhisperResponse;
    const durationMs = Date.now() - startTime;
    const costUsd = calculateTranscriptionCost(durationMs);

    log.info(
      { durationMs, costUsd, textLength: result.text.length },
      'Groq transcription completed',
    );

    return {
      text: result.text,
      language: options.language ?? 'en',
      durationMs,
      backend: 'groq',
    };
  } catch (error: unknown) {
    if (error instanceof ProviderError) {
      throw error;
    }

    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
      throw new ProviderError(
        `Network error connecting to Groq: ${error.message}`,
        'voice-transcriber',
        true,
      );
    }

    throw new ProviderError(
      `Groq transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      'voice-transcriber',
      false,
    );
  }
}

/**
 * Stub transcription for local whisper.cpp backend.
 * Logs that local transcription would run but returns a placeholder result.
 *
 * @param audioData - Raw audio buffer
 * @param options - Transcription options
 * @returns TranscribeResult with a placeholder message
 */
async function transcribeWithLocal(
  audioData: Buffer,
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  log.info(
    { audioSizeBytes: audioData.length, language: options.language },
    'Local whisper.cpp transcription would run here (stub)',
  );

  return {
    text: '[Local transcription stub — whisper.cpp not yet integrated]',
    language: options.language ?? 'en',
    durationMs: 0,
    backend: 'local',
  };
}

/**
 * Transcribe audio data to text using the configured backend.
 * Validates input, routes to the appropriate backend (Groq cloud or local stub),
 * and logs security-relevant actions.
 *
 * @param audioData - The raw audio buffer to transcribe
 * @param options - Configuration for backend selection, API key, and language
 * @param mimeType - Optional MIME type of the audio for format validation
 * @returns A TranscribeResult containing the transcribed text and metadata
 * @throws ProviderError on validation failures, API errors, or missing configuration
 */
export async function transcribeAudio(
  audioData: Buffer,
  options: TranscribeOptions,
  mimeType?: string,
): Promise<TranscribeResult> {
  try {
    validateAudioInput(audioData, mimeType);

    securityLogger.info(
      {
        action: 'voice_transcription',
        backend: options.backend,
        audioSizeBytes: audioData.length,
      },
      'Processing audio transcription request',
    );

    if (options.backend === 'groq') {
      return await transcribeWithGroq(audioData, options, mimeType);
    }

    return await transcribeWithLocal(audioData, options);
  } catch (error: unknown) {
    if (error instanceof ProviderError) {
      throw error;
    }

    throw new ProviderError(
      `Transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      'voice-transcriber',
      false,
    );
  }
}
