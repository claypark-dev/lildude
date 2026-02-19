/**
 * Task Pool — concurrent task execution with bounded parallelism.
 * Manages a pool of agent loop tasks with a configurable concurrency
 * limit, FIFO queue for overflow, kill/abort support, and graceful
 * shutdown. See HLD Section S3.S.1.
 */

import os from 'node:os';
import { nanoid } from 'nanoid';
import type { ChannelType } from '../types/index.js';
import type { AgentLoop, AgentLoopResult } from './agent-loop-helpers.js';
import { createModuleLogger } from '../utils/logger.js';
import { executeWithAbort } from './task-pool-helpers.js';
import type {
  TaskPoolConfig,
  TaskPoolEntry,
  TaskPoolStats,
  TaskPool,
  QueuedTask,
} from './task-pool-helpers.js';

// Re-export types for consumers
export type { TaskPoolConfig, TaskPoolEntry, TaskPoolStats, TaskPool };

const log = createModuleLogger('task-pool');

/** Default shutdown timeout in milliseconds. */
const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Determine the default concurrency based on hardware.
 * Uses min(cpuCores, 4) as a sensible default.
 * @returns The default max concurrent tasks.
 */
function defaultMaxConcurrent(): number {
  const cpuCores = os.cpus().length;
  return Math.min(cpuCores, 4);
}

/**
 * Create a TaskPool that wraps an AgentLoop with bounded concurrency.
 *
 * @param agentLoop - The agent loop to delegate task execution to.
 * @param config - Optional pool configuration overrides.
 * @returns A TaskPool instance ready for use.
 */
export function createTaskPool(
  agentLoop: AgentLoop,
  config?: Partial<TaskPoolConfig>,
): TaskPool {
  const maxConcurrent = config?.maxConcurrent ?? defaultMaxConcurrent();

  const running: Map<string, TaskPoolEntry> = new Map();
  const queue: QueuedTask[] = [];
  let completedCount = 0;
  let isShuttingDown = false;

  /**
   * Try to drain the queue: start queued tasks while
   * there is available capacity.
   */
  function drainQueue(): void {
    while (queue.length > 0 && running.size < maxConcurrent) {
      const queued = queue.shift()!;

      if (queued.abortController.signal.aborted) {
        queued.reject(new Error('Task was aborted while queued'));
        continue;
      }

      startTask(queued);
    }
  }

  /**
   * Start executing a queued task: create the entry, run the
   * agent loop, and wire up completion/cleanup.
   */
  function startTask(queued: QueuedTask): void {
    const { taskId, conversationId, userMessage, channelType, abortController, resolve, reject } = queued;

    const taskPromise = executeWithAbort(
      agentLoop, conversationId, userMessage, channelType, abortController.signal,
    );

    const entry: TaskPoolEntry = {
      taskId,
      promise: taskPromise,
      startedAt: new Date(),
      abortController,
    };

    running.set(taskId, entry);
    log.info({ taskId, runningCount: running.size }, 'Task started');

    taskPromise
      .then((taskResult) => {
        running.delete(taskId);
        completedCount++;
        log.info({ taskId, runningCount: running.size }, 'Task completed');
        resolve(taskResult);
        drainQueue();
      })
      .catch((taskError: unknown) => {
        running.delete(taskId);
        completedCount++;
        const errorMsg = taskError instanceof Error ? taskError.message : String(taskError);
        log.warn({ taskId, error: errorMsg }, 'Task failed');
        reject(taskError instanceof Error ? taskError : new Error(String(taskError)));
        drainQueue();
      });
  }

  return {
    submit(
      conversationId: string,
      userMessage: string,
      channelType: ChannelType,
    ): Promise<AgentLoopResult> {
      if (isShuttingDown) {
        return Promise.reject(new Error('Task pool is shutting down'));
      }

      const taskId = nanoid();
      const abortController = new AbortController();

      return new Promise<AgentLoopResult>((resolve, reject) => {
        const queued: QueuedTask = {
          taskId, conversationId, userMessage, channelType, abortController, resolve, reject,
        };

        if (running.size < maxConcurrent) {
          startTask(queued);
        } else {
          log.info({ taskId, queueLength: queue.length + 1 }, 'Task queued');
          queue.push(queued);
        }
      });
    },

    kill(taskId: string): boolean {
      const entry = running.get(taskId);
      if (entry) {
        log.info({ taskId }, 'Killing running task');
        entry.abortController.abort();
        return true;
      }

      const queueIdx = queue.findIndex((queued) => queued.taskId === taskId);
      if (queueIdx !== -1) {
        const [removed] = queue.splice(queueIdx, 1);
        log.info({ taskId }, 'Killing queued task');
        removed.abortController.abort();
        removed.reject(new Error('Task was killed'));
        return true;
      }

      log.debug({ taskId }, 'Kill requested for unknown task');
      return false;
    },

    getRunning(): TaskPoolEntry[] {
      return [...running.values()];
    },

    getPendingCount(): number {
      return queue.length;
    },

    getStats(): TaskPoolStats {
      return {
        running: running.size,
        pending: queue.length,
        completed: completedCount,
        maxConcurrent,
      };
    },

    async shutdown(): Promise<void> {
      isShuttingDown = true;
      log.info({ running: running.size, pending: queue.length }, 'Task pool shutting down');

      // Reject all pending queue items
      while (queue.length > 0) {
        const queued = queue.shift()!;
        queued.reject(new Error('Task pool is shutting down'));
      }

      // Wait for running tasks with a timeout
      if (running.size > 0) {
        const runningPromises = [...running.values()].map((entry) =>
          entry.promise.catch(() => {
            // Swallow errors during shutdown — we only care about waiting
          }),
        );

        const timeoutPromise = new Promise<void>((resolve) => {
          setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
        });

        await Promise.race([
          Promise.all(runningPromises),
          timeoutPromise,
        ]);

        // Abort any tasks still running after timeout
        for (const entry of running.values()) {
          entry.abortController.abort();
        }
      }

      log.info('Task pool shutdown complete');
    },
  };
}
