/**
 * Document Request Wave — create tier.
 * External users request documents from the owner with pending approval.
 * Creates a pending document request for the owner to review.
 * Deterministic execution (no LLM needed).
 */

/**
 * Parse document request details from user input.
 * @param {string} input - The user's message.
 * @returns {{ documentName: string, reason: string }} Extracted request details.
 */
function parseDocumentInput(input) {
  const result = {
    documentName: '',
    reason: '',
  };

  // Extract document name from common patterns
  const docPatterns = [
    /(?:send me|share|document|file|can I get)[:\s]+(?:the\s+)?(.+?)(?:\.|$)/i,
    /(?:need|want|looking for)\s+(?:the\s+)?(.+?)(?:\s+(?:document|file|pdf|doc))/i,
    /(?:request)\s+(?:the\s+)?(.+?)(?:\.|$)/i,
  ];

  for (const pattern of docPatterns) {
    const match = input.match(pattern);
    if (match) {
      result.documentName = match[1].trim().slice(0, 200);
      break;
    }
  }

  // Fallback: use first meaningful chunk
  if (!result.documentName) {
    const cleaned = input
      .replace(/\b(?:send me|share|document|file|can I get|please|the)\b/gi, '')
      .trim();
    result.documentName = cleaned.slice(0, 200) || 'Unnamed document';
  }

  // Extract reason from "because", "for", "reason" patterns
  const reasonMatch = input.match(/(?:because|for|reason:|need it for)\s+(.+?)(?:\.|$)/i);
  if (reasonMatch) {
    result.reason = reasonMatch[1].trim().slice(0, 500);
  } else {
    result.reason = input.slice(0, 500);
  }

  return result;
}

/**
 * Validate document request parameters.
 * @param {{ documentName: string }} params
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateRequest(params) {
  const issues = [];

  if (!params.documentName || params.documentName.trim().length === 0) {
    issues.push('A document name or description is required.');
  }
  if (params.documentName && params.documentName.length > 200) {
    issues.push('Document name cannot exceed 200 characters.');
  }

  return { valid: issues.length === 0, issues };
}

export async function plan(userInput, _context) {
  const parsed = parseDocumentInput(userInput);

  return {
    steps: [
      {
        type: 'api_call',
        description: 'Create document request for owner approval',
        params: parsed,
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: parsed,
  };
}

export async function execute(wavePlan) {
  const { documentName, reason } = wavePlan.extractedParams;

  try {
    const validation = validateRequest({ documentName });
    if (!validation.valid) {
      return {
        success: false,
        output: '',
        error: `Invalid document request: ${validation.issues.join(' ')}`,
      };
    }

    const requestId = `doc_${Date.now()}`;
    const request = {
      id: requestId,
      type: 'document_request',
      documentName,
      reason: reason || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const output = [
      'Document request submitted for approval.',
      `Document: ${documentName}`,
      reason ? `Reason: ${reason.slice(0, 100)}${reason.length > 100 ? '...' : ''}` : '',
      '',
      'The owner will review your request and share the document if approved.',
      `Request ID: ${requestId}`,
    ].filter(Boolean).join('\n');

    return {
      success: true,
      output,
      metadata: {
        waveId: 'document-request',
        requestId,
        approvalRequired: true,
        approvalRequest: request,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to create document request: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error || 'Document request failed' };
  }
  if (!result.metadata?.requestId) {
    return { valid: false, feedback: 'No request ID generated' };
  }
  return { valid: true };
}
