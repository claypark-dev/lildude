/**
 * Contact Share Wave — observe tier.
 * Returns owner's preferred contact methods.
 * Only shares information the owner has explicitly configured as shareable.
 * Privacy-first: never exposes data the owner hasn't opted in to share.
 * Deterministic execution.
 */

/**
 * Filter contact info to only shareable fields.
 * @param {object} ownerConfig - Owner's contact sharing configuration.
 * @returns {object} Only the fields the owner has opted to share.
 */
function filterShareableInfo(ownerConfig) {
  const shareable = {};

  if (ownerConfig.shareEmail && ownerConfig.email) {
    shareable.email = ownerConfig.email;
  }
  if (ownerConfig.sharePhone && ownerConfig.phone) {
    shareable.phone = ownerConfig.phone;
  }
  if (ownerConfig.shareCalendarLink && ownerConfig.calendarLink) {
    shareable.calendarLink = ownerConfig.calendarLink;
  }
  if (ownerConfig.shareLinkedIn && ownerConfig.linkedIn) {
    shareable.linkedIn = ownerConfig.linkedIn;
  }
  if (ownerConfig.shareWebsite && ownerConfig.website) {
    shareable.website = ownerConfig.website;
  }
  if (ownerConfig.customMessage) {
    shareable.message = ownerConfig.customMessage;
  }

  return shareable;
}

/**
 * Format shareable contact info for display.
 * @param {object} info - Filtered shareable info.
 * @param {string} ownerName - Owner's display name.
 * @returns {string} Formatted contact information.
 */
function formatContactInfo(info, ownerName) {
  const lines = [`Here's how to reach ${ownerName}:`];

  if (info.email) {
    lines.push(`Email: ${info.email}`);
  }
  if (info.phone) {
    lines.push(`Phone: ${info.phone}`);
  }
  if (info.calendarLink) {
    lines.push(`Book a meeting: ${info.calendarLink}`);
  }
  if (info.linkedIn) {
    lines.push(`LinkedIn: ${info.linkedIn}`);
  }
  if (info.website) {
    lines.push(`Website: ${info.website}`);
  }
  if (info.message) {
    lines.push('');
    lines.push(info.message);
  }

  if (lines.length === 1) {
    return `${ownerName} hasn't configured any contact information to share yet.`;
  }

  return lines.join('\n');
}

export async function plan(userInput, _context) {
  return {
    steps: [
      {
        type: 'api_call',
        description: 'Retrieve owner shareable contact information',
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
    // In real execution, ownerConfig comes from the config store
    const ownerConfig = wavePlan.extractedParams._ownerConfig || {
      shareEmail: false,
      sharePhone: false,
      shareCalendarLink: false,
      shareLinkedIn: false,
      shareWebsite: false,
      customMessage: null,
      email: null,
      phone: null,
      calendarLink: null,
      linkedIn: null,
      website: null,
    };

    const ownerName = wavePlan.extractedParams._ownerName || 'the owner';
    const shareable = filterShareableInfo(ownerConfig);
    const output = formatContactInfo(shareable, ownerName);

    return {
      success: true,
      output,
      metadata: {
        waveId: 'contact-share',
        fieldsShared: Object.keys(shareable).filter((k) => k !== 'message').length,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to retrieve contact info: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error || 'Contact share failed' };
  }
  return { valid: true };
}
