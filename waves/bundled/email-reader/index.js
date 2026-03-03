/**
 * Email reader wave — deterministic entry point.
 * Reads and searches Gmail emails using the Gmail API via centralized OAuth.
 *
 * This is a deterministic wave: only 1 LLM call (parameter extraction)
 * is made by the wave executor. The execute() function uses pure API calls.
 */

import { z } from 'zod';

/** Gmail API base URL. */
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Zod schema for extracted email reading parameters. */
const EmailReadParamsSchema = z.object({
  action: z.enum(['list', 'search']).default('list'),
  maxResults: z.number().min(1).max(50).default(10),
  query: z.string().optional(),
  unreadOnly: z.boolean().default(false),
});

/**
 * Plan an email read action by interpreting extracted parameters.
 *
 * @param {string} userInput - The raw user message.
 * @param {Record<string, unknown>} _context - Additional context (unused).
 * @returns {Promise<import('../../../src/types/index.js').WavePlan>}
 */
export async function plan(userInput, _context) {
  const lowerInput = userInput.toLowerCase();
  let inferredAction = 'list';
  let unreadOnly = false;

  if (lowerInput.includes('search') || lowerInput.includes('find') || lowerInput.includes('from')) {
    inferredAction = 'search';
  }

  if (lowerInput.includes('unread') || lowerInput.includes('new')) {
    unreadOnly = true;
  }

  return {
    steps: [
      {
        type: 'api_call',
        description: `Gmail ${inferredAction} operation`,
        params: { action: inferredAction, unreadOnly },
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: { action: inferredAction, unreadOnly, rawInput: userInput },
  };
}

/**
 * Execute an email read action by calling the Gmail API.
 *
 * @param {import('../../../src/types/index.js').WavePlan} wavePlan - The plan with extractedParams.
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
export async function execute(wavePlan) {
  try {
    const params = EmailReadParamsSchema.safeParse(wavePlan.extractedParams);

    if (!params.success) {
      return {
        success: false,
        output: 'Invalid email parameters',
        error: params.error.issues.map((issue) => issue.message).join(', '),
      };
    }

    const extractedParams = params.data;

    // Get OAuth access token via injected deps
    const deps = wavePlan.extractedParams._deps;
    if (!deps || !deps.getAccessToken) {
      return {
        success: false,
        output: 'Gmail requires OAuth setup. Please connect your Google account first via Settings > Integrations.',
        error: 'Missing OAuth dependencies',
      };
    }

    const accessToken = await deps.getAccessToken('google');
    if (!accessToken) {
      return {
        success: false,
        output: 'No Gmail access token available. Please connect your Google account first.',
        error: 'No OAuth token',
      };
    }

    return await listEmails(accessToken, extractedParams);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: `Email operation failed: ${message}`,
      error: message,
    };
  }
}

/**
 * Validate the result of an email API call.
 *
 * @param {import('../../../src/types/index.js').ToolResult} result - The result to validate.
 * @returns {Promise<{ valid: boolean; feedback?: string }>}
 */
export async function validate(result) {
  if (!result) {
    return { valid: false, feedback: 'No result returned from email operation' };
  }

  if (!result.success && result.error) {
    return { valid: false, feedback: result.error };
  }

  if (result.success && (!result.output || result.output.length === 0)) {
    return { valid: false, feedback: 'Email operation returned empty output' };
  }

  return { valid: true };
}

// ─── Internal API Helpers ──────────────────────────────────────────────

/**
 * Extract a header value from Gmail message headers.
 *
 * @param {Array<{name: string, value: string}>} headers - The message headers.
 * @param {string} name - The header name to find.
 * @returns {string} The header value, or empty string.
 */
function getHeader(headers, name) {
  if (!headers) return '';
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value ?? '';
}

/**
 * List emails from Gmail.
 *
 * @param {string} accessToken - OAuth2 access token.
 * @param {{ maxResults: number; query?: string; unreadOnly: boolean }} params - List parameters.
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
async function listEmails(accessToken, params) {
  const queryParams = new URLSearchParams({
    maxResults: String(params.maxResults),
  });

  const queryParts = [];
  if (params.query) queryParts.push(params.query);
  if (params.unreadOnly) queryParts.push('is:unread');
  if (queryParts.length > 0) {
    queryParams.set('q', queryParts.join(' '));
  }

  const listResponse = await fetch(
    `${GMAIL_API_BASE}/messages?${queryParams.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!listResponse.ok) {
    const errorText = await listResponse.text();
    return {
      success: false,
      output: `Failed to list emails (${listResponse.status})`,
      error: errorText,
    };
  }

  const listData = await listResponse.json();
  const messageIds = listData.messages ?? [];

  if (messageIds.length === 0) {
    const qualifier = params.unreadOnly ? 'unread ' : '';
    return {
      success: true,
      output: `No ${qualifier}emails found${params.query ? ` matching "${params.query}"` : ''}.`,
      metadata: { emailCount: 0 },
    };
  }

  // Fetch metadata for each message
  const emails = [];
  for (const msg of messageIds) {
    const detailResponse = await fetch(
      `${GMAIL_API_BASE}/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!detailResponse.ok) continue;

    const detail = await detailResponse.json();
    const headers = detail.payload?.headers;

    emails.push({
      from: getHeader(headers, 'From'),
      subject: getHeader(headers, 'Subject'),
      date: getHeader(headers, 'Date'),
      snippet: detail.snippet,
      isUnread: detail.labelIds?.includes('UNREAD') ?? false,
    });
  }

  const unreadCount = emails.filter((e) => e.isUnread).length;

  const emailLines = emails.map((email, index) => {
    const unreadTag = email.isUnread ? ' 🔵' : '';
    return `${index + 1}. ${email.subject || '(no subject)'}${unreadTag}\n   From: ${email.from}\n   Date: ${email.date}\n   ${email.snippet}`;
  });

  const summary = params.unreadOnly
    ? `Found ${emails.length} unread email(s):`
    : `Found ${emails.length} email(s) (${unreadCount} unread):`;

  return {
    success: true,
    output: `${summary}\n\n${emailLines.join('\n\n')}`,
    metadata: { emailCount: emails.length, unreadCount, emails },
  };
}
