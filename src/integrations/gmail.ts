/**
 * Gmail API wrapper — S3.N.1
 *
 * Wraps the Gmail REST API (v1) for reading and sending email.
 * Uses the centralized OAuth2 system from Sprint 2 for authentication.
 *
 * All API calls go through `fetch()` with domain validation enforced
 * by the wave permissions system (`www.googleapis.com`).
 */

import { z } from 'zod';
import type BetterSqlite3 from 'better-sqlite3';
import { getValidAccessToken, type OAuthProviderConfig } from './oauth.js';
import { createModuleLogger } from '../utils/logger.js';

const gmailLogger = createModuleLogger('gmail');

/** Gmail API base URL. */
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Schema for email list parameters. */
export const EmailListParamsSchema = z.object({
  maxResults: z.number().min(1).max(100).default(20),
  query: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  unreadOnly: z.boolean().default(false),
});

/** Schema for sending email. */
export const EmailSendParamsSchema = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
});

/** Parsed email summary for display. */
export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
  labels: string[];
}

/** Gmail API message list response shape. */
interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  resultSizeEstimate?: number;
  nextPageToken?: string;
}

/** Gmail API message detail response shape. */
interface GmailMessageResponse {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
  internalDate?: string;
}

/**
 * Extract a header value from a Gmail message's payload headers.
 *
 * @param headers - The array of headers from the message payload.
 * @param name - The header name to find (case-insensitive).
 * @returns The header value, or an empty string if not found.
 */
function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  if (!headers) return '';
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value ?? '';
}

/**
 * Build a raw RFC 2822 message for sending via Gmail.
 *
 * @param params - The email parameters (to, subject, body, etc.).
 * @returns A base64url-encoded raw message string.
 */
function buildRawMessage(params: z.infer<typeof EmailSendParamsSchema>): string {
  const lines: string[] = [];
  lines.push(`To: ${params.to}`);
  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  lines.push(`Subject: ${params.subject}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('MIME-Version: 1.0');
  lines.push('');
  lines.push(params.body);

  const rawMessage = lines.join('\r\n');
  return Buffer.from(rawMessage).toString('base64url');
}

/**
 * List emails from the user's Gmail inbox.
 *
 * @param accessToken - A valid OAuth2 access token.
 * @param params - List parameters (maxResults, query, labelIds, unreadOnly).
 * @returns An array of email summaries, or an error result.
 */
export async function listEmails(
  accessToken: string,
  params: z.infer<typeof EmailListParamsSchema>,
): Promise<{ success: boolean; emails?: EmailSummary[]; error?: string }> {
  try {
    const queryParams = new URLSearchParams({
      maxResults: String(params.maxResults),
    });

    if (params.query) {
      queryParams.set('q', params.query);
    }

    if (params.unreadOnly) {
      queryParams.set('q', [params.query ?? '', 'is:unread'].filter(Boolean).join(' '));
    }

    if (params.labelIds && params.labelIds.length > 0) {
      for (const labelId of params.labelIds) {
        queryParams.append('labelIds', labelId);
      }
    }

    const listResponse = await fetch(
      `${GMAIL_API_BASE}/messages?${queryParams.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      gmailLogger.error({ status: listResponse.status, error: errorText }, 'Failed to list messages');
      return { success: false, error: `Gmail API error (${listResponse.status}): ${errorText}` };
    }

    const listData = await listResponse.json() as GmailListResponse;
    const messageIds = listData.messages ?? [];

    if (messageIds.length === 0) {
      return { success: true, emails: [] };
    }

    // Fetch details for each message (batch would be better but keeping simple)
    const emails: EmailSummary[] = [];
    for (const msg of messageIds.slice(0, params.maxResults)) {
      const detailResponse = await fetch(
        `${GMAIL_API_BASE}/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      if (!detailResponse.ok) {
        gmailLogger.warn({ messageId: msg.id }, 'Failed to fetch message details, skipping');
        continue;
      }

      const detail = await detailResponse.json() as GmailMessageResponse;
      const headers = detail.payload?.headers;

      emails.push({
        id: detail.id,
        threadId: detail.threadId,
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),
        subject: getHeader(headers, 'Subject'),
        snippet: detail.snippet,
        date: getHeader(headers, 'Date'),
        isUnread: detail.labelIds?.includes('UNREAD') ?? false,
        labels: detail.labelIds ?? [],
      });
    }

    gmailLogger.info({ count: emails.length }, 'Emails listed');
    return { success: true, emails };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    gmailLogger.error({ error: message }, 'Failed to list emails');
    return { success: false, error: message };
  }
}

/**
 * Send an email via Gmail API.
 *
 * @param accessToken - A valid OAuth2 access token.
 * @param params - The email parameters (to, subject, body, etc.).
 * @returns Success/failure with message ID on success.
 */
export async function sendEmail(
  accessToken: string,
  params: z.infer<typeof EmailSendParamsSchema>,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const raw = buildRawMessage(params);

    const response = await fetch(
      `${GMAIL_API_BASE}/messages/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      gmailLogger.error({ status: response.status, error: errorText }, 'Failed to send email');
      return { success: false, error: `Gmail API error (${response.status}): ${errorText}` };
    }

    const result = await response.json() as { id: string };
    gmailLogger.info({ messageId: result.id }, 'Email sent');
    return { success: true, messageId: result.id };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    gmailLogger.error({ error: message }, 'Failed to send email');
    return { success: false, error: message };
  }
}

/**
 * Get an access token for Gmail using the centralized OAuth system.
 * Convenience wrapper that builds the provider config from integration settings.
 *
 * @param db - Database instance.
 * @param clientId - Google OAuth client ID.
 * @param clientSecret - Google OAuth client secret.
 * @param redirectUri - OAuth redirect URI.
 * @returns A valid access token string, or null.
 */
export async function getGmailAccessToken(
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
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    redirectUri,
  };

  return getValidAccessToken(db, providerConfig);
}
