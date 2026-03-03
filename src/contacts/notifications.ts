/**
 * Per-contact notification preferences.
 * Controls how and when the owner is notified about contact activity.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Valid digest frequencies for notification batching. */
export type DigestFrequency = 'realtime' | 'hourly' | 'daily' | 'weekly' | 'off';

/** Application-level notification preferences for a contact. */
export interface ContactNotificationPrefs {
  contactId: string;
  muteUntil: Date | null;
  notifyChannel: string | null;
  digestFrequency: DigestFrequency;
  notifyOnMessage: boolean;
  notifyOnWave: boolean;
  notifyOnMeeting: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for updating notification preferences. */
export interface UpdateNotificationPrefsInput {
  muteUntil?: Date | null;
  notifyChannel?: string | null;
  digestFrequency?: DigestFrequency;
  notifyOnMessage?: boolean;
  notifyOnWave?: boolean;
  notifyOnMeeting?: boolean;
}

/** Raw DB row shape. */
interface NotificationPrefsDbRow {
  contact_id: string;
  mute_until: string | null;
  notify_channel: string | null;
  digest_frequency: string;
  notify_on_message: number;
  notify_on_wave: number;
  notify_on_meeting: number;
  created_at: string;
  updated_at: string;
}

/**
 * Map a raw database row to the application-level ContactNotificationPrefs.
 * @param row - Raw SQLite row.
 * @returns A typed ContactNotificationPrefs object.
 */
function mapRow(row: NotificationPrefsDbRow): ContactNotificationPrefs {
  return {
    contactId: row.contact_id,
    muteUntil: row.mute_until ? new Date(row.mute_until) : null,
    notifyChannel: row.notify_channel,
    digestFrequency: row.digest_frequency as DigestFrequency,
    notifyOnMessage: row.notify_on_message === 1,
    notifyOnWave: row.notify_on_wave === 1,
    notifyOnMeeting: row.notify_on_meeting === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Default notification prefs for contacts without explicit settings. */
const DEFAULT_PREFS: Omit<ContactNotificationPrefs, 'contactId' | 'createdAt' | 'updatedAt'> = {
  muteUntil: null,
  notifyChannel: null,
  digestFrequency: 'realtime',
  notifyOnMessage: true,
  notifyOnWave: true,
  notifyOnMeeting: true,
};

/**
 * Get notification preferences for a contact.
 * Returns defaults if no explicit preferences have been set.
 * @param db - The better-sqlite3 Database instance.
 * @param contactId - The contact ID.
 * @returns The notification preferences.
 */
export function getNotificationPrefs(
  db: BetterSqlite3.Database,
  contactId: string,
): ContactNotificationPrefs {
  try {
    const row = db.prepare(
      'SELECT * FROM contact_notifications WHERE contact_id = ?',
    ).get(contactId) as NotificationPrefsDbRow | undefined;

    if (row) {
      return mapRow(row);
    }

    // Return defaults
    const now = new Date();
    return {
      contactId,
      ...DEFAULT_PREFS,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get notification preferences: ${message}`);
  }
}

/**
 * Update notification preferences for a contact.
 * Creates the row if it doesn't exist (upsert).
 * @param db - The better-sqlite3 Database instance.
 * @param contactId - The contact ID.
 * @param input - The fields to update.
 * @returns The updated ContactNotificationPrefs.
 */
export function updateNotificationPrefs(
  db: BetterSqlite3.Database,
  contactId: string,
  input: UpdateNotificationPrefsInput,
): ContactNotificationPrefs {
  try {
    const existing = db.prepare(
      'SELECT contact_id FROM contact_notifications WHERE contact_id = ?',
    ).get(contactId) as { contact_id: string } | undefined;

    if (!existing) {
      // Insert default row first
      db.prepare(
        `INSERT INTO contact_notifications (contact_id) VALUES (?)`,
      ).run(contactId);
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.muteUntil !== undefined) {
      fields.push('mute_until = ?');
      values.push(input.muteUntil ? input.muteUntil.toISOString() : null);
    }
    if (input.notifyChannel !== undefined) {
      fields.push('notify_channel = ?');
      values.push(input.notifyChannel);
    }
    if (input.digestFrequency !== undefined) {
      fields.push('digest_frequency = ?');
      values.push(input.digestFrequency);
    }
    if (input.notifyOnMessage !== undefined) {
      fields.push('notify_on_message = ?');
      values.push(input.notifyOnMessage ? 1 : 0);
    }
    if (input.notifyOnWave !== undefined) {
      fields.push('notify_on_wave = ?');
      values.push(input.notifyOnWave ? 1 : 0);
    }
    if (input.notifyOnMeeting !== undefined) {
      fields.push('notify_on_meeting = ?');
      values.push(input.notifyOnMeeting ? 1 : 0);
    }

    if (fields.length > 0) {
      fields.push('updated_at = datetime(\'now\')');
      values.push(contactId);
      db.prepare(
        `UPDATE contact_notifications SET ${fields.join(', ')} WHERE contact_id = ?`,
      ).run(...values);
    }

    persistenceLogger.debug({ contactId }, 'Notification preferences updated');
    return getNotificationPrefs(db, contactId);
  } catch (error: unknown) {
    if (error instanceof PersistenceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update notification preferences: ${message}`);
  }
}

/**
 * Delete notification preferences for a contact (resets to defaults).
 * @param db - The better-sqlite3 Database instance.
 * @param contactId - The contact ID.
 * @returns True if preferences were deleted.
 */
export function deleteNotificationPrefs(
  db: BetterSqlite3.Database,
  contactId: string,
): boolean {
  try {
    const result = db.prepare(
      'DELETE FROM contact_notifications WHERE contact_id = ?',
    ).run(contactId);
    return result.changes > 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to delete notification preferences: ${message}`);
  }
}

/**
 * Check if a contact is currently muted.
 * @param db - The better-sqlite3 Database instance.
 * @param contactId - The contact ID.
 * @returns True if the contact is muted (muteUntil is in the future).
 */
export function isContactMuted(
  db: BetterSqlite3.Database,
  contactId: string,
): boolean {
  try {
    const prefs = getNotificationPrefs(db, contactId);
    if (!prefs.muteUntil) return false;
    return prefs.muteUntil > new Date();
  } catch {
    return false;
  }
}

/**
 * Check if the owner should be notified about an event for a contact.
 * Checks mute status, digest frequency, and event-specific toggles.
 * @param db - The better-sqlite3 Database instance.
 * @param contactId - The contact ID.
 * @param eventType - The type of event ('message' | 'wave' | 'meeting').
 * @returns True if the owner should be notified immediately.
 */
export function shouldNotify(
  db: BetterSqlite3.Database,
  contactId: string,
  eventType: 'message' | 'wave' | 'meeting',
): boolean {
  try {
    const prefs = getNotificationPrefs(db, contactId);

    // Check mute status
    if (prefs.muteUntil && prefs.muteUntil > new Date()) {
      return false;
    }

    // Check digest frequency
    if (prefs.digestFrequency === 'off') {
      return false;
    }

    // Check event-specific toggles
    switch (eventType) {
      case 'message':
        return prefs.notifyOnMessage;
      case 'wave':
        return prefs.notifyOnWave;
      case 'meeting':
        return prefs.notifyOnMeeting;
      default:
        return true;
    }
  } catch {
    // Default to notify on error
    return true;
  }
}

/**
 * Get all contacts with non-default notification preferences.
 * @param db - The better-sqlite3 Database instance.
 * @returns An array of ContactNotificationPrefs.
 */
export function listCustomNotificationPrefs(
  db: BetterSqlite3.Database,
): ContactNotificationPrefs[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM contact_notifications ORDER BY contact_id',
    ).all() as NotificationPrefsDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list notification preferences: ${message}`);
  }
}
