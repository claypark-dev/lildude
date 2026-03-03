/**
 * Contact activity metrics.
 * Aggregates per-contact interaction data from multiple tables
 * for the activity dashboard.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { persistenceLogger } from '../utils/logger.js';

/** Aggregated activity metrics for a single contact. */
export interface ContactActivity {
  contactId: string;
  messageCount: number;
  lastMessageAt: Date | null;
  totalSpendUsd: number;
  wavesTriggered: number;
  wavesBlocked: number;
  meetingRequests: number;
  relayedMessages: number;
  rateLimitEvents: number;
}

/** Summary of recent external activity across all contacts. */
export interface ExternalActivitySummary {
  totalExternalMessages: number;
  unreadMessages: number;
  pendingMeetingRequests: number;
  recentEvents: ExternalActivityEvent[];
}

/** A single external activity event for the dashboard. */
export interface ExternalActivityEvent {
  contactId: string;
  contactName: string;
  eventType: string;
  detail: string | null;
  createdAt: Date;
}

/**
 * Get aggregated activity metrics for a specific contact.
 * Queries conversations, token_usage, external_audit, relayed_messages, and meeting_requests.
 * @param db - The better-sqlite3 Database instance.
 * @param contactId - The contact ID.
 * @returns The contact's activity metrics.
 */
export function getContactActivity(
  db: BetterSqlite3.Database,
  contactId: string,
): ContactActivity {
  const activity: ContactActivity = {
    contactId,
    messageCount: 0,
    lastMessageAt: null,
    totalSpendUsd: 0,
    wavesTriggered: 0,
    wavesBlocked: 0,
    meetingRequests: 0,
    relayedMessages: 0,
    rateLimitEvents: 0,
  };

  // Count conversations and find last message
  try {
    const conversationStats = db.prepare(
      `SELECT COUNT(*) AS msg_count,
              MAX(updated_at) AS last_msg
       FROM conversations
       WHERE contact_id = ?`,
    ).get(contactId) as { msg_count: number; last_msg: string | null };
    activity.messageCount = conversationStats.msg_count;
    activity.lastMessageAt = conversationStats.last_msg ? new Date(conversationStats.last_msg) : null;
  } catch (error: unknown) {
    persistenceLogger.debug({ contactId, error }, 'Failed to query conversation stats');
  }

  // Total spend from token_usage via conversations → tasks
  try {
    const spendStats = db.prepare(
      `SELECT COALESCE(SUM(tu.cost_usd), 0) AS total_spend
       FROM token_usage tu
       INNER JOIN conversations c ON tu.task_id = c.task_id
       WHERE c.contact_id = ? AND c.task_id IS NOT NULL`,
    ).get(contactId) as { total_spend: number };
    activity.totalSpendUsd = spendStats.total_spend;
  } catch (error: unknown) {
    persistenceLogger.debug({ contactId, error }, 'Failed to query spend stats');
  }

  // Waves triggered and blocked from external_audit
  try {
    const wavesTriggered = db.prepare(
      `SELECT COUNT(*) AS count FROM external_audit
       WHERE contact_id = ? AND event_type = 'wave_triggered'`,
    ).get(contactId) as { count: number };
    activity.wavesTriggered = wavesTriggered.count;

    const wavesBlocked = db.prepare(
      `SELECT COUNT(*) AS count FROM external_audit
       WHERE contact_id = ? AND event_type = 'wave_blocked'`,
    ).get(contactId) as { count: number };
    activity.wavesBlocked = wavesBlocked.count;

    const rateLimitCount = db.prepare(
      `SELECT COUNT(*) AS count FROM external_audit
       WHERE contact_id = ? AND event_type = 'rate_limited'`,
    ).get(contactId) as { count: number };
    activity.rateLimitEvents = rateLimitCount.count;
  } catch (error: unknown) {
    persistenceLogger.debug({ contactId, error }, 'Failed to query audit stats');
  }

  // Meeting requests count
  try {
    const meetingCount = db.prepare(
      `SELECT COUNT(*) AS count FROM meeting_requests
       WHERE contact_id = ?`,
    ).get(contactId) as { count: number };
    activity.meetingRequests = meetingCount.count;
  } catch (error: unknown) {
    persistenceLogger.debug({ contactId, error }, 'Failed to query meeting requests');
  }

  // Relayed messages count
  try {
    const relayedCount = db.prepare(
      `SELECT COUNT(*) AS count FROM relayed_messages
       WHERE contact_id = ?`,
    ).get(contactId) as { count: number };
    activity.relayedMessages = relayedCount.count;
  } catch (error: unknown) {
    persistenceLogger.debug({ contactId, error }, 'Failed to query relayed messages');
  }

  return activity;
}

/**
 * Get a summary of recent external activity across all contacts.
 * Powers the Dashboard "External Activity" widget.
 * @param db - The better-sqlite3 Database instance.
 * @param limit - Maximum number of recent events (default: 20).
 * @returns The external activity summary.
 */
export function getExternalActivitySummary(
  db: BetterSqlite3.Database,
  limit: number = 20,
): ExternalActivitySummary {
  try {
    // Total external messages (conversations with contact_id set)
    const totalMessages = db.prepare(
      `SELECT COUNT(*) AS count FROM conversations
       WHERE contact_id IS NOT NULL AND contact_id != ''`,
    ).get() as { count: number };

    // Unread relayed messages
    const unreadMessages = db.prepare(
      `SELECT COUNT(*) AS count FROM relayed_messages
       WHERE status = 'unread'`,
    ).get() as { count: number };

    // Pending meeting requests
    const pendingMeetings = db.prepare(
      `SELECT COUNT(*) AS count FROM meeting_requests
       WHERE status = 'pending'`,
    ).get() as { count: number };

    // Recent events with contact names
    const recentEvents = db.prepare(
      `SELECT ea.contact_id, c.name AS contact_name,
              ea.event_type, ea.detail, ea.created_at
       FROM external_audit ea
       LEFT JOIN contacts c ON ea.contact_id = c.id
       ORDER BY ea.id DESC
       LIMIT ?`,
    ).all(limit) as Array<{
      contact_id: string;
      contact_name: string | null;
      event_type: string;
      detail: string | null;
      created_at: string;
    }>;

    return {
      totalExternalMessages: totalMessages.count,
      unreadMessages: unreadMessages.count,
      pendingMeetingRequests: pendingMeetings.count,
      recentEvents: recentEvents.map((row) => ({
        contactId: row.contact_id,
        contactName: row.contact_name ?? 'Unknown',
        eventType: row.event_type,
        detail: row.detail,
        createdAt: new Date(row.created_at),
      })),
    };
  } catch (error: unknown) {
    persistenceLogger.error({ error }, 'Failed to get external activity summary');
    return {
      totalExternalMessages: 0,
      unreadMessages: 0,
      pendingMeetingRequests: 0,
      recentEvents: [],
    };
  }
}

/**
 * Get activity metrics for multiple contacts at once.
 * More efficient than calling getContactActivity() in a loop.
 * @param db - The better-sqlite3 Database instance.
 * @param contactIds - Array of contact IDs.
 * @returns A map of contactId to ContactActivity.
 */
export function getContactActivities(
  db: BetterSqlite3.Database,
  contactIds: string[],
): Map<string, ContactActivity> {
  const result = new Map<string, ContactActivity>();
  for (const contactId of contactIds) {
    result.set(contactId, getContactActivity(db, contactId));
  }
  return result;
}
