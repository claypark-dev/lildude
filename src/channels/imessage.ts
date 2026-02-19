/**
 * iMessage channel adapter (macOS only).
 * Sends messages via AppleScript and receives by polling the iMessage
 * SQLite database at ~/Library/Messages/chat.db (read-only).
 * Gracefully skips on non-macOS platforms.
 * See HLD Section 10 for channel adapter architecture.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { channelLogger } from '../utils/logger.js';
import type {
  ChannelAdapter, ChannelConfig, ChannelMessage, ChannelType, SendOptions,
} from '../types/index.js';

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 5000;
const CHAT_DB_RELATIVE_PATH = 'Library/Messages/chat.db';

/** Raw row shape from the iMessage chat.db message table. */
interface IMessageDbRow {
  ROWID: number;
  text: string | null;
  handle_id: number;
  date: number;
  is_from_me: number;
}

/** Raw row from the handle table mapping handle_id to phone/email. */
interface HandleDbRow { ROWID: number; id: string }

/**
 * Check if the current platform is macOS.
 * @returns True if running on macOS (darwin).
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * Build the AppleScript string for sending an iMessage.
 * @param recipient - The phone number or email address of the recipient.
 * @param text - The message text to send.
 * @returns The AppleScript source string.
 */
export function buildSendAppleScript(recipient: string, text: string): string {
  const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedRecipient = recipient.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    'tell application "Messages"',
    `  set targetService to 1st account whose service type = iMessage`,
    `  set targetBuddy to participant "${escapedRecipient}" of targetService`,
    `  send "${escapedText}" to targetBuddy`,
    'end tell',
  ].join('\n');
}

/** Resolve the full path to the iMessage chat.db file. */
export function getChatDbPath(): string {
  return join(homedir(), CHAT_DB_RELATIVE_PATH);
}

/**
 * Create an iMessage channel adapter.
 * On non-macOS platforms, connect() logs a warning and returns immediately.
 * @returns A fully-wired iMessage ChannelAdapter.
 */
export function createIMessageAdapter(): ChannelAdapter {
  const log = channelLogger.child({ adapter: 'imessage' });
  let connected = false;
  let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastSeenRowId = 0;
  let chatDb: Database.Database | undefined;
  let allowFromList: string[] = [];

  /** Open a read-only connection to the iMessage database. */
  function openChatDb(): Database.Database | undefined {
    try {
      return new Database(getChatDbPath(), { readonly: true, fileMustExist: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn({ error: msg }, 'Cannot open iMessage database');
      return undefined;
    }
  }

  /** Resolve a handle_id to the phone number or email address. */
  function resolveHandle(handleId: number): string {
    if (!chatDb) return 'unknown';
    try {
      const row = chatDb.prepare(
        'SELECT id FROM handle WHERE ROWID = ?',
      ).get(handleId) as HandleDbRow | undefined;
      return row?.id ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /** Check if a sender is permitted by the allowFrom filter. */
  function isSenderAllowed(senderId: string): boolean {
    return allowFromList.length === 0 || allowFromList.includes(senderId);
  }

  /** Poll for new messages in the iMessage database. */
  function pollNewMessages(): void {
    if (!chatDb || !messageHandler) return;
    try {
      const rows = chatDb.prepare(
        `SELECT ROWID, text, handle_id, date, is_from_me
         FROM message WHERE ROWID > ? AND is_from_me = 0
         ORDER BY ROWID ASC LIMIT 50`,
      ).all(lastSeenRowId) as IMessageDbRow[];

      for (const row of rows) {
        lastSeenRowId = row.ROWID;
        if (!row.text || row.text.trim().length === 0) continue;
        const senderId = resolveHandle(row.handle_id);
        if (!isSenderAllowed(senderId)) {
          log.debug({ senderId }, 'Message from non-allowed sender; dropping');
          continue;
        }
        const channelMessage: ChannelMessage = {
          id: nanoid(),
          channelType: 'imessage' as ChannelType,
          channelId: senderId,
          userId: senderId,
          text: row.text,
          attachments: [],
          timestamp: new Date(row.date / 1_000_000_000 + 978_307_200_000),
          raw: { rowId: row.ROWID, handleId: row.handle_id },
        };
        messageHandler(channelMessage).catch((error: unknown) => {
          const errMsg = error instanceof Error ? error.message : String(error);
          log.error({ senderId, error: errMsg }, 'Message handler threw an error');
        });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error({ error: errMsg }, 'Failed to poll iMessage database');
    }
  }

  /** Set lastSeenRowId so only new messages after connect are processed. */
  function initializeLastSeenRowId(): void {
    if (!chatDb) return;
    try {
      const row = chatDb.prepare(
        'SELECT MAX(ROWID) AS maxId FROM message',
      ).get() as { maxId: number | null } | undefined;
      lastSeenRowId = row?.maxId ?? 0;
      log.debug({ lastSeenRowId }, 'Initialized last seen ROWID');
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.warn({ error: errMsg }, 'Failed to get max ROWID; starting from 0');
      lastSeenRowId = 0;
    }
  }

  const adapter: ChannelAdapter = {
    name: 'iMessage',
    type: 'imessage' as ChannelType,

    /**
     * Connect the iMessage adapter. On non-macOS, logs a warning and returns.
     * @param config - Channel configuration with optional allowFrom filter.
     */
    async connect(config: ChannelConfig): Promise<void> {
      if (!isMacOS()) {
        log.warn('iMessage adapter is only supported on macOS; skipping connect');
        return;
      }
      allowFromList = config.allowFrom ?? [];
      chatDb = openChatDb();
      if (!chatDb) {
        log.warn('Could not open iMessage database; adapter will not receive messages');
      } else {
        initializeLastSeenRowId();
      }
      connected = true;
      pollTimer = setInterval(pollNewMessages, POLL_INTERVAL_MS);
      log.info('iMessage adapter connected');
    },

    /** Register the message handler callback for inbound messages. */
    onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
      messageHandler = handler;
      log.debug('Message handler registered');
    },

    /**
     * Send a message via iMessage using AppleScript.
     * @param channelId - The recipient phone number or email address.
     * @param text - The message text to send.
     * @param _options - Optional send configuration (unused for iMessage).
     */
    async send(channelId: string, text: string, _options?: SendOptions): Promise<void> {
      if (!isMacOS()) {
        log.warn('Cannot send iMessage on non-macOS platform');
        return;
      }
      try {
        const script = buildSendAppleScript(channelId, text);
        await execFileAsync('osascript', ['-e', script]);
        log.debug({ channelId }, 'iMessage sent');
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.error({ channelId, error: errMsg }, 'Failed to send iMessage');
      }
    },

    /** Disconnect the iMessage adapter. Stops polling and closes the database. */
    async disconnect(): Promise<void> {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      if (chatDb) {
        try { chatDb.close(); } catch { /* ignore close errors */ }
        chatDb = undefined;
      }
      messageHandler = undefined;
      connected = false;
      allowFromList = [];
      log.info('iMessage adapter disconnected');
    },

    /** Check whether the adapter is currently connected. */
    isConnected(): boolean {
      return connected;
    },
  };

  return adapter;
}
