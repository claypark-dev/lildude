import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChannelMessage, ChannelAdapter } from '../../../src/types/index.js';
import type {
  SlackClient,
  SlackClientFactory,
  SlackMessageEvent,
  SlackPostMessageOptions,
} from '../../../src/channels/slack.js';
import { createSlackAdapter, splitMessage } from '../../../src/channels/slack.js';

/** Captured message handler from client.onMessage */
let capturedMessageHandler: ((event: SlackMessageEvent) => Promise<void>) | undefined;

/** Mock postMessage */
const mockPostMessage = vi.fn<(options: SlackPostMessageOptions) => Promise<void>>()
  .mockResolvedValue(undefined);

/** Mock start */
const mockStart = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

/** Mock stop */
const mockStop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

/**
 * Create a mock SlackClient factory for testing.
 */
function createMockFactory(): SlackClientFactory {
  return () => {
    const mockClient: SlackClient = {
      start: mockStart,
      stop: mockStop,
      onMessage(handler: (event: SlackMessageEvent) => Promise<void>): void {
        capturedMessageHandler = handler;
      },
      postMessage: mockPostMessage,
    };
    return mockClient;
  };
}

/**
 * Helper: create a minimal Slack message event.
 */
function makeSlackEvent(overrides?: {
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
}): SlackMessageEvent {
  return {
    type: 'message',
    channel: overrides?.channel ?? 'C12345',
    user: overrides?.user ?? 'U67890',
    text: overrides?.text ?? 'Hello from Slack',
    ts: overrides?.ts ?? '1708272000.000100',
    thread_ts: overrides?.thread_ts,
  };
}

describe('SlackAdapter', () => {
  let adapter: ChannelAdapter;

  beforeEach(() => {
    capturedMessageHandler = undefined;
    vi.clearAllMocks();
    adapter = createSlackAdapter(createMockFactory());
  });

  afterEach(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  // --- Identity ---

  describe('identity', () => {
    it('has name "Slack"', () => {
      expect(adapter.name).toBe('Slack');
    });

    it('has type "slack"', () => {
      expect(adapter.type).toBe('slack');
    });
  });

  // --- Connection lifecycle ---

  describe('connect / disconnect', () => {
    it('returns false before connect is called', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns true after connect is called', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });
      expect(adapter.isConnected()).toBe(true);
    });

    it('throws when connecting without a token', async () => {
      await expect(adapter.connect({ enabled: true })).rejects.toThrow(
        'Slack adapter requires a bot token',
      );
    });

    it('throws when connecting without an appToken', async () => {
      await expect(
        adapter.connect({ enabled: true, token: 'xoxb-test' }),
      ).rejects.toThrow('config.appToken');
    });

    it('calls client.start on connect', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });
      expect(mockStart).toHaveBeenCalledOnce();
    });

    it('returns false after disconnect', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('calls client.stop on disconnect', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });
      await adapter.disconnect();
      expect(mockStop).toHaveBeenCalledOnce();
    });

    it('disconnect is safe when not connected', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  // --- Message normalization ---

  describe('message normalization', () => {
    it('normalizes a Slack event into a ChannelMessage', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => {
        receivedMessage = msg;
      });

      const event = makeSlackEvent({
        channel: 'C111',
        user: 'U222',
        text: 'Hello world',
        ts: '1708272000.000100',
      });

      expect(capturedMessageHandler).toBeDefined();
      await capturedMessageHandler!(event);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.channelType).toBe('slack');
      expect(receivedMessage!.channelId).toBe('C111');
      expect(receivedMessage!.userId).toBe('U222');
      expect(receivedMessage!.text).toBe('Hello world');
      expect(receivedMessage!.attachments).toEqual([]);
      expect(receivedMessage!.raw).toBe(event);
    });

    it('generates unique ids for each message', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      const messages: ChannelMessage[] = [];
      adapter.onMessage(async (msg) => { messages.push(msg); });

      const event = makeSlackEvent();
      await capturedMessageHandler!(event);
      await capturedMessageHandler!(event);

      expect(messages).toHaveLength(2);
      expect(messages[0].id).not.toBe(messages[1].id);
    });

    it('preserves thread_ts as replyToMessageId', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => { receivedMessage = msg; });

      const event = makeSlackEvent({ thread_ts: '1708272000.000050' });
      await capturedMessageHandler!(event);

      expect(receivedMessage!.replyToMessageId).toBe('1708272000.000050');
    });

    it('does not throw when no message handler is registered', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      const event = makeSlackEvent();
      await expect(capturedMessageHandler!(event)).resolves.toBeUndefined();
    });

    it('does not propagate message handler errors', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      adapter.onMessage(async () => { throw new Error('Handler boom'); });

      const event = makeSlackEvent();
      await expect(capturedMessageHandler!(event)).resolves.toBeUndefined();
    });
  });

  // --- allowFrom filtering ---

  describe('allowFrom filtering', () => {
    it('allows all users when allowFrom is empty', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
        allowFrom: [],
      });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => { receivedMessage = msg; });

      await capturedMessageHandler!(makeSlackEvent({ user: 'U99999' }));
      expect(receivedMessage).toBeDefined();
    });

    it('allows messages from a permitted user', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
        allowFrom: ['U100', 'U200'],
      });

      let receivedMessage: ChannelMessage | undefined;
      adapter.onMessage(async (msg) => { receivedMessage = msg; });

      await capturedMessageHandler!(makeSlackEvent({ user: 'U200' }));
      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.userId).toBe('U200');
    });

    it('drops messages from a non-permitted user', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
        allowFrom: ['U100', 'U200'],
      });

      let handlerCalled = false;
      adapter.onMessage(async () => { handlerCalled = true; });

      await capturedMessageHandler!(makeSlackEvent({ user: 'U999' }));
      expect(handlerCalled).toBe(false);
    });
  });

  // --- send: message splitting ---

  describe('message splitting', () => {
    it('sends short messages as a single chunk', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      await adapter.send('C123', 'Short message');

      expect(mockPostMessage).toHaveBeenCalledOnce();
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'C123', text: 'Short message' }),
      );
    });

    it('splits messages longer than 3000 characters', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      const longText = 'A'.repeat(4000);
      await adapter.send('C123', longText);

      expect(mockPostMessage).toHaveBeenCalledTimes(2);

      const firstText = (mockPostMessage.mock.calls[0][0] as SlackPostMessageOptions).text;
      const secondText = (mockPostMessage.mock.calls[1][0] as SlackPostMessageOptions).text;
      expect(firstText.length + secondText.length).toBe(4000);
      expect(firstText.length).toBeLessThanOrEqual(3000);
    });
  });

  // --- send: threading ---

  describe('send with thread_ts for replies', () => {
    it('sets thread_ts when replyToMessageId is provided', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      await adapter.send('C123', 'Reply', { replyToMessageId: '1234.5678' });

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ thread_ts: '1234.5678' }),
      );
    });
  });

  // --- send: button blocks ---

  describe('button blocks', () => {
    it('sends button blocks when buttons are provided', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      await adapter.send('C123', 'Pick one', {
        buttons: [
          { label: 'Approve', id: 'approve' },
          { label: 'Deny', id: 'deny' },
        ],
      });

      expect(mockPostMessage).toHaveBeenCalledOnce();
      const callArgs = mockPostMessage.mock.calls[0][0] as SlackPostMessageOptions;
      expect(callArgs.blocks).toBeDefined();

      const actionsBlock = (callArgs.blocks as Array<Record<string, unknown>>)[0];
      expect(actionsBlock.type).toBe('actions');
      const elements = actionsBlock.elements as Array<Record<string, unknown>>;
      expect(elements).toHaveLength(2);
      expect(elements[0]).toMatchObject({
        type: 'button',
        text: { type: 'plain_text', text: 'Approve' },
        action_id: 'approve',
      });
    });

    it('attaches buttons only to the last chunk of a split message', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      const longText = 'A'.repeat(4000);
      await adapter.send('C123', longText, {
        buttons: [{ label: 'OK', id: 'ok' }],
      });

      expect(mockPostMessage).toHaveBeenCalledTimes(2);
      const firstArgs = mockPostMessage.mock.calls[0][0] as SlackPostMessageOptions;
      const lastArgs = mockPostMessage.mock.calls[1][0] as SlackPostMessageOptions;

      expect(firstArgs.blocks).toBeUndefined();
      expect(lastArgs.blocks).toBeDefined();
    });
  });

  // --- send: error handling ---

  describe('send error handling', () => {
    it('does not throw when client is not connected', async () => {
      await expect(adapter.send('C123', 'No client')).resolves.toBeUndefined();
    });

    it('does not throw when postMessage fails', async () => {
      await adapter.connect({
        enabled: true,
        token: 'xoxb-test',
        appToken: 'xapp-test',
      });

      mockPostMessage.mockRejectedValueOnce(new Error('API error'));
      await expect(adapter.send('C123', 'Fail gracefully')).resolves.toBeUndefined();
    });
  });

  // --- splitMessage utility ---

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

    it('prefers splitting at newline boundaries', () => {
      const part1 = 'A'.repeat(2900);
      const part2 = 'B'.repeat(100);
      const text = `${part1}\n${part2}`;
      const chunks = splitMessage(text);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toBe(`${part1}\n`);
      expect(chunks[1]).toBe(part2);
    });
  });
});
