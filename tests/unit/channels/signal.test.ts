import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChannelMessage, ChannelAdapter } from '../../../src/types/index.js';
import type {
  SignalConnection,
  SignalInboundMessage,
} from '../../../src/channels/signal.js';
import { createSignalAdapter, splitMessage } from '../../../src/channels/signal.js';

/** Captured message handler from connection.onMessage */
let capturedMessageHandler:
  | ((message: SignalInboundMessage) => Promise<void>)
  | undefined;

/** Mock send */
const mockSend = vi.fn<(recipient: string, message: string) => Promise<void>>()
  .mockResolvedValue(undefined);

/** Mock start */
const mockStart = vi.fn<(phoneNumber: string) => Promise<void>>()
  .mockResolvedValue(undefined);

/** Mock stop */
const mockStop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

/**
 * Create a mock Signal connection for testing.
 */
function createMockConnection(): SignalConnection {
  return {
    start: mockStart,
    stop: mockStop,
    onMessage(handler: (message: SignalInboundMessage) => Promise<void>): void {
      capturedMessageHandler = handler;
    },
    send: mockSend,
    isRunning(): boolean {
      return true;
    },
  };
}

/**
 * Helper: create a minimal Signal inbound message.
 */
function makeSignalMessage(overrides?: {
  source?: string;
  body?: string;
  timestamp?: number;
  groupId?: string;
}): SignalInboundMessage {
  return {
    source: overrides?.source ?? '+1234567890',
    body: overrides?.body ?? 'Hello from Signal',
    timestamp: overrides?.timestamp ?? 1708272000000,
    groupId: overrides?.groupId,
  };
}

describe('SignalAdapter', () => {
  let adapter: ChannelAdapter;

  beforeEach(() => {
    capturedMessageHandler = undefined;
    vi.clearAllMocks();
    adapter = createSignalAdapter(createMockConnection());
  });

  afterEach(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  // --- Identity ---

  describe('identity', () => {
    it('has name "Signal"', () => {
      expect(adapter.name).toBe('Signal');
    });

    it('has type "signal"', () => {
      expect(adapter.type).toBe('signal');
    });
  });

  // --- Connection lifecycle ---

  describe('connect / disconnect', () => {
    it('returns false before connect is called', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns true after connect is called', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });
      expect(adapter.isConnected()).toBe(true);
    });

    it('throws when connecting without a phone number', async () => {
      await expect(adapter.connect({ enabled: true })).rejects.toThrow(
        'Signal adapter requires a phone number',
      );
    });

    it('calls connection.start with the phone number', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });
      expect(mockStart).toHaveBeenCalledWith('+1555000000');
    });

    it('returns false after disconnect', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('calls connection.stop on disconnect', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });
      await adapter.disconnect();
      expect(mockStop).toHaveBeenCalledOnce();
    });

    it('disconnect is safe when not connected', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });

    it('throws when no connection is injected', async () => {
      const adapterNoConn = createSignalAdapter();
      await expect(
        adapterNoConn.connect({ enabled: true, phoneNumber: '+1555000000' }),
      ).rejects.toThrow('Signal adapter requires an injected SignalConnection');
    });
  });

  // --- Message normalization ---

  describe('message normalization', () => {
    it('normalizes a Signal message into a ChannelMessage', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => { receivedMessage = msg; });

      const message = makeSignalMessage({
        source: '+1555111222',
        body: 'Hello world',
        timestamp: 1708272000000,
      });

      expect(capturedMessageHandler).toBeDefined();
      await capturedMessageHandler!(message);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.channelType).toBe('signal');
      expect(receivedMessage!.channelId).toBe('+1555111222');
      expect(receivedMessage!.userId).toBe('+1555111222');
      expect(receivedMessage!.text).toBe('Hello world');
      expect(receivedMessage!.attachments).toEqual([]);
      expect(receivedMessage!.timestamp).toEqual(new Date(1708272000000));
      expect(receivedMessage!.raw).toBe(message);
    });

    it('uses groupId as channelId when present', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => { receivedMessage = msg; });

      const message = makeSignalMessage({ groupId: 'group-abc-123' });
      await capturedMessageHandler!(message);

      expect(receivedMessage!.channelId).toBe('group-abc-123');
    });

    it('generates unique ids for each message', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });

      const messages: ChannelMessage[] = [];
      adapter.onMessage(async (msg) => { messages.push(msg); });

      const message = makeSignalMessage();
      await capturedMessageHandler!(message);
      await capturedMessageHandler!(message);

      expect(messages).toHaveLength(2);
      expect(messages[0].id).not.toBe(messages[1].id);
    });

    it('does not throw when no message handler is registered', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });
      await expect(
        capturedMessageHandler!(makeSignalMessage()),
      ).resolves.toBeUndefined();
    });

    it('does not propagate message handler errors', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });
      adapter.onMessage(async () => { throw new Error('Handler boom'); });
      await expect(
        capturedMessageHandler!(makeSignalMessage()),
      ).resolves.toBeUndefined();
    });
  });

  // --- allowFrom filtering ---

  describe('allowFrom filtering', () => {
    it('allows all users when allowFrom is empty', async () => {
      await adapter.connect({
        enabled: true,
        phoneNumber: '+1555000000',
        allowFrom: [],
      });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => { receivedMessage = msg; });

      await capturedMessageHandler!(makeSignalMessage({ source: '+9999999999' }));
      expect(receivedMessage).toBeDefined();
    });

    it('allows messages from a permitted phone number', async () => {
      await adapter.connect({
        enabled: true,
        phoneNumber: '+1555000000',
        allowFrom: ['+1111111111', '+2222222222'],
      });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => { receivedMessage = msg; });

      await capturedMessageHandler!(makeSignalMessage({ source: '+2222222222' }));
      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.userId).toBe('+2222222222');
    });

    it('drops messages from a non-permitted phone number', async () => {
      await adapter.connect({
        enabled: true,
        phoneNumber: '+1555000000',
        allowFrom: ['+1111111111', '+2222222222'],
      });

      let handlerCalled = false;
      adapter.onMessage(async () => { handlerCalled = true; });

      await capturedMessageHandler!(makeSignalMessage({ source: '+9999999999' }));
      expect(handlerCalled).toBe(false);
    });
  });

  // --- send ---

  describe('send', () => {
    it('sends messages via the connection', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });

      await adapter.send('+1234567890', 'Hello');

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith('+1234567890', 'Hello');
    });

    it('splits messages longer than 4096 characters', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });

      const longText = 'A'.repeat(5000);
      await adapter.send('+1234567890', longText);

      expect(mockSend).toHaveBeenCalledTimes(2);

      const firstText = mockSend.mock.calls[0][1] as string;
      const secondText = mockSend.mock.calls[1][1] as string;
      expect(firstText.length + secondText.length).toBe(5000);
      expect(firstText.length).toBeLessThanOrEqual(4096);
    });

    it('does not throw when connection is not initialized', async () => {
      const adapterNoConn = createSignalAdapter();
      await expect(adapterNoConn.send('+123', 'No conn')).resolves.toBeUndefined();
    });

    it('does not throw when send fails', async () => {
      await adapter.connect({ enabled: true, phoneNumber: '+1555000000' });
      mockSend.mockRejectedValueOnce(new Error('Send error'));
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
