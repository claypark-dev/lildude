import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDiscordAdapter, type DiscordAdapter } from '../../../src/channels/discord.js';
import type { ChannelMessage, SendOptions } from '../../../src/types/index.js';
import { EventEmitter } from 'events';

// ─── Mock discord.js Client ─────────────────────────────────────────────────

/**
 * Minimal mock of a discord.js Message attachment.
 * Matches the shape consumed by the adapter's normalizeAttachment().
 */
interface MockAttachment {
  contentType: string | null;
  url: string;
  name: string;
  size: number;
}

/**
 * Minimal mock of a discord.js Message.
 * Provides the fields the adapter actually reads.
 */
interface MockDiscordMessage {
  author: { id: string; bot: boolean };
  content: string;
  channelId: string;
  channel: { isDMBased: () => boolean };
  attachments: Map<string, MockAttachment>;
  reference: { messageId: string } | null;
  createdAt: Date;
}

/** Capture what was passed to channel.send() */
interface SentPayload {
  content: string;
  reply?: { messageReference: string };
  components?: unknown[];
}

/**
 * Mock discord.js Client using EventEmitter for event simulation.
 * Implements the subset of Client used by the adapter.
 */
class MockDiscordClient extends EventEmitter {
  private _ready = false;
  private _channels = new Map<string, { send: ReturnType<typeof vi.fn> }>();

  /** Simulate login. If token is 'INVALID', reject. */
  async login(token: string): Promise<string> {
    if (token === 'INVALID') {
      throw new Error('An invalid token was provided.');
    }
    this._ready = true;
    return token;
  }

  /** Simulate client readiness check. */
  isReady(): boolean {
    return this._ready;
  }

  /** Simulate client.channels.fetch(). */
  channels = {
    fetch: async (channelId: string) => {
      const channel = this._channels.get(channelId);
      if (!channel) return null;
      return channel;
    },
  };

  /** Simulate client.destroy(). */
  destroy(): void {
    this._ready = false;
    this.removeAllListeners();
  }

  // ── Test helpers ──

  /**
   * Register a mock channel that the adapter can send to.
   *
   * @param channelId - The channel ID.
   * @returns The mock send function for assertion.
   */
  addMockChannel(channelId: string): ReturnType<typeof vi.fn> {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    this._channels.set(channelId, { send: sendFn });
    return sendFn;
  }

  /**
   * Simulate an inbound message event.
   *
   * @param msg - The mock Discord message to emit.
   */
  simulateMessage(msg: MockDiscordMessage): void {
    this.emit('messageCreate', msg);
  }
}

// ─── Helper factories ────────────────────────────────────────────────────────

function createGuildMessage(overrides?: Partial<MockDiscordMessage>): MockDiscordMessage {
  return {
    author: { id: 'user-123', bot: false },
    content: 'Hello from guild',
    channelId: 'channel-456',
    channel: { isDMBased: () => false },
    attachments: new Map(),
    reference: null,
    createdAt: new Date('2026-02-18T12:00:00.000Z'),
    ...overrides,
  };
}

function createDMMessage(overrides?: Partial<MockDiscordMessage>): MockDiscordMessage {
  return {
    author: { id: 'user-789', bot: false },
    content: 'Hello from DM',
    channelId: 'dm-channel-001',
    channel: { isDMBased: () => true },
    attachments: new Map(),
    reference: null,
    createdAt: new Date('2026-02-18T13:00:00.000Z'),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DiscordAdapter', () => {
  let adapter: DiscordAdapter;
  let mockClient: MockDiscordClient;

  beforeEach(() => {
    adapter = createDiscordAdapter();
    mockClient = new MockDiscordClient();
    // Inject mock so connect() doesn't create a real Client
    adapter._injectClient(mockClient as unknown as import('discord.js').Client);
  });

  // ── Connection lifecycle ───────────────────────────────────────────────

  describe('connect / disconnect / isConnected', () => {
    it('returns false before connect() is called', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns true after successful connect()', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });
      expect(adapter.isConnected()).toBe(true);
    });

    it('returns false after disconnect()', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('throws when token is missing', async () => {
      await expect(
        adapter.connect({ enabled: true }),
      ).rejects.toThrow('Discord bot token is required');
    });

    it('throws a helpful error when token is invalid', async () => {
      await expect(
        adapter.connect({ enabled: true, token: 'INVALID' }),
      ).rejects.toThrow(
        /Failed to connect to Discord.*verify your bot token/,
      );
    });
  });

  // ── Adapter identity ──────────────────────────────────────────────────

  describe('identity', () => {
    it('has name "Discord"', () => {
      expect(adapter.name).toBe('Discord');
    });

    it('has type "discord"', () => {
      expect(adapter.type).toBe('discord');
    });
  });

  // ── Message normalization ─────────────────────────────────────────────

  describe('message normalization', () => {
    it('normalizes a guild message into a ChannelMessage', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      let received: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        received = msg;
      });

      mockClient.simulateMessage(createGuildMessage());

      // Wait for async handler
      await vi.waitFor(() => expect(received).toBeDefined());

      expect(received!.channelType).toBe('discord');
      expect(received!.channelId).toBe('channel-456');
      expect(received!.userId).toBe('user-123');
      expect(received!.text).toBe('Hello from guild');
      expect(received!.attachments).toEqual([]);
      expect(received!.timestamp).toEqual(
        new Date('2026-02-18T12:00:00.000Z'),
      );
      expect(received!.id).toBeTruthy();
    });

    it('normalizes a DM message — channelId is the author ID', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      let received: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        received = msg;
      });

      mockClient.simulateMessage(createDMMessage());

      await vi.waitFor(() => expect(received).toBeDefined());

      // For DMs the channelId should be the user's author ID
      expect(received!.channelId).toBe('user-789');
      expect(received!.userId).toBe('user-789');
      expect(received!.text).toBe('Hello from DM');
    });

    it('maps Discord attachments to our Attachment type', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      let received: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        received = msg;
      });

      const attachments = new Map<string, MockAttachment>([
        [
          'att-1',
          {
            contentType: 'image/png',
            url: 'https://cdn.discord.com/img.png',
            name: 'screenshot.png',
            size: 12345,
          },
        ],
        [
          'att-2',
          {
            contentType: 'application/pdf',
            url: 'https://cdn.discord.com/doc.pdf',
            name: 'document.pdf',
            size: 67890,
          },
        ],
      ]);

      mockClient.simulateMessage(
        createGuildMessage({ attachments }),
      );

      await vi.waitFor(() => expect(received).toBeDefined());

      expect(received!.attachments).toHaveLength(2);
      expect(received!.attachments[0]).toEqual({
        type: 'image',
        url: 'https://cdn.discord.com/img.png',
        mimeType: 'image/png',
        filename: 'screenshot.png',
        size: 12345,
      });
      expect(received!.attachments[1]).toEqual({
        type: 'file',
        url: 'https://cdn.discord.com/doc.pdf',
        mimeType: 'application/pdf',
        filename: 'document.pdf',
        size: 67890,
      });
    });

    it('preserves replyToMessageId from Discord message reference', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      let received: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        received = msg;
      });

      mockClient.simulateMessage(
        createGuildMessage({ reference: { messageId: 'orig-msg-42' } }),
      );

      await vi.waitFor(() => expect(received).toBeDefined());

      expect(received!.replyToMessageId).toBe('orig-msg-42');
    });

    it('generates unique IDs for each normalized message', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      const received: ChannelMessage[] = [];
      adapter.onMessage(async (msg) => {
        received.push(msg);
      });

      mockClient.simulateMessage(createGuildMessage());
      mockClient.simulateMessage(createGuildMessage());

      await vi.waitFor(() => expect(received).toHaveLength(2));

      expect(received[0].id).not.toBe(received[1].id);
    });

    it('maps audio and video content types correctly', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      let received: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        received = msg;
      });

      const attachments = new Map<string, MockAttachment>([
        [
          'audio-1',
          {
            contentType: 'audio/mpeg',
            url: 'https://cdn.discord.com/audio.mp3',
            name: 'voice.mp3',
            size: 1000,
          },
        ],
        [
          'video-1',
          {
            contentType: 'video/mp4',
            url: 'https://cdn.discord.com/clip.mp4',
            name: 'clip.mp4',
            size: 2000,
          },
        ],
        [
          'null-type',
          {
            contentType: null,
            url: 'https://cdn.discord.com/unknown',
            name: 'mystery',
            size: 500,
          },
        ],
      ]);

      mockClient.simulateMessage(createGuildMessage({ attachments }));

      await vi.waitFor(() => expect(received).toBeDefined());

      expect(received!.attachments[0].type).toBe('audio');
      expect(received!.attachments[1].type).toBe('video');
      expect(received!.attachments[2].type).toBe('file');
      expect(received!.attachments[2].mimeType).toBe(
        'application/octet-stream',
      );
    });
  });

  // ── Bot message filtering ─────────────────────────────────────────────

  describe('bot message filtering', () => {
    it('ignores messages from bots', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      let handlerCalled = false;
      adapter.onMessage(async () => {
        handlerCalled = true;
      });

      mockClient.simulateMessage(
        createGuildMessage({
          author: { id: 'bot-1', bot: true },
        }),
      );

      // Give the event loop a chance to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handlerCalled).toBe(false);
    });
  });

  // ── allowFrom filtering ───────────────────────────────────────────────

  describe('allowFrom filtering', () => {
    it('allows messages from users in allowFrom list', async () => {
      await adapter.connect({
        enabled: true,
        token: 'valid-token',
        allowFrom: ['user-123'],
      });

      let received: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        received = msg;
      });

      mockClient.simulateMessage(
        createGuildMessage({ author: { id: 'user-123', bot: false } }),
      );

      await vi.waitFor(() => expect(received).toBeDefined());

      expect(received!.userId).toBe('user-123');
    });

    it('rejects messages from users NOT in allowFrom list', async () => {
      await adapter.connect({
        enabled: true,
        token: 'valid-token',
        allowFrom: ['user-123'],
      });

      let handlerCalled = false;
      adapter.onMessage(async () => {
        handlerCalled = true;
      });

      mockClient.simulateMessage(
        createGuildMessage({ author: { id: 'user-blocked', bot: false } }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handlerCalled).toBe(false);
    });

    it('allows all messages when allowFrom is empty', async () => {
      await adapter.connect({
        enabled: true,
        token: 'valid-token',
        allowFrom: [],
      });

      let received: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        received = msg;
      });

      mockClient.simulateMessage(
        createGuildMessage({ author: { id: 'anyone', bot: false } }),
      );

      await vi.waitFor(() => expect(received).toBeDefined());

      expect(received!.userId).toBe('anyone');
    });

    it('allows all messages when allowFrom is not specified', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      let received: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        received = msg;
      });

      mockClient.simulateMessage(
        createGuildMessage({ author: { id: 'anyone', bot: false } }),
      );

      await vi.waitFor(() => expect(received).toBeDefined());

      expect(received!.userId).toBe('anyone');
    });
  });

  // ── Handler edge cases ────────────────────────────────────────────────

  describe('handler edge cases', () => {
    it('does not throw when no message handler is registered', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      // Do NOT register a handler
      expect(() =>
        mockClient.simulateMessage(createGuildMessage()),
      ).not.toThrow();
    });

    it('does not propagate handler errors', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      adapter.onMessage(async () => {
        throw new Error('Handler boom');
      });

      // Should not throw even though the handler throws
      expect(() =>
        mockClient.simulateMessage(createGuildMessage()),
      ).not.toThrow();

      // Let the promise rejection be caught internally
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  // ── send() ────────────────────────────────────────────────────────────

  describe('send', () => {
    it('sends a message to the target channel', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      const sendFn = mockClient.addMockChannel('channel-456');

      await adapter.send('channel-456', 'Hello world');

      expect(sendFn).toHaveBeenCalledTimes(1);
      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Hello world' }),
      );
    });

    it('does not throw when sending to a non-existent channel', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      await expect(
        adapter.send('no-such-channel', 'Hello'),
      ).resolves.toBeUndefined();
    });

    it('does not throw when client is not connected', async () => {
      // Do not connect
      await expect(
        adapter.send('channel-456', 'Hello'),
      ).resolves.toBeUndefined();
    });

    it('includes reply reference when replyToMessageId is set', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      const sendFn = mockClient.addMockChannel('channel-456');

      await adapter.send('channel-456', 'Reply text', {
        replyToMessageId: 'orig-msg-99',
      });

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Reply text',
          reply: { messageReference: 'orig-msg-99' },
        }),
      );
    });

    it('splits long messages exceeding 2000 characters', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      const sendFn = mockClient.addMockChannel('channel-456');

      // Create a message just over 2000 chars (use newline-separated lines)
      const line = 'A'.repeat(199) + '\n'; // 200 chars per line
      const longMessage = line.repeat(12); // 2400 chars total

      await adapter.send('channel-456', longMessage);

      // Should be split into multiple calls
      expect(sendFn.mock.calls.length).toBeGreaterThan(1);

      // All chunks should be <= 2000 chars
      for (const call of sendFn.mock.calls) {
        const payload = call[0] as SentPayload;
        expect(payload.content.length).toBeLessThanOrEqual(2000);
      }

      // Reconstructed content should be complete
      const allContent = sendFn.mock.calls
        .map((call: [SentPayload]) => call[0].content)
        .join('\n');
      // Should contain all the 'A' characters from the original
      const originalACount = longMessage.split('A').length - 1;
      const reassembledACount = allContent.split('A').length - 1;
      expect(reassembledACount).toBe(originalACount);
    });

    it('hard-splits when no newline or space is found', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      const sendFn = mockClient.addMockChannel('channel-456');

      // A single continuous string with no newlines or spaces
      const longMessage = 'X'.repeat(4500);

      await adapter.send('channel-456', longMessage);

      expect(sendFn.mock.calls.length).toBeGreaterThan(1);

      for (const call of sendFn.mock.calls) {
        const payload = call[0] as SentPayload;
        expect(payload.content.length).toBeLessThanOrEqual(2000);
      }
    });

    it('includes buttons when provided in SendOptions', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      const sendFn = mockClient.addMockChannel('channel-456');

      const options: SendOptions = {
        buttons: [
          { label: 'Approve', id: 'btn-approve' },
          { label: 'Deny', id: 'btn-deny' },
        ],
      };

      await adapter.send('channel-456', 'Approve this action?', options);

      expect(sendFn).toHaveBeenCalledTimes(1);
      const payload = sendFn.mock.calls[0][0] as SentPayload;
      expect(payload.components).toBeDefined();
      expect(payload.components).toHaveLength(1);
    });

    it('attaches buttons only to the last chunk when splitting', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      const sendFn = mockClient.addMockChannel('channel-456');

      const longMessage = ('B'.repeat(199) + '\n').repeat(12); // > 2000 chars
      const options: SendOptions = {
        buttons: [{ label: 'OK', id: 'btn-ok' }],
      };

      await adapter.send('channel-456', longMessage, options);

      const calls = sendFn.mock.calls;
      expect(calls.length).toBeGreaterThan(1);

      // First chunk(s) should NOT have components
      for (let i = 0; i < calls.length - 1; i++) {
        const payload = calls[i][0] as SentPayload;
        expect(payload.components).toBeUndefined();
      }

      // Last chunk SHOULD have components
      const lastPayload = calls[calls.length - 1][0] as SentPayload;
      expect(lastPayload.components).toBeDefined();
      expect(lastPayload.components).toHaveLength(1);
    });

    it('does not include components when buttons array is empty', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      const sendFn = mockClient.addMockChannel('channel-456');

      await adapter.send('channel-456', 'No buttons', {
        buttons: [],
      });

      const payload = sendFn.mock.calls[0][0] as SentPayload;
      expect(payload.components).toBeUndefined();
    });
  });

  // ── disconnect cleanup ────────────────────────────────────────────────

  describe('disconnect', () => {
    it('clears the message handler on disconnect', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });

      const handler = vi.fn();
      adapter.onMessage(handler);

      await adapter.disconnect();

      // After disconnect, isConnected should be false
      expect(adapter.isConnected()).toBe(false);
    });

    it('can be called multiple times safely', async () => {
      await adapter.connect({ enabled: true, token: 'valid-token' });
      await adapter.disconnect();

      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });
});
