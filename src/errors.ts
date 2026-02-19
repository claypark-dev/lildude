/**
 * Lil Dude error type hierarchy.
 * All custom errors extend LilDudeError for consistent handling.
 * See HLD Section 18 for error handling rules.
 */

/** Base error for all Lil Dude errors */
export class LilDudeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userFacing: boolean = false,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'LilDudeError';
  }
}

/** Thrown when a security check blocks an action */
export class SecurityError extends LilDudeError {
  constructor(message: string) {
    super(message, 'SECURITY_DENIED', true, false);
    this.name = 'SecurityError';
  }
}

/** Thrown when the budget is exceeded */
export class BudgetExceededError extends LilDudeError {
  constructor(message: string) {
    super(message, 'BUDGET_EXCEEDED', true, false);
    this.name = 'BudgetExceededError';
  }
}

/** Thrown when an LLM provider call fails */
export class ProviderError extends LilDudeError {
  constructor(
    message: string,
    public readonly provider: string,
  ) {
    super(message, 'PROVIDER_ERROR', true, true);
    this.name = 'ProviderError';
  }
}

/** Thrown when a tool execution fails */
export class ToolExecutionError extends LilDudeError {
  constructor(
    message: string,
    public readonly toolName: string,
  ) {
    super(message, 'TOOL_ERROR', false, true);
    this.name = 'ToolExecutionError';
  }
}

/** Thrown when a task is killed by user or kill condition */
export class TaskKilledError extends LilDudeError {
  constructor(taskId: string, reason: string) {
    super(`Task ${taskId} killed: ${reason}`, 'TASK_KILLED', true, false);
    this.name = 'TaskKilledError';
  }
}

/** Thrown when config validation fails */
export class ConfigError extends LilDudeError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', true, false);
    this.name = 'ConfigError';
  }
}

/** Thrown when a persistence/database operation fails */
export class PersistenceError extends LilDudeError {
  constructor(message: string) {
    super(message, 'PERSISTENCE_ERROR', false, true);
    this.name = 'PersistenceError';
  }
}
