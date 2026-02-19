/**
 * Helper types and utilities for the task pool.
 * Extracted to keep task-pool.ts under 300 lines.
 * See HLD Section S3.S.1.
 */

import type { ChannelType } from '../types/index.js';
import type { AgentLoop, AgentLoopResult } from './agent-loop-helpers.js';

/** Configuration for the task pool. */
export interface TaskPoolConfig {
  /** Maximum tasks that can execute simultaneously. */
  maxConcurrent: number;
}

/** A running task entry tracked by the pool. */
export interface TaskPoolEntry {
  /** Unique task identifier. */
  taskId: string;
  /** The promise for the running task. */
  promise: Promise<AgentLoopResult>;
  /** When the task started executing. */
  startedAt: Date;
  /** Controller to signal cancellation. */
  abortController: AbortController;
}

/** Statistics snapshot from the pool. */
export interface TaskPoolStats {
  running: number;
  pending: number;
  completed: number;
  maxConcurrent: number;
}

/** A queued item waiting for a slot in the pool. */
export interface QueuedTask {
  taskId: string;
  conversationId: string;
  userMessage: string;
  channelType: ChannelType;
  abortController: AbortController;
  resolve: (result: AgentLoopResult) => void;
  reject: (error: Error) => void;
}

/** The task pool interface for managing concurrent agent loop tasks. */
export interface TaskPool {
  /**
   * Submit a task to the pool. If the pool is at capacity the task
   * is queued and the returned promise resolves when it eventually
   * completes.
   */
  submit(
    conversationId: string,
    userMessage: string,
    channelType: ChannelType,
  ): Promise<AgentLoopResult>;

  /**
   * Kill a running or queued task by its ID.
   * @returns true if the task was found and aborted, false otherwise.
   */
  kill(taskId: string): boolean;

  /** Get a snapshot of currently running task entries. */
  getRunning(): TaskPoolEntry[];

  /** Get the number of tasks waiting in the queue. */
  getPendingCount(): number;

  /** Get a statistics snapshot. */
  getStats(): TaskPoolStats;

  /**
   * Graceful shutdown: waits for running tasks to finish (with timeout)
   * and rejects all queued tasks.
   */
  shutdown(): Promise<void>;
}

/**
 * Execute the agent loop's processMessage with abort signal support.
 * If the signal is already aborted, rejects immediately. Otherwise
 * runs the agent loop and races it against an abort listener.
 *
 * @param agentLoop - The agent loop to call.
 * @param conversationId - Conversation identifier.
 * @param userMessage - The user's message.
 * @param channelType - The channel the message arrived on.
 * @param signal - AbortSignal to monitor for cancellation.
 * @returns The AgentLoopResult from processMessage.
 */
export async function executeWithAbort(
  agentLoop: AgentLoop,
  conversationId: string,
  userMessage: string,
  channelType: ChannelType,
  signal: AbortSignal,
): Promise<AgentLoopResult> {
  if (signal.aborted) {
    throw new Error('Task was aborted');
  }

  return new Promise<AgentLoopResult>((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      if (!settled) {
        settled = true;
        reject(new Error('Task was aborted'));
      }
    };

    signal.addEventListener('abort', onAbort, { once: true });

    agentLoop
      .processMessage(conversationId, userMessage, channelType, { abortSignal: signal })
      .then((loopResult) => {
        if (!settled) {
          settled = true;
          signal.removeEventListener('abort', onAbort);
          resolve(loopResult);
        }
      })
      .catch((loopError: unknown) => {
        if (!settled) {
          settled = true;
          signal.removeEventListener('abort', onAbort);
          reject(loopError instanceof Error ? loopError : new Error(String(loopError)));
        }
      });
  });
}
