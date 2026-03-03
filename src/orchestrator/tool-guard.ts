/**
 * Tool call quality monitor.
 * Tracks consecutive tool call failures per task and triggers model escalation
 * when small models fail repeatedly. Prevents runaway tool call loops.
 * See Sprint 0: Small Model Safeguards.
 */

import { orchestratorLogger } from '../utils/logger.js';
import type { ModelTier } from '../types/index.js';

/** Consecutive failures before escalating a small model to medium. */
const SMALL_MODEL_ESCALATION_THRESHOLD = 2;

/** Consecutive failures before giving up and returning an error to the user. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Tracks tool call failure state for a single task. */
interface TaskToolState {
  consecutiveFailures: number;
  totalFailures: number;
  totalCalls: number;
  escalated: boolean;
  failedTools: string[];
}

/** Decision returned by the tool guard after recording a failure. */
export interface ToolGuardDecision {
  /** Whether to continue executing tools. */
  shouldContinue: boolean;
  /** Whether the model should be escalated to a higher tier. */
  shouldEscalate: boolean;
  /** The recommended tier if escalation is needed. */
  recommendedTier?: ModelTier;
  /** Human-readable reason for the decision. */
  reason: string;
}

/** The tool guard instance tracks failures across tasks. */
export interface ToolGuard {
  /** Record a successful tool call for a task. */
  recordSuccess(taskId: string, toolName: string): void;
  /** Record a failed tool call and get the guard's decision. */
  recordFailure(taskId: string, toolName: string, error: string, currentTier: ModelTier): ToolGuardDecision;
  /** Get the current state for a task (for logging/debugging). */
  getState(taskId: string): TaskToolState | undefined;
  /** Clear state for a completed task to free memory. */
  clearTask(taskId: string): void;
}

/**
 * Create a tool guard instance for tracking tool call quality.
 * The guard monitors consecutive failures per task and recommends
 * model escalation when small models repeatedly fail at tool use.
 *
 * @returns A configured ToolGuard instance.
 */
export function createToolGuard(): ToolGuard {
  const taskStates = new Map<string, TaskToolState>();

  function getOrCreateState(taskId: string): TaskToolState {
    let state = taskStates.get(taskId);
    if (!state) {
      state = {
        consecutiveFailures: 0,
        totalFailures: 0,
        totalCalls: 0,
        escalated: false,
        failedTools: [],
      };
      taskStates.set(taskId, state);
    }
    return state;
  }

  return {
    recordSuccess(taskId: string, toolName: string): void {
      const state = getOrCreateState(taskId);
      state.consecutiveFailures = 0;
      state.totalCalls++;

      orchestratorLogger.debug(
        { taskId, toolName, totalCalls: state.totalCalls },
        'Tool call succeeded',
      );
    },

    recordFailure(
      taskId: string,
      toolName: string,
      error: string,
      currentTier: ModelTier,
    ): ToolGuardDecision {
      const state = getOrCreateState(taskId);
      state.consecutiveFailures++;
      state.totalFailures++;
      state.totalCalls++;
      state.failedTools.push(toolName);

      orchestratorLogger.warn(
        {
          taskId,
          toolName,
          error,
          consecutiveFailures: state.consecutiveFailures,
          totalFailures: state.totalFailures,
          currentTier,
        },
        'Tool call failed',
      );

      // Check if we've hit the absolute max
      if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        orchestratorLogger.error(
          { taskId, consecutiveFailures: state.consecutiveFailures },
          'Max consecutive tool failures reached, stopping task',
        );
        return {
          shouldContinue: false,
          shouldEscalate: false,
          reason: `Tool calls failed ${state.consecutiveFailures} times consecutively. `
            + `Failed tools: ${[...new Set(state.failedTools)].join(', ')}. `
            + 'Unable to complete this task with available tools.',
        };
      }

      // Check if small model should be escalated
      if (
        currentTier === 'small'
        && state.consecutiveFailures >= SMALL_MODEL_ESCALATION_THRESHOLD
        && !state.escalated
      ) {
        state.escalated = true;
        orchestratorLogger.info(
          { taskId, consecutiveFailures: state.consecutiveFailures },
          'Escalating from small to medium tier due to repeated tool failures',
        );
        return {
          shouldContinue: true,
          shouldEscalate: true,
          recommendedTier: 'medium',
          reason: `Small model failed ${state.consecutiveFailures} consecutive tool calls. `
            + 'Escalating to medium-tier model for better tool use.',
        };
      }

      return {
        shouldContinue: true,
        shouldEscalate: false,
        reason: `Tool "${toolName}" failed (${state.consecutiveFailures} consecutive). Retrying.`,
      };
    },

    getState(taskId: string): TaskToolState | undefined {
      return taskStates.get(taskId);
    },

    clearTask(taskId: string): void {
      taskStates.delete(taskId);
    },
  };
}
