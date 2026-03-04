/**
 * Voice module coordinator for Lil Dude.
 * Creates a VoiceProcessor that delegates to the transcriber and TTS router,
 * gated behind hardware capability checks and install tier.
 * See S4.T.2 for voice input/output feature.
 */

import { transcribeAudio } from './transcriber.js';
import type { TranscribeResult } from './transcriber.js';
import { synthesizeSpeech } from './tts-router.js';
import type { TtsSynthesizeResult } from './types.js';
import type { Attachment, HardwareProfile, InstallTier } from '../types/index.js';
import type { Config } from '../config/schema.js';
import { createModuleLogger, securityLogger } from '../utils/logger.js';
import { ProviderError } from '../errors.js';

const log = createModuleLogger('voice');

/** Voice processor that handles audio transcription and speech synthesis */
export interface VoiceProcessor {
  /** Transcribe an audio attachment to text */
  processAudioAttachment(attachment: Attachment): Promise<TranscribeResult>;
  /** Generate an audio response from text, or null if synthesis is disabled */
  generateAudioResponse(text: string): Promise<TtsSynthesizeResult | null>;
  /** Check whether voice processing is enabled */
  isEnabled(): boolean;
}

/**
 * Determine whether voice features should be enabled based on hardware and config.
 * Voice is enabled if the user explicitly enables it OR if hardware supports it.
 *
 * @param config - The application configuration.
 * @param hardwareFeatures - Optional hardware feature flags.
 * @returns True if voice processing should be enabled.
 */
function shouldEnableVoice(
  config: Config,
  hardwareFeatures?: HardwareProfile['features'],
): boolean {
  if (config.voice.enabled) {
    return true;
  }

  if (hardwareFeatures?.voice) {
    return true;
  }

  return false;
}

/**
 * Create a VoiceProcessor configured with the given options.
 * The processor delegates transcription to the transcriber module
 * and synthesis to the TTS router (say/kokoro/elevenlabs backends).
 *
 * @param config - The application configuration.
 * @param tier - The current install tier.
 * @param hardwareFeatures - Optional hardware features for capability gating.
 * @returns A VoiceProcessor instance.
 */
export function createVoiceProcessor(
  config: Config,
  tier: InstallTier,
  hardwareFeatures?: HardwareProfile['features'],
): VoiceProcessor {
  const enabled = shouldEnableVoice(config, hardwareFeatures);

  if (enabled) {
    log.info(
      {
        transcriptionBackend: config.voice.transcription.backend,
        synthesisBackend: config.voice.synthesis.backend,
        synthesisEnabled: config.voice.synthesis.enabled,
      },
      'Voice processor initialized',
    );
  } else {
    log.info('Voice processor disabled (not enabled in config and hardware does not meet requirements)');
  }

  return {
    async processAudioAttachment(attachment: Attachment): Promise<TranscribeResult> {
      if (!enabled) {
        throw new ProviderError(
          'Voice processing is not enabled',
          'voice',
          false,
        );
      }

      try {
        const audioData = attachment.data;
        if (!audioData) {
          throw new ProviderError(
            'Audio attachment has no data buffer',
            'voice',
            false,
          );
        }

        securityLogger.info(
          {
            action: 'voice_process_attachment',
            mimeType: attachment.mimeType,
            sizeBytes: attachment.size ?? audioData.length,
          },
          'Processing audio attachment for transcription',
        );

        return await transcribeAudio(audioData, {
          backend: config.voice.transcription.backend,
          apiKey: config.voice.transcription.groqApiKey,
          language: config.voice.transcription.language,
        }, attachment.mimeType);
      } catch (error: unknown) {
        if (error instanceof ProviderError) {
          throw error;
        }

        throw new ProviderError(
          `Audio attachment processing failed: ${error instanceof Error ? error.message : String(error)}`,
          'voice',
          false,
        );
      }
    },

    async generateAudioResponse(text: string): Promise<TtsSynthesizeResult | null> {
      if (!enabled) {
        return null;
      }

      if (!config.voice.synthesis.enabled) {
        return null;
      }

      try {
        securityLogger.info(
          {
            action: 'voice_generate_response',
            textLength: text.length,
            backend: config.voice.synthesis.backend,
          },
          'Generating audio response',
        );

        return await synthesizeSpeech(config, text, tier);
      } catch (error: unknown) {
        if (error instanceof ProviderError) {
          throw error;
        }

        throw new ProviderError(
          `Audio response generation failed: ${error instanceof Error ? error.message : String(error)}`,
          'voice',
          false,
        );
      }
    },

    isEnabled(): boolean {
      return enabled;
    },
  };
}

// Re-export types and functions for convenience
export type { TranscribeOptions, TranscribeResult } from './transcriber.js';
export { transcribeAudio, calculateTranscriptionCost } from './transcriber.js';
export type { TtsSynthesizeOptions, TtsSynthesizeResult, TtsBackend, TtsVoiceInfo } from './types.js';
export { synthesizeSpeech, listAvailableVoices, isTtsAvailable, resetTtsCache } from './tts-router.js';
