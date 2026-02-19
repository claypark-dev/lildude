import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChannelMessage, ChannelAdapter } from '../../../src/types/index.js';
import type {
  WhatsAppConnection,
  WhatsAppInboundMessage,
} from '../../../src/channels/whatsapp.js';
import { createWhatsAppAdapter, splitMessage } from '../../../src/channels/whatsapp.js';

/** Captured message handler from connection.onMessage */
let capturedMessageHandler:
  | ((message: WhatsAppInboundMessage) => Promise<void>)
  | undefined;

/** Mock sendMessage */
const mockSendMessage = vi.fn<(chatId: string, text: string) => Promise<void>>()
  .mockResolvedValue(undefined);

/** Mock initialize */
const mockInitialize = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

/** Mock destroy */
const mockDestroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

/**
 * Create a mock WhatsApp connection for testing.
 */
function createMockConnection(): WhatsAppConnection {
  return {
    initialize: mockInitialize,
    destroy: mockDestroy,
    onMessage(handler: (message: WhatsAppInboundMessage) => Promise<void>): void {
      capturedMessageHandler = handler;
    },
    sendMessage: mockSendMessage,
    isReady(): boolean {
      return true;
    },
  };
}

/**
 * Helper: create a minimal WhatsApp inbound message.
 */
function makeWhatsAppMessage(overrides?: {
  from?: string;
  body?: string;
  chatId?: string;
  timestamp?: number;
  isGroup?: boolean;
}): WhatsAppInboundMessage {
  return {
    id: 'msg-001',
    from: overrides?.from ?? '+1234567890',
    body: overrides?.body ?? 'Hello from WhatsApp',
    chatId: overrides?.chatId ?? '+1234567890@c.us',
    timestamp: overrides?.timestamp ?? 1708272000,
    isGroup: overrides?.isGroup ?? false,
  };
}

describe('WhatsAppAdapter', () => {
  let adapter: ChannelAdapter;

  beforeEach(() => {
    capturedMessageHandler = undefined;
    vi.clearAllMocks();
    adapter = createWhatsAppAdapter(createMockConnection());
  });

  afterEach(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  // --- Identity ---

  describe('identity', () => {
    it('has name "WhatsApp"', () => {
      expect(adapter.name).toBe('WhatsApp');
    });

    it('has type "whatsapp"', () => {
      expect(adapter.type).toBe('whatsapp');
    });
  });

  // --- Connection lifecycle ---

  describe('connect / disconnect', () => {
    it('returns false before connect is called', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns true after connect is called', async () => {
      await adapter.connect({ enabled: true });
      expect(adapter.isConnected()).toBe(true);
    });

    it('calls connection.initialize on connect', async () => {
      await adapter.connect({ enabled: true });
      expect(mockInitialize).toHaveBeenCalledOnce();
    });

    it('returns false after disconnect', async () => {
      await adapter.connect({ enabled: true });
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('calls connection.destroy on disconnect', async () => {
      await adapter.connect({ enabled: true });
      await adapter.disconnect();
      expect(mockDestroy).toHaveBeenCalledOnce();
    });

    it('disconnect is safe when not connected', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });

    it('throws when no connection is injected', async () => {
      const adapterNoConn = createWhatsAppAdapter();
      await expect(adapterNoConn.connect({ enabled: true })).rejects.toThrow(
        'WhatsApp adapter requires an injected WhatsAppConnection',
      );
    });
  });

  // --- Message normalization ---

  describe('message normalization', () => {
    it('normalizes a WhatsApp message into a ChannelMessage', async () => {
      await adapter.connect({ enabled: true });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => { receivedMessage = msg; });

      const message = makeWhatsAppMessage({
        from: '+1555000111',
        body: 'Hello world',
        chatId: '+1555000111@c.us',
        timestamp: 1708272000,
      });

      expect(capturedMessageHandler).toBeDefined();
      await capturedMessageHandler!(message);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.channelType).toBe('whatsapp');
      expect(receivedMessage!.channelId).toBe('+1555000111@c.us');
      expect(receivedMessage!.userId).toBe('+1555000111');
      expect(receivedMessage!.text).toBe('Hello world');
      expect(receivedMessage!.attachments).toEqual([]);
      expect(receivedMessage!.timestamp).toEqual(new Date(1708272000 * 1000));
      expect(receivedMessage!.raw).toBe(message);
    });

    it('generates unique ids for each message', async () => {
      await adapter.connect({ enabled: true });

      const messages: ChannelMessage[] = [];
      adapter.onMessage(async (msg) => { messages.push(msg); });

      const message = makeWhatsAppMessage();
      await capturedMessageHandler!(message);
      await capturedMessageHandler!(message);

      expect(messages).toHaveLength(2);
      expect(messages[0].id).not.toBe(messages[1].id);
    });

    it('does not throw when no message handler is registered', async () => {
      await adapter.connect({ enabled: true });
      await expect(
        capturedMessageHandler!(makeWhatsAppMessage()),
      ).resolves.toBeUndefined();
    });

    it('does not propagate message handler errors', async () => {
      await adapter.connect({ enabled: true });
      adapter.onMessage(async () => { throw new Error('Handler boom'); });
      await expect(
        capturedMessageHandler!(makeWhatsAppMessage()),
      ).resolves.toBeUndefined();
    });
  });

  // --- allowFrom filtering ---

  describe('allowFrom filtering', () => {
    it('allows all users when allowFrom is empty', async () => {
      await adapter.connect({ enabled: true, allowFrom: [] });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => { receivedMessage = msg; });

      await capturedMessageHandler!(makeWhatsAppMessage({ from: '+9999999999' }));
      expect(receivedMessage).toBeDefined();
    });

    it('allows messages from a permitted phone number', async () => {
      await adapter.connect({
        enabled: true,
        allowFrom: ['+1111111111', '+2222222222'],
      });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => { receivedMessage = msg; });

      await capturedMessageHandler!(makeWhatsAppMessage({ from: '+2222222222' }));
      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.userId).toBe('+2222222222');
    });

    it('drops messages from a non-permitted phone number', async () => {
      await adapter.connect({
        enabled: true,
        allowFrom: ['+1111111111', '+2222222222'],
      });

      let handlerCalled = false;
      adapter.onMessage(async () => { handlerCalled = true; });

      await capturedMessageHandler!(makeWhatsAppMessage({ from: '+9999999999' }));
      expect(handlerCalled).toBe(false);
    });
  });

  // --- send: message splitting ---

  describe('message splitting', () => {
    it('sends short messages as a single call', async () => {
      await adapter.connect({ enabled: true });

      await adapter.send('+1234567890@c.us', 'Short message');

      expect(mockSendMessage).toHaveBeenCalledOnce();
      expect(mockSendMessage).toHaveBeenCalledWith('+1234567890@c.us', 'Short message');
    });

    it('splits messages longer than 4096 characters', async () => {
      await adapter.connect({ enabled: true });

      const longText = 'A'.repeat(5000);
      await adapter.send('+1234567890@c.us', longText);

      expect(mockSendMessage).toHaveBeenCalledTimes(2);

      const firstText = mockSendMessage.mock.calls[0][1] as string;
      const secondText = mockSendMessage.mock.calls[1][1] as string;
      expect(firstText.length + secondText.length).toBe(5000);
      expect(firstText.length).toBeLessThanOrEqual(4096);
    });
  });

  // --- send: error handling ---

  describe('send error handling', () => {
    it('does not throw when connection is not initialized', async () => {
      const adapterNoConn = createWhatsAppAdapter();
      await expect(adapterNoConn.send('+123', 'No conn')).resolves.toBeUndefined();
    });

    it('does not throw when sendMessage fails', async () => {
      await adapter.connect({ enabled: true });
      mockSendMessage.mockRejectedValueOnce(new Error('Send error'));
      await expect(adapter.send('+123', 'Fail gracefully')).resolves.toBeUndefined();
    });
  });

  // --- splitMessage utility ---

  describe('splitMessage utility', () => {
    it('returns single chunk for text within limit', () => {
      expect(splitMessage('Short', 10)).toEqual(['Short']);
    });

    it('splits at exact limit when no newline present', () => {
      expect(splitMessage('ABCDEFGHIJ', 5)).toEqual(['ABCDE', 'FGHIJ']);
    });

    it('handles empty string', () => {
      expect(splitMessage('')).toEqual(['']);
    });
  });
});
