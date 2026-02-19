/**
 * Google Calendar skill — deterministic entry point.
 * Exports plan(), execute(), and validate() for the skill loader.
 *
 * Plan: Extracts calendar action and parameters from the user message.
 * Execute: Calls Google Calendar API based on the extracted action.
 * Validate: Verifies the API response is structurally valid.
 *
 * This is a deterministic skill: only 1 LLM call (parameter extraction)
 * is made by the skill executor. The execute() function uses pure API calls.
 */

import { z } from 'zod';
import { getTokens, isTokenExpired, refreshToken, storeTokens } from './oauth.js';

/** Google Calendar API base URL. */
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

/** Zod schema for extracted calendar parameters. */
const CalendarParamsSchema = z.object({
  action: z.enum(['list', 'create', 'delete']).default('list'),
  title: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  duration: z.number().default(60),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  eventId: z.string().optional(),
});

/**
 * Plan a calendar action by interpreting extracted parameters.
 * The skill executor handles LLM-based parameter extraction and passes
 * the result here via the plan's extractedParams.
 *
 * This function builds a deterministic SkillPlan from extracted params.
 *
 * @param {string} userInput - The raw user message.
 * @param {Record<string, unknown>} context - Additional context (unused for deterministic skills).
 * @returns {Promise<import('../../../src/types/index.js').SkillPlan>}
 */
export async function plan(userInput, context) {
  // Infer action from user input deterministically when possible
  const lowerInput = userInput.toLowerCase();
  let inferredAction = 'list';

  if (
    lowerInput.includes('add') ||
    lowerInput.includes('create') ||
    lowerInput.includes('schedule') ||
    lowerInput.includes('set up') ||
    lowerInput.includes('book')
  ) {
    inferredAction = 'create';
  } else if (
    lowerInput.includes('delete') ||
    lowerInput.includes('remove') ||
    lowerInput.includes('cancel')
  ) {
    inferredAction = 'delete';
  }

  return {
    steps: [
      {
        type: 'api_call',
        description: `Google Calendar ${inferredAction} operation`,
        params: { action: inferredAction },
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: { action: inferredAction, rawInput: userInput, context },
  };
}

/**
 * Execute a calendar action by calling the Google Calendar API.
 * Retrieves stored OAuth tokens, refreshes if expired, and makes the API call.
 *
 * @param {import('../../../src/types/index.js').SkillPlan} skillPlan - The plan containing extractedParams.
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
export async function execute(skillPlan) {
  try {
    const params = CalendarParamsSchema.safeParse(skillPlan.extractedParams);

    if (!params.success) {
      return {
        success: false,
        output: 'Invalid calendar parameters',
        error: params.error.issues.map((issue) => issue.message).join(', '),
      };
    }

    const extractedParams = params.data;

    // Check for required dependencies injected via plan context
    const deps = skillPlan.extractedParams._deps;
    if (!deps) {
      return {
        success: false,
        output: 'Google Calendar requires OAuth setup. Please run the OAuth flow first.',
        error: 'Missing OAuth dependencies',
      };
    }

    const { db, encryptionSecret, cryptoUtils, knowledgeStore, clientId, clientSecret } = deps;

    // Get stored tokens
    let tokens = getTokens(db, encryptionSecret, cryptoUtils, knowledgeStore);

    if (!tokens) {
      return {
        success: false,
        output: 'No Google Calendar OAuth tokens found. Please authorize the skill first.',
        error: 'No OAuth tokens',
      };
    }

    // Refresh tokens if expired
    if (isTokenExpired(tokens)) {
      try {
        tokens = await refreshToken(tokens.refreshToken, clientId, clientSecret);
        storeTokens(db, tokens, encryptionSecret, cryptoUtils, knowledgeStore);
      } catch (refreshError) {
        const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
        return {
          success: false,
          output: 'Failed to refresh Google Calendar access token. Please re-authorize.',
          error: message,
        };
      }
    }

    const accessToken = tokens.accessToken;

    switch (extractedParams.action) {
      case 'list':
        return await listEvents(accessToken, extractedParams);
      case 'create':
        return await createEvent(accessToken, extractedParams);
      case 'delete':
        return await deleteEvent(accessToken, extractedParams);
      default:
        return {
          success: false,
          output: `Unknown calendar action: ${String(extractedParams.action)}`,
          error: 'Unknown action',
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: `Calendar operation failed: ${message}`,
      error: message,
    };
  }
}

/**
 * Validate the result of a calendar API call.
 * Checks that the result is structurally valid and the API returned expected data.
 *
 * @param {import('../../../src/types/index.js').ToolResult} result - The execution result to validate.
 * @returns {Promise<{ valid: boolean; feedback?: string }>}
 */
export async function validate(result) {
  if (!result) {
    return { valid: false, feedback: 'No result returned from calendar operation' };
  }

  if (!result.success && result.error) {
    return { valid: false, feedback: result.error };
  }

  if (result.success && (!result.output || result.output.length === 0)) {
    return { valid: false, feedback: 'Calendar operation returned empty output' };
  }

  return { valid: true };
}

// ─── Internal API Call Helpers ─────────────────────────────────────────────

/**
 * List calendar events within a date range.
 *
 * @param {string} accessToken - The OAuth2 access token.
 * @param {{ startDate?: string; endDate?: string }} params - Date range parameters.
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
async function listEvents(accessToken, params) {
  const now = new Date();
  const timeMin = params.startDate
    ? new Date(params.startDate).toISOString()
    : now.toISOString();
  const timeMax = params.endDate
    ? new Date(params.endDate).toISOString()
    : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const queryParams = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });

  const response = await fetch(
    `${CALENDAR_API_BASE}/calendars/primary/events?${queryParams.toString()}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    return {
      success: false,
      output: `Failed to list calendar events (${response.status})`,
      error: errorBody,
    };
  }

  const data = await response.json();
  const events = data.items ?? [];
  const eventCount = events.length;

  if (eventCount === 0) {
    return {
      success: true,
      output: 'No events found in the specified date range.',
      metadata: { eventCount: 0 },
    };
  }

  const eventSummaries = events.map((event) => {
    const start = event.start?.dateTime ?? event.start?.date ?? 'unknown';
    const end = event.end?.dateTime ?? event.end?.date ?? 'unknown';
    return `- ${event.summary ?? '(no title)'}: ${start} to ${end}`;
  });

  return {
    success: true,
    output: `Found ${eventCount} event(s):\n${eventSummaries.join('\n')}`,
    metadata: { eventCount, events },
  };
}

/**
 * Create a new calendar event.
 *
 * @param {string} accessToken - The OAuth2 access token.
 * @param {{ title?: string; date?: string; time?: string; duration?: number }} params - Event parameters.
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
async function createEvent(accessToken, params) {
  const title = params.title ?? 'New Event';
  const dateStr = params.date ?? new Date().toISOString().split('T')[0];
  const timeStr = params.time ?? '09:00';
  const durationMinutes = params.duration ?? 60;

  const startDateTime = new Date(`${dateStr}T${timeStr}:00`);
  const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);

  const eventBody = {
    summary: title,
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };

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
    const errorBody = await response.text();
    return {
      success: false,
      output: `Failed to create calendar event (${response.status})`,
      error: errorBody,
    };
  }

  const created = await response.json();

  return {
    success: true,
    output: `Created event "${created.summary}" on ${dateStr} at ${timeStr} for ${durationMinutes} minutes.`,
    metadata: { eventId: created.id, htmlLink: created.htmlLink },
  };
}

/**
 * Delete a calendar event by ID.
 *
 * @param {string} accessToken - The OAuth2 access token.
 * @param {{ eventId?: string }} params - The event ID to delete.
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
async function deleteEvent(accessToken, params) {
  if (!params.eventId) {
    return {
      success: false,
      output: 'Cannot delete event: no event ID provided.',
      error: 'Missing eventId',
    };
  }

  const response = await fetch(
    `${CALENDAR_API_BASE}/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    return {
      success: false,
      output: `Failed to delete calendar event (${response.status})`,
      error: errorBody,
    };
  }

  return {
    success: true,
    output: `Successfully deleted event ${params.eventId}.`,
    metadata: { deletedEventId: params.eventId },
  };
}
