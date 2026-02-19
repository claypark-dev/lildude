/**
 * Tests for the iMessage channel adapter.
 * Verifies OS detection, AppleScript construction, message normalization,
 * graceful non-macOS behavior, and connect/disconnect lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChannelAdapter, ChannelMessage } from '../../../src/types/index.js';

// --- Hoisted mocks (available before vi.mock factories run) ---

const { mockExecFile, mockPrepare, mockClose, mockDbInstance } = vi.hoisted(() => {
  const mockExecFile = vi.fn(
    (
      _cmd: string,
      _args: string[],
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, '', '');
    },
  );

  const mockPrepare = vi.fn();
  const mockClose = vi.fn();
  const mockDbInstance = {
    prepare: mockPrepare,
    close: mockClose,
  };

  return { mockExecFile, mockPrepare, mockClose, mockDbInstance };
});

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(() => mockDbInstance),
  };
});

// Import after mocking
import {
  createIMessageAdapter,
  isMacOS,
  buildSendAppleScript,
  getChatDbPath,
} from '../../../src/channels/imessage.js';

/**
 * Set up the mock database to return a valid max ROWID on initialization.
 */
function setupMockDb(): void {
  mockPrepare.mockImplementation((sql: string) => {
    if (sql.includes('MAX(ROWID)')) {
      return { get: () => ({ maxId: 100 }) };
    }
    if (sql.includes('SELECT ROWID')) {
      return { all: () => [] };
    }
    if (sql.includes('SELECT id FROM handle')) {
      return { get: () => ({ ROWID: 1, id: '+15551234567' }) };
    }
    return { all: () => [], get: () => undefined };
  });
}

describe('iMessage Adapter', () => {
  let adapter: ChannelAdapter;
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupMockDb();
    adapter = createIMessageAdapter();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
    // Restore platform
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  // --- Identity ---

  describe('identity', () => {
    it('has name "iMessage"', () => {
      expect(adapter.name).toBe('iMessage');
    });

    it('has type "imessage"', () => {
      expect(adapter.type).toBe('imessage');
    });
  });

  // --- OS detection ---

  describe('isMacOS', () => {
    it('returns true on darwin', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(isMacOS()).toBe(true);
    });

    it('returns false on linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(isMacOS()).toBe(false);
    });

    it('returns false on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(isMacOS()).toBe(false);
    });
  });

  // --- AppleScript construction ---

  describe('buildSendAppleScript', () => {
    it('constructs correct AppleScript for a simple message', () => {
      const script = buildSendAppleScript('+15551234567', 'Hello there!');
      expect(script).toContain('tell application "Messages"');
      expect(script).toContain('participant "+15551234567"');
      expect(script).toContain('send "Hello there!"');
      expect(script).toContain('end tell');
    });

    it('escapes double quotes in the message text', () => {
      const script = buildSendAppleScript('+15551234567', 'He said "hello"');
      expect(script).toContain('send "He said \\"hello\\""');
    });

    it('escapes backslashes in the message text', () => {
      const script = buildSendAppleScript('+15551234567', 'path\\to\\file');
      expect(script).toContain('send "path\\\\to\\\\file"');
    });

    it('escapes special characters in the recipient', () => {
      const script = buildSendAppleScript('user@"example.com', 'Hi');
      expect(script).toContain('participant "user@\\"example.com"');
    });

    it('builds correct AppleScript for an email recipient', () => {
      const script = buildSendAppleScript('user@example.com', 'Test message');
      expect(script).toContain('participant "user@example.com"');
      expect(script).toContain('send "Test message"');
    });
  });

  // --- getChatDbPath ---

  describe('getChatDbPath', () => {
    it('returns a path ending with Library/Messages/chat.db', () => {
      const dbPath = getChatDbPath();
      expect(dbPath).toMatch(/Library\/Messages\/chat\.db$/);
    });
  });

  // --- Graceful skip on non-macOS ---

  describe('graceful skip on non-macOS', () => {
    it('connect returns immediately on non-macOS without setting connected', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      // Create a new adapter after changing platform
      const linuxAdapter = createIMessageAdapter();
      await linuxAdapter.connect({ enabled: true });

      expect(linuxAdapter.isConnected()).toBe(false);
    });

    it('send does not call osascript on non-macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const linuxAdapter = createIMessageAdapter();
      await linuxAdapter.send('+15551234567', 'Hello');

      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  // --- Connect / Disconnect lifecycle ---

  describe('connect / disconnect', () => {
    it('returns false before connect', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('returns true after connect on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const macAdapter = createIMessageAdapter();
      await macAdapter.connect({ enabled: true });

      expect(macAdapter.isConnected()).toBe(true);

      await macAdapter.disconnect();
    });

    it('returns false after disconnect', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const macAdapter = createIMessageAdapter();
      await macAdapter.connect({ enabled: true });
      await macAdapter.disconnect();

      expect(macAdapter.isConnected()).toBe(false);
    });

    it('disconnect is safe when not connected', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });

    it('initializes last seen ROWID on connect', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const macAdapter = createIMessageAdapter();
      await macAdapter.connect({ enabled: true });

      // Verify prepare was called for MAX(ROWID) initialization
      const maxRowIdCalls = mockPrepare.mock.calls.filter(
        (callArgs: string[]) => callArgs[0].includes('MAX(ROWID)'),
      );
      expect(maxRowIdCalls.length).toBeGreaterThan(0);

      await macAdapter.disconnect();
    });

    it('closes the database on disconnect', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const macAdapter = createIMessageAdapter();
      await macAdapter.connect({ enabled: true });
      await macAdapter.disconnect();

      expect(mockClose).toHaveBeenCalled();
    });
  });

  // --- Sending messages ---

  describe('send', () => {
    it('calls osascript with correct AppleScript on macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const macAdapter = createIMessageAdapter();
      await macAdapter.send('+15551234567', 'Hello from Lil Dude');

      expect(mockExecFile).toHaveBeenCalledOnce();
      const callArgs = mockExecFile.mock.calls[0];
      expect(callArgs[0]).toBe('osascript');
      expect(callArgs[1]).toHaveLength(2);
      expect(callArgs[1][0]).toBe('-e');

      const scriptArg = callArgs[1][1] as string;
      expect(scriptArg).toContain('send "Hello from Lil Dude"');
      expect(scriptArg).toContain('participant "+15551234567"');
    });

    it('handles send errors gracefully without throwing', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockExecFile.mockImplementationOnce(
        (
          _cmd: string,
          _args: string[],
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(new Error('AppleScript failed'), '', 'error');
        },
      );

      const macAdapter = createIMessageAdapter();
      await expect(
        macAdapter.send('+15551234567', 'Should fail gracefully'),
      ).resolves.toBeUndefined();
    });
  });

  // --- Message normalization via polling ---

  describe('message normalization', () => {
    it('normalizes incoming iMessage rows into ChannelMessage', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      // Configure mock to return a new message when polled
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('MAX(ROWID)')) {
          return { get: () => ({ maxId: 100 }) };
        }
        if (sql.includes('SELECT ROWID')) {
          return {
            all: () => [
              {
                ROWID: 101,
                text: 'Hello from iPhone',
                handle_id: 1,
                date: 700_000_000_000_000_000,
                is_from_me: 0,
              },
            ],
          };
        }
        if (sql.includes('SELECT id FROM handle')) {
          return { get: () => ({ ROWID: 1, id: '+15559876543' }) };
        }
        return { all: () => [], get: () => undefined };
      });

      const macAdapter = createIMessageAdapter();
      let receivedMessage: ChannelMessage | undefined;

      macAdapter.onMessage(async (msg) => {
        receivedMessage = msg;
      });

      await macAdapter.connect({ enabled: true });

      // Advance timer to trigger a poll
      vi.advanceTimersByTime(5000);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.channelType).toBe('imessage');
      expect(receivedMessage!.channelId).toBe('+15559876543');
      expect(receivedMessage!.userId).toBe('+15559876543');
      expect(receivedMessage!.text).toBe('Hello from iPhone');
      expect(receivedMessage!.attachments).toEqual([]);
      expect(receivedMessage!.id).toBeDefined();

      await macAdapter.disconnect();
    });

    it('skips messages with empty text', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('MAX(ROWID)')) {
          return { get: () => ({ maxId: 100 }) };
        }
        if (sql.includes('SELECT ROWID')) {
          return {
            all: () => [
              {
                ROWID: 101,
                text: null,
                handle_id: 1,
                date: 700_000_000_000_000_000,
                is_from_me: 0,
              },
              {
                ROWID: 102,
                text: '   ',
                handle_id: 1,
                date: 700_000_000_000_000_000,
                is_from_me: 0,
              },
            ],
          };
        }
        if (sql.includes('SELECT id FROM handle')) {
          return { get: () => ({ ROWID: 1, id: '+15551234567' }) };
        }
        return { all: () => [], get: () => undefined };
      });

      const macAdapter = createIMessageAdapter();
      let messageCount = 0;

      macAdapter.onMessage(async () => {
        messageCount++;
      });

      await macAdapter.connect({ enabled: true });
      vi.advanceTimersByTime(5000);

      expect(messageCount).toBe(0);

      await macAdapter.disconnect();
    });

    it('generates unique IDs for each received message', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('MAX(ROWID)')) {
          return { get: () => ({ maxId: 100 }) };
        }
        if (sql.includes('SELECT ROWID')) {
          return {
            all: () => [
              {
                ROWID: 101,
                text: 'First',
                handle_id: 1,
                date: 700_000_000_000_000_000,
                is_from_me: 0,
              },
              {
                ROWID: 102,
                text: 'Second',
                handle_id: 1,
                date: 700_000_000_000_000_000,
                is_from_me: 0,
              },
            ],
          };
        }
        if (sql.includes('SELECT id FROM handle')) {
          return { get: () => ({ ROWID: 1, id: '+15551234567' }) };
        }
        return { all: () => [], get: () => undefined };
      });

      const macAdapter = createIMessageAdapter();
      const receivedMessages: ChannelMessage[] = [];

      macAdapter.onMessage(async (msg) => {
        receivedMessages.push(msg);
      });

      await macAdapter.connect({ enabled: true });
      vi.advanceTimersByTime(5000);

      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages[0].id).not.toBe(receivedMessages[1].id);

      await macAdapter.disconnect();
    });
  });

  // --- allowFrom filtering ---

  describe('allowFrom filtering', () => {
    it('drops messages from non-allowed senders', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('MAX(ROWID)')) {
          return { get: () => ({ maxId: 100 }) };
        }
        if (sql.includes('SELECT ROWID')) {
          return {
            all: () => [
              {
                ROWID: 101,
                text: 'Blocked message',
                handle_id: 1,
                date: 700_000_000_000_000_000,
                is_from_me: 0,
              },
            ],
          };
        }
        if (sql.includes('SELECT id FROM handle')) {
          return { get: () => ({ ROWID: 1, id: '+15559999999' }) };
        }
        return { all: () => [], get: () => undefined };
      });

      const macAdapter = createIMessageAdapter();
      let handlerCalled = false;

      macAdapter.onMessage(async () => {
        handlerCalled = true;
      });

      await macAdapter.connect({
        enabled: true,
        allowFrom: ['+15551234567'],
      });

      vi.advanceTimersByTime(5000);

      expect(handlerCalled).toBe(false);

      await macAdapter.disconnect();
    });
  });

  // --- onMessage handler ---

  describe('onMessage', () => {
    it('registers a message handler', () => {
      const handler = vi.fn();
      adapter.onMessage(handler);

      // No throw, handler is stored internally
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
