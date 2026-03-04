/**
 * Tests for WebChat adapter audio attachment handling.
 * Validates that audio data is base64-encoded and included
 * in the WebSocket message payload when sent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebChatAdapter } from '../../../src/channels/webchat.js';
import type { WSMessage, AudioAttachment } from '../../../src/types/index.js';

// Silence loggers
vi.mock('../../../src/utils/logger.js', () => ({
  channelLogger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('WebChat adapter audio sending', () => {
  let adapter: ReturnType<typeof createWebChatAdapter>;
  let sentMessages: WSMessage[];

  beforeEach(async () => {
    adapter = createWebChatAdapter();
    await adapter.connect({ enabled: true });
    sentMessages = [];

    adapter.registerClient('client-1', (msg: WSMessage) => {
      sentMessages.push(msg);
    });
  });

  it('sends text-only message when no audio attachment', async () => {
    await adapter.send('client-1', 'Hello world');

    expect(sentMessages).toHaveLength(1);
    const payload = sentMessages[0].payload as Record<string, unknown>;
    expect(payload.text).toBe('Hello world');
    expect(payload.audio).toBeUndefined();
  });

  it('includes base64-encoded audio in payload when audioAttachment provided', async () => {
    const audioData = Buffer.from('fake-audio-data');
    const audioAttachment: AudioAttachment = {
      data: audioData,
      format: 'wav',
      mimeType: 'audio/wav',
      durationSec: 2.5,
    };

    await adapter.send('client-1', 'Here is the response', { audioAttachment });

    expect(sentMessages).toHaveLength(1);
    const payload = sentMessages[0].payload as Record<string, unknown>;
    expect(payload.text).toBe('Here is the response');

    const audio = payload.audio as Record<string, unknown>;
    expect(audio).toBeDefined();
    expect(audio.data).toBe(audioData.toString('base64'));
    expect(audio.format).toBe('wav');
    expect(audio.mimeType).toBe('audio/wav');
    expect(audio.durationSec).toBe(2.5);
  });

  it('sends mp3 format audio correctly', async () => {
    const audioAttachment: AudioAttachment = {
      data: Buffer.from('mp3-data'),
      format: 'mp3',
      mimeType: 'audio/mpeg',
      durationSec: 1.0,
    };

    await adapter.send('client-1', 'Response', { audioAttachment });

    const payload = sentMessages[0].payload as Record<string, unknown>;
    const audio = payload.audio as Record<string, unknown>;
    expect(audio.format).toBe('mp3');
    expect(audio.mimeType).toBe('audio/mpeg');
  });

  it('includes audio along with buttons', async () => {
    const audioAttachment: AudioAttachment = {
      data: Buffer.from('audio'),
      format: 'wav',
      mimeType: 'audio/wav',
    };

    await adapter.send('client-1', 'Choose', {
      audioAttachment,
      buttons: [{ label: 'Yes', id: 'yes' }],
    });

    const payload = sentMessages[0].payload as Record<string, unknown>;
    expect(payload.audio).toBeDefined();
    expect(payload.buttons).toBeDefined();
  });

  it('does not include audio field when audioAttachment is undefined', async () => {
    await adapter.send('client-1', 'Plain', {
      audioAttachment: undefined,
    });

    const payload = sentMessages[0].payload as Record<string, unknown>;
    expect(payload.audio).toBeUndefined();
  });
});
