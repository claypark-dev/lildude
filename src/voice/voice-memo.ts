/**
 * Voice memo module — sends assistant responses as audio attachments
 * on channels that support it (Discord, iMessage, Telegram, etc.).
 *
 * Integrates with the TTS router to synthesize text and creates
 * AudioAttachment objects for the channel adapter's send() method.
 *
 * Voice memos are sent alongside text responses when:
 * 1. Voice synthesis is enabled in config
 * 2. autoSpeak is true OR the original message was voice-initiated
 * 3. The channel supports audio attachments
 */

import type { AudioAttachment } from '../types/index.js';
import type { Config } from '../config/schema.js';
import { getTtsBackend } from './tts-router.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('voice-memo');

/** Channels that support sending audio attachments. */
const AUDIO_CAPABLE_CHANNELS = new Set([
  'discord',
  'imessage',
  'telegram',
  'slack',
  'matrix',
  'webchat',
  'line',
]);

/**
 * Check if a channel type supports sending audio attachments.
 */
export function channelSupportsAudio(channelType: string): boolean {
  return AUDIO_CAPABLE_CHANNELS.has(channelType.toLowerCase());
}

/**
 * Synthesize a text response into a voice memo AudioAttachment.
 *
 * @param text - The text to synthesize (assistant response).
 * @param voiceConfig - Optional voice configuration overrides.
 * @returns An AudioAttachment ready to send, or null if synthesis fails.
 */
export async function createVoiceMemo(
  text: string,
  config: Config,
  voiceConfig?: {
    voiceId?: string;
    rate?: number;
  },
): Promise<AudioAttachment | null> {
  // Don't synthesize very long text (keep voice memos concise)
  const MAX_TTS_LENGTH = 1000;
  const truncatedText = text.length > MAX_TTS_LENGTH
    ? text.slice(0, MAX_TTS_LENGTH) + '...'
    : text;

  // Strip markdown formatting for cleaner speech
  const cleanText = truncatedText
    .replace(/#{1,6}\s+/g, '')      // headers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1') // bold/italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/[-*]\s+/g, '')         // list markers
    .replace(/\n{2,}/g, '. ')       // paragraph breaks
    .replace(/\n/g, ' ')            // newlines
    .trim();

  if (cleanText.length < 5) {
    return null;
  }

  try {
    const backend = await getTtsBackend(config);
    const result = await backend.synthesize({
      text: cleanText,
      voice: voiceConfig?.voiceId,
      rate: voiceConfig?.rate ?? 1.0,
      format: 'wav',
    });

    logger.info(
      { format: result.format, durationSec: result.durationSec, backend: result.backend },
      'Voice memo synthesized',
    );

    return {
      data: result.audio,
      format: result.format,
      durationSec: result.durationSec,
      mimeType: result.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.debug({ error: msg }, 'Voice memo synthesis failed (non-critical)');
    return null;
  }
}

/**
 * Determine whether a voice memo should be sent for this response.
 *
 * @param autoSpeak - Whether autoSpeak is enabled in config.
 * @param wasVoiceInitiated - Whether the original message was transcribed audio.
 * @param channelType - The channel type for this response.
 * @param responseText - The response text (skip if too short or is an error).
 * @returns Whether a voice memo should be created.
 */
export function shouldSendVoiceMemo(
  autoSpeak: boolean,
  wasVoiceInitiated: boolean,
  channelType: string,
  responseText: string,
): boolean {
  // Must be on an audio-capable channel
  if (!channelSupportsAudio(channelType)) {
    return false;
  }

  // Must have meaningful text
  if (responseText.length < 20) {
    return false;
  }

  // Skip error messages
  if (responseText.startsWith('Error:') || responseText.startsWith('Sorry,')) {
    return false;
  }

  // Send if autoSpeak is on OR if the original message was voice
  return autoSpeak || wasVoiceInitiated;
}
