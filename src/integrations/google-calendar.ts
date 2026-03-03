/**
 * Google Calendar API wrapper — S3.N.2
 *
 * Wraps the Google Calendar REST API (v3) for listing, creating, and
 * deleting events. Uses the centralized OAuth2 system from Sprint 2.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { getValidAccessToken, type OAuthProviderConfig } from './oauth.js';
import { createModuleLogger } from '../utils/logger.js';

const calendarLogger = createModuleLogger('google-calendar');

/** Google Calendar API base URL. */
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

/** Parsed calendar event for display. */
export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  htmlLink?: string;
}

/**
 * List calendar events within a date range.
 *
 * @param accessToken - A valid OAuth2 access token.
 * @param timeMin - Start of range (ISO string). Defaults to now.
 * @param timeMax - End of range (ISO string). Defaults to 7 days from now.
 * @param maxResults - Maximum events to return. Defaults to 50.
 * @returns An array of calendar events or error.
 */
export async function listEvents(
  accessToken: string,
  timeMin?: string,
  timeMax?: string,
  maxResults: number = 50,
): Promise<{ success: boolean; events?: CalendarEvent[]; error?: string }> {
  try {
    const now = new Date();
    const queryParams = new URLSearchParams({
      timeMin: timeMin ?? now.toISOString(),
      timeMax: timeMax ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(maxResults),
    });

    const response = await fetch(
      `${CALENDAR_API_BASE}/calendars/primary/events?${queryParams.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      calendarLogger.error({ status: response.status }, 'Failed to list events');
      return { success: false, error: `Calendar API error (${response.status}): ${errorText}` };
    }

    const data = await response.json() as { items?: Array<Record<string, unknown>> };
    const items = data.items ?? [];

    const events: CalendarEvent[] = items.map((item) => ({
      id: String(item.id ?? ''),
      summary: String(item.summary ?? '(no title)'),
      start: String((item.start as Record<string, unknown>)?.dateTime ?? (item.start as Record<string, unknown>)?.date ?? 'unknown'),
      end: String((item.end as Record<string, unknown>)?.dateTime ?? (item.end as Record<string, unknown>)?.date ?? 'unknown'),
      location: item.location ? String(item.location) : undefined,
      description: item.description ? String(item.description) : undefined,
      htmlLink: item.htmlLink ? String(item.htmlLink) : undefined,
    }));

    calendarLogger.info({ count: events.length }, 'Events listed');
    return { success: true, events };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    calendarLogger.error({ error: message }, 'Failed to list events');
    return { success: false, error: message };
  }
}

/**
 * Create a new calendar event.
 *
 * @param accessToken - A valid OAuth2 access token.
 * @param title - Event title/summary.
 * @param startDateTime - Start time (ISO string).
 * @param endDateTime - End time (ISO string).
 * @param description - Optional event description.
 * @param location - Optional event location.
 * @returns The created event or error.
 */
export async function createEvent(
  accessToken: string,
  title: string,
  startDateTime: string,
  endDateTime: string,
  description?: string,
  location?: string,
): Promise<{ success: boolean; event?: CalendarEvent; error?: string }> {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const eventBody: Record<string, unknown> = {
      summary: title,
      start: { dateTime: startDateTime, timeZone: timezone },
      end: { dateTime: endDateTime, timeZone: timezone },
    };

    if (description) eventBody.description = description;
    if (location) eventBody.location = location;

    const response = await fetch(
      `${CALENDAR_API_BASE}/calendars/primary/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      calendarLogger.error({ status: response.status }, 'Failed to create event');
      return { success: false, error: `Calendar API error (${response.status}): ${errorText}` };
    }

    const created = await response.json() as Record<string, unknown>;

    const event: CalendarEvent = {
      id: String(created.id ?? ''),
      summary: String(created.summary ?? title),
      start: startDateTime,
      end: endDateTime,
      htmlLink: created.htmlLink ? String(created.htmlLink) : undefined,
    };

    calendarLogger.info({ eventId: event.id }, 'Event created');
    return { success: true, event };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    calendarLogger.error({ error: message }, 'Failed to create event');
    return { success: false, error: message };
  }
}

/**
 * Delete a calendar event by ID.
 *
 * @param accessToken - A valid OAuth2 access token.
 * @param eventId - The event ID to delete.
 * @returns Success/failure.
 */
export async function deleteEvent(
  accessToken: string,
  eventId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${CALENDAR_API_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      calendarLogger.error({ status: response.status, eventId }, 'Failed to delete event');
      return { success: false, error: `Calendar API error (${response.status}): ${errorText}` };
    }

    calendarLogger.info({ eventId }, 'Event deleted');
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    calendarLogger.error({ error: message }, 'Failed to delete event');
    return { success: false, error: message };
  }
}

/**
 * Get an access token for Google Calendar using the centralized OAuth system.
 *
 * @param db - Database instance.
 * @param clientId - Google OAuth client ID.
 * @param clientSecret - Google OAuth client secret.
 * @param redirectUri - OAuth redirect URI.
 * @returns A valid access token string, or null.
 */
export async function getCalendarAccessToken(
  db: BetterSqlite3.Database,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<string | null> {
  const providerConfig: OAuthProviderConfig = {
    name: 'google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId,
    clientSecret,
    defaultScopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    redirectUri,
  };

  return getValidAccessToken(db, providerConfig);
}
