/**
 * Tests for the voice middleware module.
 * Validates inbound audio transcription and outbound TTS synthesis
 * in the message processing pipeline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigSchema } from '../../../src/config/schema.js';
import type { Config } from '../../../src/config/schema.js';
import type { Attachment, ChannelMessage, InstallTier } from '../../../src/types/index.js';
import {
  isTranscribableAudio,
  processInboundVoice,
  generateOutboundVoice,
} from '../../../src/voice/voice-middleware.js';

// Mock dependencies
vi.mock('../../../src/voice/transcriber.js', () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock('../../../src/voice/tts-router.js', () => ({
  synthesizeSpeech: vi.fn(),
  isTtsAvailable: vi.fn(),
}));

vi.mock('../../../src/tiers/feature-gate.js', () => ({
  isFeatureEnabled: vi.fn(),
}));

// Silence loggers
vi.mock('../../../src/utils/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
  securityLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Build a Config with voice settings. */
function makeConfig(overrides?: Partial<{
  voiceEnabled: boolean;
  synthesisEnabled: boolean;
  backend: 'say' | 'kokoro' | 'elevenlabs';
}>): Config {
  return ConfigSchema.parse({
    voice: {
      enabled: overrides?.voiceEnabled ?? true,
      transcription: {
        backend: 'groq',
        groqApiKey: 'test-key',
        language: 'en',
      },
      synthesis: {
        enabled: overrides?.synthesisEnabled ?? true,
        backend: overrides?.backend ?? 'say',
      },
    },
  });
}

/** Build a test ChannelMessage. */
function makeMessage(overrides?: Partial<{
  text: string;
  attachments: Attachment[];
}>): ChannelMessage {
  return {
    id: 'msg-1',
    channelType: 'webchat',
    channelId: 'ch-1',
    userId: 'user-1',
    text: overrides?.text ?? 'Hello there',
    attachments: overrides?.attachments ?? [],
    timestamp: new Date(),
  };
}

/** Build an audio attachment. */
function makeAudioAttachment(overrides?: Partial<Attachment>): Attachment {
  return {
    type: 'audio',
    data: Buffer.alloc(1024),
    mimeType: 'audio/mpeg',
    filename: 'voice.mp3',
    size: 1024,
    ...overrides,
  };
}

// ── isTranscribableAudio ──────────────────────────────────────────

describe('isTranscribableAudio', () => {
  it('returns true for audio attachment with data and supported MIME', () => {
    const attachment = makeAudioAttachment();
    expect(isTranscribableAudio(attachment)).toBe(true);
  });

  it('returns false for non-audio type', () => {
    const attachment = makeAudioAttachment({ type: 'image' });
    expect(isTranscribableAudio(attachment)).toBe(false);
  });

  it('returns false for audio with no data and no URL', () => {
    const attachment = makeAudioAttachment({ data: undefined, url: undefined });
    expect(isTranscribableAudio(attachment)).toBe(false);
  });

  it('returns true for audio with URL but no data', () => {
    const attachment = makeAudioAttachment({ data: undefined, url: 'https://example.com/audio.mp3' });
    expect(isTranscribableAudio(attachment)).toBe(true);
  });

  it('returns false for unsupported MIME type', () => {
    const attachment = makeAudioAttachment({ mimeType: 'audio/x-unknown' });
    expect(isTranscribableAudio(attachment)).toBe(false);
  });

  it('returns false for audio exceeding 25MB', () => {
    const attachment = makeAudioAttachment({
      data: Buffer.alloc(26 * 1024 * 1024),
    });
    expect(isTranscribableAudio(attachment)).toBe(false);
  });

  it('returns true for supported MIME types', () => {
    const mimeTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
      'audio/ogg', 'audio/webm', 'audio/flac', 'audio/mp4',
      'audio/m4a', 'audio/aac',
    ];
    for (const mimeType of mimeTypes) {
      const attachment = makeAudioAttachment({ mimeType });
      expect(isTranscribableAudio(attachment)).toBe(true);
    }
  });
});

// ── processInboundVoice ───────────────────────────────────────────

describe('processInboundVoice', () => {
  it('returns original text when no audio attachments', async () => {
    const msg = makeMessage({ text: 'Plain text' });
    const config = makeConfig();

    const result = await processInboundVoice(msg, config, 'full');

    expect(result.text).toBe('Plain text');
    expect(result.hadAudio).toBe(false);
    expect(result.transcribedCount).toBe(0);
  });

  it('transcribes audio and prepends to text', async () => {
    const { transcribeAudio } = await import('../../../src/voice/transcriber.js');
    vi.mocked(transcribeAudio).mockResolvedValue({
      text: 'What is the weather today',
      language: 'en',
      durationMs: 3000,
      backend: 'groq',
    });

    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const msg = makeMessage({
      text: '',
      attachments: [makeAudioAttachment()],
    });
    const config = makeConfig();

    const result = await processInboundVoice(msg, config, 'full');

    expect(result.text).toBe('[Voice message]: What is the weather today');
    expect(result.hadAudio).toBe(true);
    expect(result.transcribedCount).toBe(1);
  });

  it('combines transcription with existing text', async () => {
    const { transcribeAudio } = await import('../../../src/voice/transcriber.js');
    vi.mocked(transcribeAudio).mockResolvedValue({
      text: 'Hey there',
      language: 'en',
      durationMs: 1500,
      backend: 'groq',
    });

    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const msg = makeMessage({
      text: 'Check this voice note',
      attachments: [makeAudioAttachment()],
    });
    const config = makeConfig();

    const result = await processInboundVoice(msg, config, 'full');

    expect(result.text).toContain('[Voice message]: Hey there');
    expect(result.text).toContain('Check this voice note');
    expect(result.transcribedCount).toBe(1);
  });

  it('skips transcription when tier does not support voice_synthesis', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(false);

    const msg = makeMessage({
      attachments: [makeAudioAttachment()],
    });
    const config = makeConfig();

    const result = await processInboundVoice(msg, config, 'lite');

    expect(result.text).toBe('Hello there');
    expect(result.hadAudio).toBe(true);
    expect(result.transcribedCount).toBe(0);
  });

  it('skips transcription when voice not enabled in config', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const msg = makeMessage({
      attachments: [makeAudioAttachment()],
    });
    const config = makeConfig({ voiceEnabled: false });

    const result = await processInboundVoice(msg, config, 'full');

    expect(result.hadAudio).toBe(true);
    expect(result.transcribedCount).toBe(0);
  });

  it('handles transcription failure gracefully', async () => {
    const { transcribeAudio } = await import('../../../src/voice/transcriber.js');
    vi.mocked(transcribeAudio).mockRejectedValue(new Error('API error'));

    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const msg = makeMessage({
      text: 'Original text',
      attachments: [makeAudioAttachment()],
    });
    const config = makeConfig();

    const result = await processInboundVoice(msg, config, 'full');

    // Should not crash — just return original text
    expect(result.text).toBe('Original text');
    expect(result.hadAudio).toBe(true);
    expect(result.transcribedCount).toBe(0);
  });

  it('handles multiple audio attachments', async () => {
    const { transcribeAudio } = await import('../../../src/voice/transcriber.js');
    vi.mocked(transcribeAudio)
      .mockResolvedValueOnce({ text: 'First message', language: 'en', durationMs: 1000, backend: 'groq' })
      .mockResolvedValueOnce({ text: 'Second message', language: 'en', durationMs: 2000, backend: 'groq' });

    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const msg = makeMessage({
      text: '',
      attachments: [makeAudioAttachment(), makeAudioAttachment({ mimeType: 'audio/wav' })],
    });
    const config = makeConfig();

    const result = await processInboundVoice(msg, config, 'full');

    expect(result.text).toContain('First message');
    expect(result.text).toContain('Second message');
    expect(result.transcribedCount).toBe(2);
  });

  it('skips audio attachment with no data buffer', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const msg = makeMessage({
      attachments: [makeAudioAttachment({ data: undefined, url: 'https://example.com/audio.mp3' })],
    });
    const config = makeConfig();

    const result = await processInboundVoice(msg, config, 'full');

    expect(result.hadAudio).toBe(true);
    expect(result.transcribedCount).toBe(0);
  });

  it('ignores non-audio attachments', async () => {
    const msg = makeMessage({
      attachments: [
        { type: 'image', mimeType: 'image/png', data: Buffer.alloc(100) },
        { type: 'file', mimeType: 'application/pdf', data: Buffer.alloc(100) },
      ],
    });
    const config = makeConfig();

    const result = await processInboundVoice(msg, config, 'full');

    expect(result.hadAudio).toBe(false);
    expect(result.transcribedCount).toBe(0);
  });

  it('ignores empty transcription results', async () => {
    const { transcribeAudio } = await import('../../../src/voice/transcriber.js');
    vi.mocked(transcribeAudio).mockResolvedValue({
      text: '   ', // whitespace only
      language: 'en',
      durationMs: 500,
      backend: 'groq',
    });

    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const msg = makeMessage({
      text: 'Some text',
      attachments: [makeAudioAttachment()],
    });
    const config = makeConfig();

    const result = await processInboundVoice(msg, config, 'full');

    expect(result.text).toBe('Some text');
    expect(result.transcribedCount).toBe(0);
  });
});

// ── generateOutboundVoice ─────────────────────────────────────────

describe('generateOutboundVoice', () => {
  it('returns null when original message had no audio', async () => {
    const config = makeConfig();
    const result = await generateOutboundVoice('Hello', false, config, 'full');
    expect(result.audioAttachment).toBeNull();
  });

  it('returns null when voice not enabled in config', async () => {
    const config = makeConfig({ voiceEnabled: false });
    const result = await generateOutboundVoice('Hello', true, config, 'full');
    expect(result.audioAttachment).toBeNull();
  });

  it('returns null when synthesis not enabled', async () => {
    const config = makeConfig({ synthesisEnabled: false });
    const result = await generateOutboundVoice('Hello', true, config, 'full');
    expect(result.audioAttachment).toBeNull();
  });

  it('returns null when tier does not support voice_synthesis', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(false);

    const config = makeConfig();
    const result = await generateOutboundVoice('Hello', true, config, 'standard');
    expect(result.audioAttachment).toBeNull();
  });

  it('returns null when TTS backend is not available', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const { isTtsAvailable } = await import('../../../src/voice/tts-router.js');
    vi.mocked(isTtsAvailable).mockResolvedValue(false);

    const config = makeConfig();
    const result = await generateOutboundVoice('Hello', true, config, 'full');
    expect(result.audioAttachment).toBeNull();
  });

  it('generates audio when all conditions met', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const { isTtsAvailable, synthesizeSpeech } = await import('../../../src/voice/tts-router.js');
    vi.mocked(isTtsAvailable).mockResolvedValue(true);
    vi.mocked(synthesizeSpeech).mockResolvedValue({
      audio: Buffer.alloc(4096),
      format: 'wav',
      durationSec: 2.5,
      backend: 'say',
    });

    const config = makeConfig();
    const result = await generateOutboundVoice('Hello world', true, config, 'full');

    expect(result.audioAttachment).not.toBeNull();
    expect(result.audioAttachment!.data.length).toBe(4096);
    expect(result.audioAttachment!.format).toBe('wav');
    expect(result.audioAttachment!.mimeType).toBe('audio/wav');
    expect(result.audioAttachment!.durationSec).toBe(2.5);
  });

  it('sets correct MIME type for mp3 format', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const { isTtsAvailable, synthesizeSpeech } = await import('../../../src/voice/tts-router.js');
    vi.mocked(isTtsAvailable).mockResolvedValue(true);
    vi.mocked(synthesizeSpeech).mockResolvedValue({
      audio: Buffer.alloc(2048),
      format: 'mp3',
      durationSec: 1.0,
      backend: 'kokoro',
    });

    const config = makeConfig();
    const result = await generateOutboundVoice('Test', true, config, 'full');

    expect(result.audioAttachment!.mimeType).toBe('audio/mpeg');
  });

  it('truncates long text before TTS synthesis', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const { isTtsAvailable, synthesizeSpeech } = await import('../../../src/voice/tts-router.js');
    vi.mocked(isTtsAvailable).mockResolvedValue(true);
    vi.mocked(synthesizeSpeech).mockResolvedValue({
      audio: Buffer.alloc(1024),
      format: 'wav',
      durationSec: 5.0,
      backend: 'say',
    });

    const config = makeConfig();
    const longText = 'A'.repeat(3000);
    await generateOutboundVoice(longText, true, config, 'full');

    // The synthesizeSpeech should be called with truncated text
    expect(vi.mocked(synthesizeSpeech)).toHaveBeenCalledWith(
      config,
      expect.stringContaining('...'),
      'full',
    );

    const calledText = vi.mocked(synthesizeSpeech).mock.calls[0][1];
    expect(calledText.length).toBeLessThanOrEqual(2003); // 2000 + '...'
  });

  it('returns null on TTS synthesis failure', async () => {
    const { isFeatureEnabled } = await import('../../../src/tiers/feature-gate.js');
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    const { isTtsAvailable, synthesizeSpeech } = await import('../../../src/voice/tts-router.js');
    vi.mocked(isTtsAvailable).mockResolvedValue(true);
    vi.mocked(synthesizeSpeech).mockRejectedValue(new Error('Backend crashed'));

    const config = makeConfig();
    const result = await generateOutboundVoice('Hello', true, config, 'full');

    // Should not crash — returns null
    expect(result.audioAttachment).toBeNull();
  });
});
