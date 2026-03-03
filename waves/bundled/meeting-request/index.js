/**
 * Meeting Request Wave — create tier.
 * External users propose meeting times; creates an approval request for the owner.
 * On owner approval, a calendar event is created.
 * Deterministic execution (no LLM needed).
 */

/**
 * Parse a proposed meeting time from user input.
 * @param {string} input - The user's message.
 * @returns {{ proposedTime: string|null, duration: number, subject: string }} Extracted meeting details.
 */
function parseMeetingInput(input) {
  const result = {
    proposedTime: null,
    duration: 30,
    subject: 'Meeting',
    message: '',
  };

  // Extract duration
  const durationMatch = input.match(/(\d+)\s*(?:min|minute|hour|hr)/i);
  if (durationMatch) {
    const value = parseInt(durationMatch[1], 10);
    if (input.match(/hour|hr/i)) {
      result.duration = value * 60;
    } else {
      result.duration = value;
    }
  }

  // Extract date/time references
  const datePatterns = [
    /(?:on|at|for)\s+(\w+day)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    /(?:on|at|for)\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    /(?:tomorrow|today)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
  ];

  for (const pattern of datePatterns) {
    const match = input.match(pattern);
    if (match) {
      result.proposedTime = match[0].replace(/^(?:on|at|for)\s+/i, '').trim();
      break;
    }
  }

  // Extract subject (text after "about" or "regarding" or "to discuss")
  const subjectMatch = input.match(/(?:about|regarding|to discuss|re:)\s+(.+?)(?:\.|$)/i);
  if (subjectMatch) {
    result.subject = subjectMatch[1].trim().slice(0, 100);
  }

  // Message is the full input
  result.message = input.slice(0, 500);

  return result;
}

/**
 * Validate meeting request parameters.
 * @param {{ proposedTime: string|null, duration: number, subject: string }} params
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateRequest(params) {
  const issues = [];

  if (params.duration < 5) {
    issues.push('Meeting duration must be at least 5 minutes.');
  }
  if (params.duration > 480) {
    issues.push('Meeting duration cannot exceed 8 hours.');
  }
  if (!params.subject || params.subject.length === 0) {
    issues.push('A meeting subject is required.');
  }

  return { valid: issues.length === 0, issues };
}

export async function plan(userInput, _context) {
  const parsed = parseMeetingInput(userInput);

  return {
    steps: [
      {
        type: 'api_call',
        description: 'Create meeting approval request for owner',
        params: parsed,
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: parsed,
  };
}

export async function execute(wavePlan) {
  const { proposedTime, duration, subject, message } = wavePlan.extractedParams;

  try {
    const validation = validateRequest({ proposedTime, duration, subject });
    if (!validation.valid) {
      return {
        success: false,
        output: '',
        error: `Invalid meeting request: ${validation.issues.join(' ')}`,
      };
    }

    // Build the approval request
    const requestId = `mtg_${Date.now()}`;
    const request = {
      id: requestId,
      type: 'meeting_request',
      proposedTime: proposedTime || 'No specific time proposed',
      duration,
      subject,
      message: message || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const timeStr = proposedTime
      ? `Proposed time: ${proposedTime}`
      : 'No specific time proposed — the owner will suggest a time.';

    const output = [
      'Meeting request submitted for approval.',
      `Subject: ${subject}`,
      `Duration: ${duration} minutes`,
      timeStr,
      '',
      'The owner will review your request and respond.',
      `Request ID: ${requestId}`,
    ].join('\n');

    return {
      success: true,
      output,
      metadata: {
        waveId: 'meeting-request',
        requestId,
        approvalRequired: true,
        approvalRequest: request,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to create meeting request: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error || 'Meeting request failed' };
  }
  if (!result.metadata?.requestId) {
    return { valid: false, feedback: 'No request ID generated' };
  }
  return { valid: true };
}
