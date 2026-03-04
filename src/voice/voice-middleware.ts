/**
 * Voice middleware for the message processing pipeline.
 * Handles inbound audio transcription and outbound TTS synthesis.
 *
 * Inbound: If a ChannelMessage has audio attachments, transcribes them
 * and prepends the transcribed text to the message text.
 *
 * Outbound: If voice synthesis is enabled and the original message
 * was a voice message, generates TTS audio for the response.
 *
 * This module sits between the channel adapters and the agent loop,
 * keeping both layers unaware of voice processing details.
 */

import type { Attachment, AudioAttachment, ChannelMessage, InstallTier } from '../types/index.js';
import type { Config } from '../config/schema.js';
import type { TtsSynthesizeResult } from './types.js';
import { transcribeAudio } from './transcriber.js';
import { synthesizeSpeech, isTtsAvailable } from './tts-router.js';
import { isFeatureEnabled } from '../tiers/feature-gate.js';
import { createModuleLogger, securityLogger } from '../utils/logger.js';

const log = createModuleLogger('voice-middleware');

/** Maximum audio attachment size for transcription (25 MB). */
const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;

/** Supported audio MIME types for transcription. */
const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
]);

/** Result of processing inbound voice. */
export interface VoiceInboundResult {
  /** The message text (original + any transcriptions prepended). */
  text: string;
  /** Whether the original message contained audio. */
  hadAudio: boolean;
  /** Number of audio attachments successfully transcribed. */
  transcribedCount: number;
}

/** Result of generating outbound voice. */
export interface VoiceOutboundResult {
  /** The audio attachment to send, or null if TTS is unavailable/disabled. */
  audioAttachment: AudioAttachment | null;
}

/**
 * Check if an attachment is a supported audio type for transcription.
 *
 * @param attachment - The attachment to check.
 * @returns True if the attachment is a transcribable audio file.
 */
export function isTranscribableAudio(attachment: Attachment): boolean {
  if (attachment.type !== 'audio') return false;
  if (!attachment.data && !attachment.url) return false;
  if (!SUPPORTED_AUDIO_TYPES.has(attachment.mimeType)) return false;
  if (attachment.data && attachment.data.length > MAX_AUDIO_SIZE_BYTES) return false;
  return true;
}

/**
 * Process inbound voice: transcribe audio attachments on a ChannelMessage.
 * If the message has audio attachments, transcribes them and prepends
 * the transcription to the message text.
 *
 * @param msg - The incoming channel message.
 * @param config - Application configuration.
 * @param tier - Current install tier.
 * @returns The processed text and transcription metadata.
 */
export async function processInboundVoice(
  msg: ChannelMessage,
  config: Config,
  tier: InstallTier,
): Promise<VoiceInboundResult> {
  const audioAttachments = msg.attachments.filter(isTranscribableAudio);

  if (audioAttachments.length === 0) {
    return { text: msg.text, hadAudio: false, transcribedCount: 0 };
  }

  // Check if voice features are available at this tier
  if (!isFeatureEnabled(tier, 'voice_synthesis')) {
    log.info(
      { tier, audioCount: audioAttachments.length },
      'Voice features not available at this tier — skipping transcription',
    );
    return { text: msg.text, hadAudio: true, transcribedCount: 0 };
  }

  // Check if voice is enabled in config
  if (!config.voice.enabled) {
    log.debug('Voice not enabled in config — skipping transcription');
    return { text: msg.text, hadAudio: true, transcribedCount: 0 };
  }

  const transcriptions: string[] = [];
  let transcribedCount = 0;

  for (const attachment of audioAttachments) {
    try {
      if (!attachment.data) {
        log.debug('Audio attachment has no data buffer — skipping');
        continue;
      }

      securityLogger.info(
        {
          action: 'voice_transcribe_inbound',
          channelType: msg.channelType,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.data.length,
        },
        'Transcribing inbound audio attachment',
      );

      const result = await transcribeAudio(
        attachment.data,
        {
          backend: config.voice.transcription.backend,
          apiKey: config.voice.transcription.groqApiKey,
          language: config.voice.transcription.language,
        },
        attachment.mimeType,
      );

      if (result.text.trim().length > 0) {
        transcriptions.push(result.text.trim());
        transcribedCount++;
        log.info(
          {
            textLength: result.text.length,
            language: result.language,
            durationMs: result.durationMs,
          },
          'Audio transcription successful',
        );
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.warn(
        { error: errorMsg, mimeType: attachment.mimeType },
        'Failed to transcribe audio attachment',
      );
    }
  }

  // Combine original text with transcriptions
  const parts: string[] = [];
  if (transcriptions.length > 0) {
    parts.push(`[Voice message]: ${transcriptions.join(' ')}`);
  }
  if (msg.text.trim().length > 0) {
    parts.push(msg.text);
  }

  const combinedText = parts.join('\n\n');

  return {
    text: combinedText || msg.text,
    hadAudio: true,
    transcribedCount,
  };
}

/**
 * Generate outbound voice: synthesize TTS audio for a response.
 * Only generates audio if:
 * - The original message was a voice message (hadAudio=true)
 * - Voice synthesis is enabled in config
 * - The current tier supports voice_synthesis
 * - A TTS backend is available
 *
 * @param responseText - The response text to synthesize.
 * @param hadAudio - Whether the original message contained audio.
 * @param config - Application configuration.
 * @param tier - Current install tier.
 * @returns The audio attachment or null.
 */
export async function generateOutboundVoice(
  responseText: string,
  hadAudio: boolean,
  config: Config,
  tier: InstallTier,
): Promise<VoiceOutboundResult> {
  // Only generate voice response if original was a voice message
  if (!hadAudio) {
    return { audioAttachment: null };
  }

  // Check config enablement
  if (!config.voice.enabled || !config.voice.synthesis.enabled) {
    return { audioAttachment: null };
  }

  // Check tier gating
  if (!isFeatureEnabled(tier, 'voice_synthesis')) {
    return { audioAttachment: null };
  }

  // Check TTS availability
  const available = await isTtsAvailable(config);
  if (!available) {
    log.debug('TTS backend not available — skipping voice response');
    return { audioAttachment: null };
  }

  try {
    // Truncate very long responses for TTS (keep first 2000 chars)
    const textForTts = responseText.length > 2000
      ? responseText.slice(0, 2000) + '...'
      : responseText;

    securityLogger.info(
      {
        action: 'voice_synthesize_outbound',
        textLength: textForTts.length,
        backend: config.voice.synthesis.backend,
      },
      'Synthesizing outbound voice response',
    );

    const result: TtsSynthesizeResult = await synthesizeSpeech(config, textForTts, tier);

    const mimeType = result.format === 'mp3' ? 'audio/mpeg' : 'audio/wav';

    log.info(
      {
        audioBytes: result.audio.length,
        durationSec: result.durationSec,
        backend: result.backend,
      },
      'Outbound voice synthesis complete',
    );

    return {
      audioAttachment: {
        data: result.audio,
        format: result.format,
        durationSec: result.durationSec,
        mimeType,
      },
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.warn({ error: errorMsg }, 'Failed to synthesize outbound voice — sending text only');
    return { audioAttachment: null };
  }
}
