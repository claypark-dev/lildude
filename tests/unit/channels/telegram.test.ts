import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChannelMessage, ChannelAdapter } from '../../../src/types/index.js';

/**
 * Captured handler from bot.on('text', handler).
 * We store it so tests can invoke it directly.
 */
let capturedTextHandler: ((ctx: unknown) => Promise<void>) | undefined;

/** Captured error handler from bot.catch(handler). */
let capturedErrorHandler: ((err: unknown) => void) | undefined;

/** Mock for bot.telegram.sendMessage */
const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

/** Mock for bot.launch */
const mockLaunch = vi.fn().mockResolvedValue(undefined);

/** Mock for bot.stop */
const mockStop = vi.fn();

/** Mock Telegraf constructor */
vi.mock('telegraf', () => {
  return {
    Telegraf: vi.fn().mockImplementation(() => ({
      on: vi.fn((event: string, handler: (ctx: unknown) => Promise<void>) => {
        if (event === 'text') {
          capturedTextHandler = handler;
        }
      }),
      catch: vi.fn((handler: (err: unknown) => void) => {
        capturedErrorHandler = handler;
      }),
      launch: mockLaunch,
      stop: mockStop,
      telegram: {
        sendMessage: mockSendMessage,
      },
    })),
  };
});

// Import after mocking
import {
  createTelegramAdapter,
  splitMessage,
  escapeMarkdownV2,
} from '../../../src/channels/telegram.js';

/**
 * Helper: create a minimal Telegraf-like text message context object.
 */
function makeTelegramCtx(overrides?: {
  chatId?: number;
  userId?: number;
  text?: string;
  messageId?: number;
  replyToMessageId?: number;
  date?: number;
}): Record<string, unknown> {
  const chatId = overrides?.chatId ?? 12345;
  const userId = overrides?.userId ?? 67890;
  const text = overrides?.text ?? 'Hello from Telegram';
  const messageId = overrides?.messageId ?? 100;
  const date = overrides?.date ?? Math.floor(Date.now() / 1000);

  const replyToMessage = overrides?.replyToMessageId
    ? { message_id: overrides.replyToMessageId }
    : undefined;

  return {
    message: {
      message_id: messageId,
      chat: { id: chatId },
      from: { id: userId },
      text,
      date,
      reply_to_message: replyToMessage,
    },
    update: {
      update_id: 999,
      message: {
        message_id: messageId,
        chat: { id: chatId },
        from: { id: userId },
        text,
        date,
        reply_to_message: replyToMessage,
      },
    },
  };
}

describe('TelegramAdapter', () => {
  let adapter: ChannelAdapter;

  beforeEach(() => {
    capturedTextHandler = undefined;
    capturedErrorHandler = undefined;
    vi.clearAllMocks();
    adapter = createTelegramAdapter();
  });

  afterEach(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  // --- Identity ---

  describe('identity', () => {
    it('has name "Telegram"', () => {
      expect(adapter.name).toBe('Telegram');
    });

    it('has type "telegram"', () => {
      expect(adapter.type).toBe('telegram');
    });
  });

  // --- Connection lifecycle ---

  describe('connect / disconnect', () => {
    it('returns false before connect is called', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns true after connect is called', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });
      expect(adapter.isConnected()).toBe(true);
    });

    it('throws when connecting without a token', async () => {
      await expect(adapter.connect({ enabled: true })).rejects.toThrow(
        'Telegram adapter requires a bot token',
      );
    });

    it('calls bot.launch on connect', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });
      expect(mockLaunch).toHaveBeenCalledOnce();
    });

    it('returns false after disconnect', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('calls bot.stop on disconnect', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });
      await adapter.disconnect();
      expect(mockStop).toHaveBeenCalledOnce();
    });

    it('disconnect is safe when not connected', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  // --- Message normalization ---

  describe('message normalization', () => {
    it('normalizes a Telegram text message into a ChannelMessage', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        receivedMessage = msg;
      });

      const ctx = makeTelegramCtx({
        chatId: 111,
        userId: 222,
        text: 'Hello world',
        date: 1708272000,
      });

      expect(capturedTextHandler).toBeDefined();
      await capturedTextHandler!(ctx);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.channelType).toBe('telegram');
      expect(receivedMessage!.channelId).toBe('111');
      expect(receivedMessage!.userId).toBe('222');
      expect(receivedMessage!.text).toBe('Hello world');
      expect(receivedMessage!.attachments).toEqual([]);
      expect(receivedMessage!.timestamp).toEqual(new Date(1708272000 * 1000));
      expect(receivedMessage!.raw).toBe(ctx.update);
    });

    it('generates a unique id for each normalized message', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      const receivedMessages: ChannelMessage[] = [];
      adapter.onMessage(async (msg) => {
        receivedMessages.push(msg);
      });

      const ctx = makeTelegramCtx();

      await capturedTextHandler!(ctx);
      await capturedTextHandler!(ctx);

      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages[0].id).not.toBe(receivedMessages[1].id);
    });

    it('preserves replyToMessageId from the Telegram message', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        receivedMessage = msg;
      });

      const ctx = makeTelegramCtx({ replyToMessageId: 42 });

      await capturedTextHandler!(ctx);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.replyToMessageId).toBe('42');
    });

    it('does not set replyToMessageId when there is no reply', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        receivedMessage = msg;
      });

      const ctx = makeTelegramCtx();

      await capturedTextHandler!(ctx);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.replyToMessageId).toBeUndefined();
    });

    it('does not throw when no message handler is registered', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      const ctx = makeTelegramCtx();

      await expect(capturedTextHandler!(ctx)).resolves.toBeUndefined();
    });

    it('does not propagate message handler errors', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      adapter.onMessage(async () => {
        throw new Error('Handler boom');
      });

      const ctx = makeTelegramCtx();

      await expect(capturedTextHandler!(ctx)).resolves.toBeUndefined();
    });
  });

  // --- allowFrom filtering ---

  describe('allowFrom filtering', () => {
    it('allows all users when allowFrom is empty', async () => {
      await adapter.connect({ enabled: true, token: 'test-token', allowFrom: [] });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        receivedMessage = msg;
      });

      const ctx = makeTelegramCtx({ userId: 99999 });
      await capturedTextHandler!(ctx);

      expect(receivedMessage).toBeDefined();
    });

    it('allows all users when allowFrom is not provided', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        receivedMessage = msg;
      });

      const ctx = makeTelegramCtx({ userId: 99999 });
      await capturedTextHandler!(ctx);

      expect(receivedMessage).toBeDefined();
    });

    it('allows messages from a permitted user', async () => {
      await adapter.connect({
        enabled: true,
        token: 'test-token',
        allowFrom: ['100', '200'],
      });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        receivedMessage = msg;
      });

      const ctx = makeTelegramCtx({ userId: 200 });
      await capturedTextHandler!(ctx);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.userId).toBe('200');
    });

    it('drops messages from a non-permitted user', async () => {
      await adapter.connect({
        enabled: true,
        token: 'test-token',
        allowFrom: ['100', '200'],
      });

      let handlerCalled = false;
      adapter.onMessage(async () => {
        handlerCalled = true;
      });

      const ctx = makeTelegramCtx({ userId: 999 });
      await capturedTextHandler!(ctx);

      expect(handlerCalled).toBe(false);
    });
  });

  // --- send: long message splitting ---

  describe('message splitting', () => {
    it('sends short messages as a single chunk', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      await adapter.send('123', 'Short message');

      expect(mockSendMessage).toHaveBeenCalledOnce();
      expect(mockSendMessage).toHaveBeenCalledWith('123', 'Short message', expect.any(Object));
    });

    it('splits messages longer than 4096 characters', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      const longText = 'A'.repeat(5000);
      await adapter.send('123', longText);

      expect(mockSendMessage).toHaveBeenCalledTimes(2);

      // Verify all chunks were delivered
      const firstCallText = mockSendMessage.mock.calls[0][1] as string;
      const secondCallText = mockSendMessage.mock.calls[1][1] as string;
      expect(firstCallText.length + secondCallText.length).toBe(5000);
      expect(firstCallText.length).toBeLessThanOrEqual(4096);
      expect(secondCallText.length).toBeLessThanOrEqual(4096);
    });

    it('prefers splitting at newline boundaries', async () => {
      const part1 = 'A'.repeat(4000);
      const part2 = 'B'.repeat(100);
      const textWithNewline = `${part1}\n${part2}`;

      const chunks = splitMessage(textWithNewline);

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toBe(`${part1}\n`);
      expect(chunks[1]).toBe(part2);
    });
  });

  // --- send: buttons create inline keyboard ---

  describe('buttons create inline keyboard', () => {
    it('sends inline keyboard markup when buttons are provided', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      await adapter.send('123', 'Pick one', {
        buttons: [
          { label: 'Approve', id: 'approve' },
          { label: 'Deny', id: 'deny' },
        ],
      });

      expect(mockSendMessage).toHaveBeenCalledOnce();

      const extra = mockSendMessage.mock.calls[0][2] as Record<string, unknown>;
      const markup = extra.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      };

      expect(markup).toBeDefined();
      expect(markup.inline_keyboard).toHaveLength(1);
      expect(markup.inline_keyboard[0]).toHaveLength(2);
      expect(markup.inline_keyboard[0][0]).toEqual({ text: 'Approve', callback_data: 'approve' });
      expect(markup.inline_keyboard[0][1]).toEqual({ text: 'Deny', callback_data: 'deny' });
    });

    it('does not add reply_markup when no buttons are provided', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      await adapter.send('123', 'No buttons');

      const extra = mockSendMessage.mock.calls[0][2] as Record<string, unknown>;
      expect(extra.reply_markup).toBeUndefined();
    });

    it('attaches buttons only to the last chunk of a split message', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      const longText = 'A'.repeat(5000);
      await adapter.send('123', longText, {
        buttons: [{ label: 'OK', id: 'ok' }],
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(2);

      const firstExtra = mockSendMessage.mock.calls[0][2] as Record<string, unknown>;
      const lastExtra = mockSendMessage.mock.calls[1][2] as Record<string, unknown>;

      expect(firstExtra.reply_markup).toBeUndefined();
      expect(lastExtra.reply_markup).toBeDefined();
    });
  });

  // --- send: reply threading ---

  describe('send with reply', () => {
    it('sets reply_parameters when replyToMessageId is provided', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      await adapter.send('123', 'Reply text', {
        replyToMessageId: '42',
      });

      expect(mockSendMessage).toHaveBeenCalledOnce();

      const extra = mockSendMessage.mock.calls[0][2] as Record<string, unknown>;
      expect(extra.reply_parameters).toEqual({ message_id: 42 });
    });

    it('applies reply_parameters only to the first chunk', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      const longText = 'A'.repeat(5000);
      await adapter.send('123', longText, {
        replyToMessageId: '42',
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(2);

      const firstExtra = mockSendMessage.mock.calls[0][2] as Record<string, unknown>;
      const secondExtra = mockSendMessage.mock.calls[1][2] as Record<string, unknown>;

      expect(firstExtra.reply_parameters).toEqual({ message_id: 42 });
      expect(secondExtra.reply_parameters).toBeUndefined();
    });
  });

  // --- send: parse modes ---

  describe('send with parse mode', () => {
    it('sets parse_mode to MarkdownV2 for markdown', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      await adapter.send('123', 'Bold text', { parseMode: 'markdown' });

      const extra = mockSendMessage.mock.calls[0][2] as Record<string, unknown>;
      expect(extra.parse_mode).toBe('MarkdownV2');
    });

    it('sets parse_mode to HTML for html', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      await adapter.send('123', '<b>Bold</b>', { parseMode: 'html' });

      const extra = mockSendMessage.mock.calls[0][2] as Record<string, unknown>;
      expect(extra.parse_mode).toBe('HTML');
    });

    it('does not set parse_mode for plain', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      await adapter.send('123', 'Plain text', { parseMode: 'plain' });

      const extra = mockSendMessage.mock.calls[0][2] as Record<string, unknown>;
      expect(extra.parse_mode).toBeUndefined();
    });
  });

  // --- send: silent mode ---

  describe('send with silent mode', () => {
    it('sets disable_notification when silent is true', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      await adapter.send('123', 'Quiet', { silent: true });

      const extra = mockSendMessage.mock.calls[0][2] as Record<string, unknown>;
      expect(extra.disable_notification).toBe(true);
    });
  });

  // --- send: error handling ---

  describe('send error handling', () => {
    it('does not throw when bot is not connected', async () => {
      await expect(adapter.send('123', 'No bot')).resolves.toBeUndefined();
    });

    it('does not throw when sendMessage fails', async () => {
      await adapter.connect({ enabled: true, token: 'test-token' });

      mockSendMessage.mockRejectedValueOnce(new Error('API error'));

      await expect(adapter.send('123', 'Fail gracefully')).resolves.toBeUndefined();
    });
  });

  // --- Utility exports ---

  describe('splitMessage utility', () => {
    it('returns single chunk for text within limit', () => {
      const chunks = splitMessage('Short', 10);
      expect(chunks).toEqual(['Short']);
    });

    it('splits at exact limit when no newline present', () => {
      const chunks = splitMessage('ABCDEFGHIJ', 5);
      expect(chunks).toEqual(['ABCDE', 'FGHIJ']);
    });

    it('handles empty string', () => {
      const chunks = splitMessage('');
      expect(chunks).toEqual(['']);
    });

    it('handles text exactly at limit', () => {
      const text = 'A'.repeat(4096);
      const chunks = splitMessage(text);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });
  });

  describe('escapeMarkdownV2 utility', () => {
    it('escapes special MarkdownV2 characters', () => {
      expect(escapeMarkdownV2('hello_world')).toBe('hello\\_world');
      expect(escapeMarkdownV2('*bold*')).toBe('\\*bold\\*');
      expect(escapeMarkdownV2('[link](url)')).toBe('\\[link\\]\\(url\\)');
    });

    it('leaves plain text unchanged', () => {
      expect(escapeMarkdownV2('hello world')).toBe('hello world');
    });
  });
});
