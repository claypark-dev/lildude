/**
 * Text-to-speech synthesis module for Lil Dude.
 * Provides TTS via ElevenLabs cloud or local stub.
 * See S4.T.2 for voice input/output feature.
 */

import { ProviderError } from '../errors.js';
import { createModuleLogger, securityLogger } from '../utils/logger.js';

const log = createModuleLogger('voice-synthesizer');

/** ElevenLabs TTS API base URL */
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

/** Default ElevenLabs voice ID (Adam) */
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';

/** Default ElevenLabs model */
const DEFAULT_ELEVENLABS_MODEL = 'eleven_monolingual_v1';

/** Maximum text length in characters for a single synthesis request */
const MAX_TEXT_LENGTH = 5000;

/** Options for configuring the speech synthesis backend and behavior */
export interface SynthesizeOptions {
  backend: 'elevenlabs' | 'local';
  apiKey?: string;
  voiceId?: string;
  model?: string;
}

/** Result returned after successful speech synthesis */
export interface SynthesizeResult {
  audioData: Buffer;
  mimeType: string;
  durationMs: number;
  backend: 'elevenlabs' | 'local';
}

/**
 * Validate text input before synthesis.
 * Checks for empty text and length limits.
 *
 * @param text - The text to synthesize
 * @throws ProviderError if validation fails
 */
function validateTextInput(text: string): void {
  if (!text || text.trim().length === 0) {
    throw new ProviderError(
      'Text for synthesis cannot be empty',
      'voice-synthesizer',
      false,
    );
  }

  if (text.length > MAX_TEXT_LENGTH) {
    throw new ProviderError(
      `Text too long for synthesis: ${text.length} characters exceeds ${MAX_TEXT_LENGTH} character limit`,
      'voice-synthesizer',
      false,
    );
  }
}

/**
 * Synthesize speech using the ElevenLabs cloud API.
 *
 * @param text - The text to convert to speech
 * @param options - Synthesis options including API key, voice ID, and model
 * @returns SynthesizeResult with audio data buffer and metadata
 * @throws ProviderError on API failures or missing API key
 */
async function synthesizeWithElevenLabs(
  text: string,
  options: SynthesizeOptions,
): Promise<SynthesizeResult> {
  if (!options.apiKey) {
    throw new ProviderError(
      'ElevenLabs API key is required for cloud synthesis',
      'voice-synthesizer',
      false,
    );
  }

  const voiceId = options.voiceId ?? DEFAULT_VOICE_ID;
  const modelId = options.model ?? DEFAULT_ELEVENLABS_MODEL;
  const url = `${ELEVENLABS_API_BASE}/${voiceId}`;
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': options.apiKey,
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');

      if (response.status === 429) {
        throw new ProviderError(
          `ElevenLabs API rate limited: ${errorBody}`,
          'voice-synthesizer',
          true,
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          `ElevenLabs API authentication failed: ${errorBody}`,
          'voice-synthesizer',
          false,
        );
      }

      throw new ProviderError(
        `ElevenLabs API error (${response.status}): ${errorBody}`,
        'voice-synthesizer',
        response.status >= 500,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioData = Buffer.from(arrayBuffer);
    const durationMs = Date.now() - startTime;

    log.info(
      { durationMs, audioSizeBytes: audioData.length, voiceId },
      'ElevenLabs synthesis completed',
    );

    return {
      audioData,
      mimeType: 'audio/mpeg',
      durationMs,
      backend: 'elevenlabs',
    };
  } catch (error: unknown) {
    if (error instanceof ProviderError) {
      throw error;
    }

    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
      throw new ProviderError(
        `Network error connecting to ElevenLabs: ${error.message}`,
        'voice-synthesizer',
        true,
      );
    }

    throw new ProviderError(
      `ElevenLabs synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
      'voice-synthesizer',
      false,
    );
  }
}

/**
 * Local TTS backend using Ollama.
 * Checks if Ollama is running; if not, returns an empty buffer as a stub.
 * Future: integrate with a TTS-capable Ollama model.
 *
 * @param text - The text to synthesize
 * @returns SynthesizeResult with audio data (or empty buffer if Ollama TTS unavailable)
 */
async function synthesizeWithLocal(
  text: string,
): Promise<SynthesizeResult> {
  const startTime = Date.now();

  // Check if Ollama is running
  try {
    const versionRes = await fetch('http://localhost:11434/api/version', {
      signal: AbortSignal.timeout(3000),
    });

    if (versionRes.ok) {
      log.info(
        { textLength: text.length },
        'Ollama is running but TTS model support not yet available — install a TTS-capable model for local synthesis',
      );
    }
  } catch {
    log.info(
      { textLength: text.length },
      'Ollama not available for local TTS — start Ollama and install a TTS-capable model',
    );
  }

  return {
    audioData: Buffer.alloc(0),
    mimeType: 'audio/wav',
    durationMs: Date.now() - startTime,
    backend: 'local',
  };
}

/**
 * Synthesize speech from text using the configured backend.
 * Validates input, routes to the appropriate backend (ElevenLabs cloud or local stub),
 * and logs security-relevant actions.
 *
 * @param text - The text to convert to speech
 * @param options - Configuration for backend selection, API key, voice ID, and model
 * @returns A SynthesizeResult containing the audio data buffer and metadata
 * @throws ProviderError on validation failures, API errors, or missing configuration
 */
export async function synthesizeSpeech(
  text: string,
  options: SynthesizeOptions,
): Promise<SynthesizeResult> {
  try {
    validateTextInput(text);

    securityLogger.info(
      {
        action: 'voice_synthesis',
        backend: options.backend,
        textLength: text.length,
      },
      'Processing speech synthesis request',
    );

    if (options.backend === 'elevenlabs') {
      return await synthesizeWithElevenLabs(text, options);
    }

    return await synthesizeWithLocal(text);
  } catch (error: unknown) {
    if (error instanceof ProviderError) {
      throw error;
    }

    throw new ProviderError(
      `Synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
      'voice-synthesizer',
      false,
    );
  }
}
