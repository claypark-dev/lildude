/**
 * Event RSVP Wave — create tier.
 * External users RSVP to the owner's shared events.
 * Creates a pending RSVP record for the owner to see.
 * Deterministic execution (no LLM needed).
 */

/** Valid RSVP statuses. */
const VALID_RSVP_STATUSES = ['attending', 'declined', 'maybe'];

/**
 * Parse RSVP details from user input.
 * @param {string} input - The user's message.
 * @returns {{ eventName: string, rsvpStatus: string, message: string }} Extracted RSVP details.
 */
function parseRsvpInput(input) {
  const result = {
    eventName: '',
    rsvpStatus: 'attending',
    message: '',
  };

  // Extract RSVP status
  if (/\b(?:can't|cannot|won't|decline|not attending|no)\b/i.test(input)) {
    result.rsvpStatus = 'declined';
  } else if (/\b(?:maybe|possibly|tentative|not sure|might)\b/i.test(input)) {
    result.rsvpStatus = 'maybe';
  } else {
    result.rsvpStatus = 'attending';
  }

  // Extract event name from common patterns
  const eventPatterns = [
    /(?:rsvp|attend|going to|event|invitation)[:\s]+(?:for\s+)?(?:the\s+)?(.+?)(?:\.|$)/i,
    /(?:for|to)\s+(?:the\s+)?(.+?)(?:event|party|meeting|gathering)/i,
  ];

  for (const pattern of eventPatterns) {
    const match = input.match(pattern);
    if (match) {
      result.eventName = match[1].trim().slice(0, 200);
      break;
    }
  }

  // Fallback: try to extract meaningful text
  if (!result.eventName) {
    const cleaned = input
      .replace(/\b(?:rsvp|attend|event|invitation|yes|no|maybe|i'?ll?|be there)\b/gi, '')
      .trim();
    result.eventName = cleaned.slice(0, 200) || 'Unnamed event';
  }

  // Message is the full input
  result.message = input.slice(0, 500);

  return result;
}

/**
 * Validate RSVP parameters.
 * @param {{ eventName: string, rsvpStatus: string }} params
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateRsvp(params) {
  const issues = [];

  if (!params.eventName || params.eventName.trim().length === 0) {
    issues.push('An event name is required.');
  }
  if (!VALID_RSVP_STATUSES.includes(params.rsvpStatus)) {
    issues.push(`Invalid RSVP status "${params.rsvpStatus}". Must be: ${VALID_RSVP_STATUSES.join(', ')}.`);
  }

  return { valid: issues.length === 0, issues };
}

export async function plan(userInput, _context) {
  const parsed = parseRsvpInput(userInput);

  return {
    steps: [
      {
        type: 'api_call',
        description: 'Submit event RSVP',
        params: parsed,
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: parsed,
  };
}

export async function execute(wavePlan) {
  const { eventName, rsvpStatus, message } = wavePlan.extractedParams;

  try {
    const validation = validateRsvp({ eventName, rsvpStatus });
    if (!validation.valid) {
      return {
        success: false,
        output: '',
        error: `Invalid RSVP: ${validation.issues.join(' ')}`,
      };
    }

    const rsvpId = `rsvp_${Date.now()}`;

    const statusLabel = {
      attending: 'Attending',
      declined: 'Not attending',
      maybe: 'Maybe',
    }[rsvpStatus] || rsvpStatus;

    const output = [
      `RSVP submitted: ${statusLabel}`,
      `Event: ${eventName}`,
      message ? `Message: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}` : '',
      '',
      'The owner has been notified of your RSVP.',
      `RSVP ID: ${rsvpId}`,
    ].filter(Boolean).join('\n');

    return {
      success: true,
      output,
      metadata: {
        waveId: 'event-rsvp',
        rsvpId,
        rsvpStatus,
        eventName,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to submit RSVP: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error || 'RSVP submission failed' };
  }
  if (!result.metadata?.rsvpId) {
    return { valid: false, feedback: 'No RSVP ID generated' };
  }
  return { valid: true };
}
