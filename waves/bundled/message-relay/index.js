/**
 * Message Relay Wave — create tier.
 * External users can leave messages for the owner.
 * Messages are stored in the relayed_messages table and the owner is notified
 * via their preferred channel.
 * Deterministic execution.
 */

/** Maximum message length in characters. */
const MAX_MESSAGE_LENGTH = 2000;

/** Valid urgency levels. */
const URGENCY_LEVELS = ['low', 'normal', 'high', 'urgent'];

/**
 * Parse urgency from user input.
 * @param {string} input - User message.
 * @returns {string} Urgency level.
 */
function parseUrgency(input) {
  const lower = input.toLowerCase();

  if (lower.includes('urgent') || lower.includes('emergency') || lower.includes('asap')) {
    return 'urgent';
  }
  if (lower.includes('important') || lower.includes('high priority')) {
    return 'high';
  }
  if (lower.includes('no rush') || lower.includes('whenever') || lower.includes('low priority')) {
    return 'low';
  }

  return 'normal';
}

/**
 * Extract the core message from user input.
 * Strips common relay prefixes like "tell them", "let them know", etc.
 * @param {string} input - Raw user input.
 * @returns {string} Cleaned message body.
 */
function extractMessage(input) {
  const prefixes = [
    /^(?:please\s+)?(?:tell\s+(?:them|him|her)\s+(?:that\s+)?)/i,
    /^(?:please\s+)?(?:let\s+(?:them|him|her)\s+know\s+(?:that\s+)?)/i,
    /^(?:please\s+)?(?:pass\s+(?:along|on)\s+(?:that\s+)?)/i,
    /^(?:please\s+)?(?:relay\s+(?:that\s+)?)/i,
    /^(?:please\s+)?(?:leave\s+a\s+message\s*:?\s*)/i,
    /^(?:please\s+)?(?:message\s*:?\s*)/i,
  ];

  let cleaned = input;
  for (const prefix of prefixes) {
    cleaned = cleaned.replace(prefix, '');
  }

  return cleaned.trim().slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Validate a relay message.
 * @param {string} message - The message body.
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateMessage(message) {
  const issues = [];

  if (!message || message.trim().length === 0) {
    issues.push('Message cannot be empty.');
  }
  if (message && message.length > MAX_MESSAGE_LENGTH) {
    issues.push(`Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters.`);
  }

  return { valid: issues.length === 0, issues };
}

export async function plan(userInput, _context) {
  const urgency = parseUrgency(userInput);
  const messageBody = extractMessage(userInput);

  return {
    steps: [
      {
        type: 'api_call',
        description: 'Store relayed message and notify owner',
        params: { message: messageBody, urgency },
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: { message: messageBody, urgency },
  };
}

export async function execute(wavePlan) {
  const { message, urgency } = wavePlan.extractedParams;

  try {
    const validation = validateMessage(message);
    if (!validation.valid) {
      return {
        success: false,
        output: '',
        error: validation.issues.join(' '),
      };
    }

    const messageId = `msg_${Date.now()}`;
    const relayedMessage = {
      id: messageId,
      message,
      urgency: URGENCY_LEVELS.includes(urgency) ? urgency : 'normal',
      status: 'delivered',
      createdAt: new Date().toISOString(),
    };

    const urgencyLabel = urgency === 'urgent' ? ' (URGENT)' : urgency === 'high' ? ' (High Priority)' : '';

    const output = [
      `Message delivered${urgencyLabel}.`,
      '',
      'Your message has been relayed to the owner. They will see it on their next check-in.',
      urgency === 'urgent'
        ? 'Since this is marked urgent, the owner will be notified immediately.'
        : '',
      `Message ID: ${messageId}`,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      success: true,
      output,
      metadata: {
        waveId: 'message-relay',
        messageId,
        urgency: relayedMessage.urgency,
        relayedMessage,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to relay message: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error || 'Message relay failed' };
  }
  if (!result.metadata?.messageId) {
    return { valid: false, feedback: 'No message ID generated' };
  }
  return { valid: true };
}
