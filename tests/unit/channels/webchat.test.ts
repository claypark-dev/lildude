import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWebChatAdapter, type WebChatAdapter } from '../../../src/channels/webchat.js';
import type { ChannelMessage, WSMessage } from '../../../src/types/index.js';

describe('WebChatAdapter', () => {
  let adapter: WebChatAdapter;

  beforeEach(() => {
    adapter = createWebChatAdapter();
  });

  // --- Connection state ---

  describe('isConnected', () => {
    it('returns false before connect() is called', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns true after connect() is called', async () => {
      await adapter.connect({ enabled: true });
      expect(adapter.isConnected()).toBe(true);
    });

    it('returns false after disconnect() is called', async () => {
      await adapter.connect({ enabled: true });
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  // --- Adapter identity ---

  describe('identity', () => {
    it('has name "WebChat"', () => {
      expect(adapter.name).toBe('WebChat');
    });

    it('has type "webchat"', () => {
      expect(adapter.type).toBe('webchat');
    });
  });

  // --- Message normalization ---

  describe('handleWebSocketMessage', () => {
    it('normalizes a chat.send WS message into a ChannelMessage', async () => {
      await adapter.connect({ enabled: true });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        receivedMessage = msg;
      });

      const wsMessage: WSMessage = {
        type: 'chat.send',
        payload: { text: 'Hello world' },
        timestamp: '2026-02-18T12:00:00.000Z',
      };

      await adapter.handleWebSocketMessage('client-1', wsMessage);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.channelType).toBe('webchat');
      expect(receivedMessage!.channelId).toBe('client-1');
      expect(receivedMessage!.userId).toBe('client-1');
      expect(receivedMessage!.text).toBe('Hello world');
      expect(receivedMessage!.attachments).toEqual([]);
      expect(receivedMessage!.timestamp).toEqual(new Date('2026-02-18T12:00:00.000Z'));
      expect(receivedMessage!.raw).toBe(wsMessage);
    });

    it('generates a unique id for each normalized message', async () => {
      await adapter.connect({ enabled: true });

      const receivedMessages: ChannelMessage[] = [];
      adapter.onMessage(async (msg) => {
        receivedMessages.push(msg);
      });

      const wsMessage: WSMessage = {
        type: 'chat.send',
        payload: { text: 'Message' },
        timestamp: new Date().toISOString(),
      };

      await adapter.handleWebSocketMessage('client-1', wsMessage);
      await adapter.handleWebSocketMessage('client-1', wsMessage);

      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages[0].id).not.toBe(receivedMessages[1].id);
    });

    it('preserves replyToMessageId from the payload', async () => {
      await adapter.connect({ enabled: true });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        receivedMessage = msg;
      });

      const wsMessage: WSMessage = {
        type: 'chat.send',
        payload: { text: 'Reply', replyToMessageId: 'msg-42' },
        timestamp: new Date().toISOString(),
      };

      await adapter.handleWebSocketMessage('client-1', wsMessage);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.replyToMessageId).toBe('msg-42');
    });

    it('ignores non-chat.send message types', async () => {
      await adapter.connect({ enabled: true });

      let handlerCalled = false;
      adapter.onMessage(async () => {
        handlerCalled = true;
      });

      const wsMessage: WSMessage = {
        type: 'system.ping',
        payload: {},
        timestamp: new Date().toISOString(),
      };

      await adapter.handleWebSocketMessage('client-1', wsMessage);

      expect(handlerCalled).toBe(false);
    });

    it('ignores chat.send with invalid payload', async () => {
      await adapter.connect({ enabled: true });

      let handlerCalled = false;
      adapter.onMessage(async () => {
        handlerCalled = true;
      });

      const wsMessage: WSMessage = {
        type: 'chat.send',
        payload: { notText: 123 },
        timestamp: new Date().toISOString(),
      };

      await adapter.handleWebSocketMessage('client-1', wsMessage);

      expect(handlerCalled).toBe(false);
    });

    it('does not throw when no message handler is registered', async () => {
      await adapter.connect({ enabled: true });

      const wsMessage: WSMessage = {
        type: 'chat.send',
        payload: { text: 'No handler' },
        timestamp: new Date().toISOString(),
      };

      await expect(
        adapter.handleWebSocketMessage('client-1', wsMessage),
      ).resolves.toBeUndefined();
    });

    it('does not propagate handler errors', async () => {
      await adapter.connect({ enabled: true });

      adapter.onMessage(async () => {
        throw new Error('Handler boom');
      });

      const wsMessage: WSMessage = {
        type: 'chat.send',
        payload: { text: 'Will error' },
        timestamp: new Date().toISOString(),
      };

      await expect(
        adapter.handleWebSocketMessage('client-1', wsMessage),
      ).resolves.toBeUndefined();
    });
  });

  // --- send() ---

  describe('send', () => {
    it('sends a response through the registered client send function', async () => {
      await adapter.connect({ enabled: true });

      const sent: WSMessage[] = [];
      adapter.registerClient('client-1', (data) => sent.push(data));

      await adapter.send('client-1', 'Hello back');

      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('chat.message');

      const payload = sent[0].payload as Record<string, unknown>;
      expect(payload.text).toBe('Hello back');
      expect(typeof payload.id).toBe('string');
      expect(typeof sent[0].timestamp).toBe('string');
    });

    it('forwards SendOptions fields in the payload', async () => {
      await adapter.connect({ enabled: true });

      const sent: WSMessage[] = [];
      adapter.registerClient('client-1', (data) => sent.push(data));

      await adapter.send('client-1', 'Pick one', {
        replyToMessageId: 'msg-99',
        buttons: [{ label: 'Yes', id: 'btn-yes' }],
        parseMode: 'markdown',
      });

      expect(sent).toHaveLength(1);
      const payload = sent[0].payload as Record<string, unknown>;
      expect(payload.replyToMessageId).toBe('msg-99');
      expect(payload.buttons).toEqual([{ label: 'Yes', id: 'btn-yes' }]);
      expect(payload.parseMode).toBe('markdown');
    });

    it('does not throw when sending to an unregistered client', async () => {
      await adapter.connect({ enabled: true });

      await expect(
        adapter.send('unknown-client', 'Hello'),
      ).resolves.toBeUndefined();
    });

    it('does not throw when the client send function throws', async () => {
      await adapter.connect({ enabled: true });

      adapter.registerClient('client-1', () => {
        throw new Error('Send failed');
      });

      await expect(
        adapter.send('client-1', 'Hello'),
      ).resolves.toBeUndefined();
    });
  });

  // --- Client management ---

  describe('registerClient / removeClient', () => {
    it('allows multiple clients to be registered', async () => {
      await adapter.connect({ enabled: true });

      const sent1: WSMessage[] = [];
      const sent2: WSMessage[] = [];
      adapter.registerClient('client-1', (data) => sent1.push(data));
      adapter.registerClient('client-2', (data) => sent2.push(data));

      await adapter.send('client-1', 'To first');
      await adapter.send('client-2', 'To second');

      expect(sent1).toHaveLength(1);
      expect(sent2).toHaveLength(1);

      const payload1 = sent1[0].payload as Record<string, unknown>;
      const payload2 = sent2[0].payload as Record<string, unknown>;
      expect(payload1.text).toBe('To first');
      expect(payload2.text).toBe('To second');
    });

    it('removing a client prevents further sends to that client', async () => {
      await adapter.connect({ enabled: true });

      const sent: WSMessage[] = [];
      adapter.registerClient('client-1', (data) => sent.push(data));

      adapter.removeClient('client-1');

      await adapter.send('client-1', 'Should not arrive');

      expect(sent).toHaveLength(0);
    });

    it('removing a non-existent client does not throw', () => {
      expect(() => adapter.removeClient('ghost')).not.toThrow();
    });

    it('replacing a client updates the send function', async () => {
      await adapter.connect({ enabled: true });

      const sentOld: WSMessage[] = [];
      const sentNew: WSMessage[] = [];

      adapter.registerClient('client-1', (data) => sentOld.push(data));
      adapter.registerClient('client-1', (data) => sentNew.push(data));

      await adapter.send('client-1', 'After replace');

      expect(sentOld).toHaveLength(0);
      expect(sentNew).toHaveLength(1);
    });
  });

  // --- disconnect cleanup ---

  describe('disconnect', () => {
    it('clears all registered clients on disconnect', async () => {
      await adapter.connect({ enabled: true });

      const sent: WSMessage[] = [];
      adapter.registerClient('client-1', (data) => sent.push(data));

      await adapter.disconnect();

      // Reconnect to be able to send
      await adapter.connect({ enabled: true });

      await adapter.send('client-1', 'Should not arrive');
      expect(sent).toHaveLength(0);
    });

    it('clears the message handler on disconnect', async () => {
      await adapter.connect({ enabled: true });

      const handler = vi.fn();
      adapter.onMessage(handler);

      await adapter.disconnect();

      // Even after reconnecting, handler is cleared
      await adapter.connect({ enabled: true });

      const wsMessage: WSMessage = {
        type: 'chat.send',
        payload: { text: 'Post-disconnect' },
        timestamp: new Date().toISOString(),
      };

      await adapter.handleWebSocketMessage('client-1', wsMessage);

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
