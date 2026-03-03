/**
 * Email sender wave — deterministic entry point.
 * Composes and sends emails via the Gmail API using centralized OAuth.
 *
 * This is a deterministic wave: only 1 LLM call (parameter extraction)
 * is made by the wave executor. The execute() function uses pure API calls.
 *
 * Safety tier: "create" — requires user approval at security level 3+.
 */

import { z } from 'zod';

/** Gmail API base URL. */
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Zod schema for extracted email sending parameters. */
const EmailSendParamsSchema = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
});

/**
 * Plan an email send action by interpreting extracted parameters.
 *
 * @param {string} userInput - The raw user message.
 * @param {Record<string, unknown>} _context - Additional context (unused).
 * @returns {Promise<import('../../../src/types/index.js').WavePlan>}
 */
export async function plan(userInput, _context) {
  return {
    steps: [
      {
        type: 'api_call',
        description: 'Send email via Gmail',
        params: {},
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: { rawInput: userInput },
  };
}

/**
 * Execute the email send by calling the Gmail API.
 *
 * @param {import('../../../src/types/index.js').WavePlan} wavePlan - The plan with extractedParams.
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
export async function execute(wavePlan) {
  try {
    const params = EmailSendParamsSchema.safeParse(wavePlan.extractedParams);

    if (!params.success) {
      return {
        success: false,
        output: 'Missing required email fields. I need: to (recipient), subject, and body.',
        error: params.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', '),
      };
    }

    const emailParams = params.data;

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

    return await sendEmail(accessToken, emailParams);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: `Email send failed: ${message}`,
      error: message,
    };
  }
}

/**
 * Validate the result of sending an email.
 *
 * @param {import('../../../src/types/index.js').ToolResult} result - The result to validate.
 * @returns {Promise<{ valid: boolean; feedback?: string }>}
 */
export async function validate(result) {
  if (!result) {
    return { valid: false, feedback: 'No result returned from email send' };
  }

  if (!result.success && result.error) {
    return { valid: false, feedback: result.error };
  }

  return { valid: true };
}

// ─── Internal ──────────────────────────────────────────────────────────

/**
 * Build a raw RFC 2822 message for sending via Gmail API.
 *
 * @param {{ to: string; subject: string; body: string; cc?: string; bcc?: string }} params
 * @returns {string} Base64url-encoded raw message.
 */
function buildRawMessage(params) {
  const lines = [];
  lines.push(`To: ${params.to}`);
  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  lines.push(`Subject: ${params.subject}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('MIME-Version: 1.0');
  lines.push('');
  lines.push(params.body);

  const rawMessage = lines.join('\r\n');
  // Use Buffer for base64url encoding (Node.js built-in)
  return Buffer.from(rawMessage).toString('base64url');
}

/**
 * Send an email via Gmail API.
 *
 * @param {string} accessToken - OAuth2 access token.
 * @param {{ to: string; subject: string; body: string; cc?: string; bcc?: string }} params
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
async function sendEmail(accessToken, params) {
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
    return {
      success: false,
      output: `Failed to send email (${response.status})`,
      error: errorText,
    };
  }

  const result = await response.json();

  return {
    success: true,
    output: `Email sent successfully to ${params.to}.\nSubject: ${params.subject}\nMessage ID: ${result.id}`,
    metadata: { messageId: result.id, to: params.to, subject: params.subject },
  };
}
