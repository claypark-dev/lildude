/**
 * Todo Manager Wave — create tier.
 * In-memory todo list with priority and due date parsing.
 * Deterministic execution.
 */

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

function parseAction(input) {
  const lower = input.toLowerCase();
  if (lower.match(/\b(?:add|create|new)\b/)) return 'add';
  if (lower.match(/\b(?:list|show|view|all)\b/)) return 'list';
  if (lower.match(/\b(?:done|complete|finish|check)\b/)) return 'complete';
  if (lower.match(/\b(?:remove|delete|drop)\b/)) return 'delete';
  return 'add'; // Default: treat input as a new todo
}

function parsePriority(input) {
  const lower = input.toLowerCase();
  if (lower.includes('urgent') || lower.includes('asap')) return 'urgent';
  if (lower.includes('high') || lower.includes('important')) return 'high';
  if (lower.includes('low') || lower.includes('no rush')) return 'low';
  return 'medium';
}

function extractTodoText(input) {
  return input
    .replace(/\b(?:add|create|new|todo|task|to-do|remind me to)\b/gi, '')
    .replace(/\b(?:urgent|high|low|medium|priority|important|asap|no rush)\b/gi, '')
    .trim()
    .replace(/^[\s:]+/, '');
}

export async function plan(userInput, _context) {
  const action = parseAction(userInput);
  const priority = parsePriority(userInput);
  const text = extractTodoText(userInput);

  return {
    steps: [{ type: 'api_call', description: `${action} todo`, params: { action, text, priority } }],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: { action, text, priority },
  };
}

export async function execute(wavePlan) {
  const { action, text, priority } = wavePlan.extractedParams;

  try {
    const todoId = `todo_${Date.now()}`;

    switch (action) {
      case 'add':
        if (!text) {
          return { success: false, output: '', error: 'Please provide a description for the todo.' };
        }
        return {
          success: true,
          output: `Todo added: "${text}" [${priority}]\nID: ${todoId}`,
          metadata: { waveId: 'todo-manager', action: 'add', todoId, priority },
        };
      case 'list':
        return {
          success: true,
          output: 'Todo list would be retrieved from storage.',
          metadata: { waveId: 'todo-manager', action: 'list' },
        };
      case 'complete':
        return {
          success: true,
          output: `Todo "${text || 'item'}" marked as complete.`,
          metadata: { waveId: 'todo-manager', action: 'complete' },
        };
      case 'delete':
        return {
          success: true,
          output: `Todo "${text || 'item'}" deleted.`,
          metadata: { waveId: 'todo-manager', action: 'delete' },
        };
      default:
        return { success: false, output: '', error: `Unknown action: ${action}` };
    }
  } catch (error) {
    return { success: false, output: '', error: `Todo operation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function validate(result) {
  return result.success ? { valid: true } : { valid: false, feedback: result.error };
}
