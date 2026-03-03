/**
 * Auto-Responder Wave — observe tier.
 * Returns owner's current status/away message to external users.
 * Deterministic: no LLM call needed, just reads config.
 * Owner configures status via web panel or CLI.
 */

/** Default statuses the owner can set. */
const STATUS_TYPES = {
  available: { label: 'Available', emoji: '' },
  busy: { label: 'Busy', emoji: '' },
  away: { label: 'Away', emoji: '' },
  dnd: { label: 'Do Not Disturb', emoji: '' },
  vacation: { label: 'On Vacation', emoji: '' },
  offline: { label: 'Offline', emoji: '' },
};

/**
 * Format the owner's status for display.
 * @param {object} statusConfig - Owner's status configuration.
 * @param {string} ownerName - Owner's display name.
 * @returns {string} Formatted status message.
 */
function formatStatus(statusConfig, ownerName) {
  const status = STATUS_TYPES[statusConfig.status] || STATUS_TYPES.available;
  const lines = [];

  lines.push(`${ownerName} is currently: ${status.label}`);

  if (statusConfig.customMessage) {
    lines.push('');
    lines.push(statusConfig.customMessage);
  }

  if (statusConfig.returnDate) {
    lines.push('');
    lines.push(`Expected back: ${statusConfig.returnDate}`);
  }

  if (statusConfig.alternateContact) {
    lines.push('');
    lines.push(`In the meantime, you can reach: ${statusConfig.alternateContact}`);
  }

  // Add suggestion based on status
  if (statusConfig.status === 'available') {
    lines.push('');
    lines.push('Feel free to leave a message or request a meeting.');
  } else if (['busy', 'dnd'].includes(statusConfig.status)) {
    lines.push('');
    lines.push('You can leave a message and they will get back to you.');
  } else if (['away', 'vacation', 'offline'].includes(statusConfig.status)) {
    lines.push('');
    lines.push('You can leave a message. They will respond when they return.');
  }

  return lines.join('\n');
}

export async function plan(userInput, _context) {
  return {
    steps: [
      {
        type: 'api_call',
        description: 'Check owner status and return auto-response',
        params: {},
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: {
      query: userInput,
    },
  };
}

export async function execute(wavePlan) {
  try {
    // In real execution, statusConfig comes from auto_responder_config table
    const statusConfig = wavePlan.extractedParams._statusConfig || {
      enabled: true,
      status: 'available',
      customMessage: null,
      returnDate: null,
      alternateContact: null,
    };

    const ownerName = wavePlan.extractedParams._ownerName || 'the owner';

    if (!statusConfig.enabled) {
      return {
        success: true,
        output: 'Auto-responder is not currently active.',
        metadata: {
          waveId: 'auto-responder',
          status: 'disabled',
        },
      };
    }

    const output = formatStatus(statusConfig, ownerName);

    return {
      success: true,
      output,
      metadata: {
        waveId: 'auto-responder',
        status: statusConfig.status,
        hasCustomMessage: !!statusConfig.customMessage,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to get status: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error || 'Auto-responder failed' };
  }
  return { valid: true };
}
