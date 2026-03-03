/**
 * Task Delegation Wave — create tier.
 * Trusted contacts submit tasks for the owner to review and act on.
 * Creates a pending task delegation record for owner approval.
 * Deterministic execution (no LLM needed).
 */

/** Valid priority levels for delegated tasks. */
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

/**
 * Parse task details from user input.
 * @param {string} input - The user's message.
 * @returns {{ title: string, description: string, priority: string }} Extracted task details.
 */
function parseTaskInput(input) {
  const result = {
    title: '',
    description: '',
    priority: 'normal',
  };

  // Extract priority keywords
  const priorityMatch = input.match(/\b(urgent|high\s*priority|low\s*priority)\b/i);
  if (priorityMatch) {
    const matched = priorityMatch[1].toLowerCase();
    if (matched === 'urgent') result.priority = 'urgent';
    else if (matched.includes('high')) result.priority = 'high';
    else if (matched.includes('low')) result.priority = 'low';
  }

  // Extract title from common patterns
  const titlePatterns = [
    /(?:task|todo|action item|delegate)[:\s]+(.+?)(?:\.|$)/i,
    /(?:please|can you|could you)\s+(.+?)(?:\.|$)/i,
    /(?:need to|needs to|should)\s+(.+?)(?:\.|$)/i,
  ];

  for (const pattern of titlePatterns) {
    const match = input.match(pattern);
    if (match) {
      result.title = match[1].trim().slice(0, 200);
      break;
    }
  }

  // Fallback: use first sentence as title
  if (!result.title) {
    const firstSentence = input.split(/[.!?\n]/)[0] || input;
    result.title = firstSentence.trim().slice(0, 200);
  }

  // Description is the full input
  result.description = input.slice(0, 1000);

  return result;
}

/**
 * Validate task delegation parameters.
 * @param {{ title: string, priority: string }} params
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateTask(params) {
  const issues = [];

  if (!params.title || params.title.trim().length === 0) {
    issues.push('A task title is required.');
  }
  if (params.title && params.title.length > 200) {
    issues.push('Task title cannot exceed 200 characters.');
  }
  if (!VALID_PRIORITIES.includes(params.priority)) {
    issues.push(`Invalid priority "${params.priority}". Must be: ${VALID_PRIORITIES.join(', ')}.`);
  }

  return { valid: issues.length === 0, issues };
}

export async function plan(userInput, _context) {
  const parsed = parseTaskInput(userInput);

  return {
    steps: [
      {
        type: 'api_call',
        description: 'Create task delegation for owner review',
        params: parsed,
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: parsed,
  };
}

export async function execute(wavePlan) {
  const { title, description, priority } = wavePlan.extractedParams;

  try {
    const validation = validateTask({ title, priority });
    if (!validation.valid) {
      return {
        success: false,
        output: '',
        error: `Invalid task delegation: ${validation.issues.join(' ')}`,
      };
    }

    const taskId = `task_${Date.now()}`;
    const task = {
      id: taskId,
      type: 'task_delegation',
      title,
      description: description || '',
      priority,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const output = [
      'Task submitted for owner review.',
      `Title: ${title}`,
      `Priority: ${priority}`,
      description ? `Details: ${description.slice(0, 100)}${description.length > 100 ? '...' : ''}` : '',
      '',
      'The owner will review and respond to your task.',
      `Task ID: ${taskId}`,
    ].filter(Boolean).join('\n');

    return {
      success: true,
      output,
      metadata: {
        waveId: 'task-delegation',
        taskId,
        approvalRequired: true,
        approvalRequest: task,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to create task delegation: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error || 'Task delegation failed' };
  }
  if (!result.metadata?.taskId) {
    return { valid: false, feedback: 'No task ID generated' };
  }
  return { valid: true };
}
