import { describe, it, expect, vi } from 'vitest';
import { createTaskPool } from '../../../src/orchestrator/task-pool.js';
import type { AgentLoop, AgentLoopResult } from '../../../src/orchestrator/agent-loop-helpers.js';
import type { ChannelType } from '../../../src/types/index.js';

/** Helper: build a mock AgentLoopResult. */
function mockResult(text: string): AgentLoopResult {
  return {
    responseText: text,
    tokensUsed: { input: 10, output: 5 },
    costUsd: 0.001,
    toolCallCount: 0,
    roundTrips: 1,
  };
}

/**
 * Create a mock agent loop where processMessage delays
 * for a configurable amount of time, then resolves with a
 * result that includes the user message.
 * Tracks call timing so tests can verify concurrency behavior.
 */
function createMockAgentLoop(delayMs: number = 50): {
  agentLoop: AgentLoop;
  startTimes: number[];
  endTimes: number[];
  calls: Array<{ conversationId: string; userMessage: string; channelType: ChannelType }>;
} {
  const startTimes: number[] = [];
  const endTimes: number[] = [];
  const calls: Array<{ conversationId: string; userMessage: string; channelType: ChannelType }> = [];

  const agentLoop: AgentLoop = {
    async processMessage(
      conversationId: string,
      userMessage: string,
      channelType: ChannelType,
    ): Promise<AgentLoopResult> {
      const startedAt = Date.now();
      startTimes.push(startedAt);
      calls.push({ conversationId, userMessage, channelType });

      await new Promise((resolve) => setTimeout(resolve, delayMs));

      endTimes.push(Date.now());
      return mockResult(`response to: ${userMessage}`);
    },
  };

  return { agentLoop, startTimes, endTimes, calls };
}

/**
 * Create a mock agent loop with individually controllable tasks.
 * Each submitted task gets its own resolve/reject functions.
 */
function createControllableAgentLoop(): {
  agentLoop: AgentLoop;
  resolvers: Array<(result: AgentLoopResult) => void>;
  rejectors: Array<(error: Error) => void>;
} {
  const resolvers: Array<(result: AgentLoopResult) => void> = [];
  const rejectors: Array<(error: Error) => void> = [];

  const agentLoop: AgentLoop = {
    processMessage(
      _conversationId: string,
      userMessage: string,
      _channelType: ChannelType,
    ): Promise<AgentLoopResult> {
      return new Promise<AgentLoopResult>((resolve, reject) => {
        resolvers.push((loopResult) => resolve(loopResult));
        rejectors.push((loopError) => reject(loopError));
      });
    },
  };

  return { agentLoop, resolvers, rejectors };
}

describe('TaskPool', () => {
  it('submits a task and gets result', async () => {
    const { agentLoop } = createMockAgentLoop(10);
    const pool = createTaskPool(agentLoop, { maxConcurrent: 2 });

    const taskResult = await pool.submit('conv-1', 'hello', 'cli');
    expect(taskResult.responseText).toBe('response to: hello');
    expect(taskResult.roundTrips).toBe(1);
  });

  it('two tasks execute concurrently (both start before either finishes)', async () => {
    const { agentLoop, startTimes, endTimes } = createMockAgentLoop(100);
    const pool = createTaskPool(agentLoop, { maxConcurrent: 2 });

    const promise1 = pool.submit('conv-1', 'task-a', 'cli');
    const promise2 = pool.submit('conv-2', 'task-b', 'cli');

    await Promise.all([promise1, promise2]);

    // Both should have started before either finished
    expect(startTimes.length).toBe(2);
    expect(endTimes.length).toBe(2);

    // Second task started before first finished
    expect(startTimes[1]).toBeLessThan(endTimes[0]);
  });

  it('pool respects maxConcurrent limit (third task waits)', async () => {
    const { agentLoop, resolvers } = createControllableAgentLoop();
    const pool = createTaskPool(agentLoop, { maxConcurrent: 2 });

    const promise1 = pool.submit('conv-1', 'task-1', 'cli');
    const promise2 = pool.submit('conv-2', 'task-2', 'cli');
    const promise3 = pool.submit('conv-3', 'task-3', 'cli');

    // Allow microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Only 2 should be running, 1 pending
    expect(pool.getStats().running).toBe(2);
    expect(pool.getStats().pending).toBe(1);
    expect(resolvers.length).toBe(2); // only 2 tasks actually started

    // Complete first two tasks
    resolvers[0](mockResult('result-1'));
    resolvers[1](mockResult('result-2'));

    await Promise.all([promise1, promise2]);

    // Allow drain to process
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Third should now be running
    expect(pool.getStats().running).toBe(1);
    expect(pool.getStats().pending).toBe(0);
    expect(resolvers.length).toBe(3); // third task started

    // Complete third
    resolvers[2](mockResult('result-3'));
    const result3 = await promise3;
    expect(result3.responseText).toBe('result-3');
  });

  it('queued task executes after running task completes', async () => {
    const { agentLoop, resolvers } = createControllableAgentLoop();
    const pool = createTaskPool(agentLoop, { maxConcurrent: 1 });

    const promise1 = pool.submit('conv-1', 'first', 'cli');
    const promise2 = pool.submit('conv-2', 'second', 'cli');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pool.getStats().running).toBe(1);
    expect(pool.getStats().pending).toBe(1);

    // Complete the first task
    resolvers[0](mockResult('first-done'));
    await promise1;

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second should now be running
    expect(pool.getStats().running).toBe(1);
    expect(pool.getStats().pending).toBe(0);

    resolvers[1](mockResult('second-done'));
    const result2 = await promise2;
    expect(result2.responseText).toBe('second-done');
  });

  it('kill stops a running task', async () => {
    const { agentLoop } = createControllableAgentLoop();
    const pool = createTaskPool(agentLoop, { maxConcurrent: 2 });

    const taskPromise = pool.submit('conv-1', 'to-kill', 'cli');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const runningEntries = pool.getRunning();
    expect(runningEntries.length).toBe(1);

    const taskId = runningEntries[0].taskId;
    const killed = pool.kill(taskId);
    expect(killed).toBe(true);

    await expect(taskPromise).rejects.toThrow('aborted');
  });

  it('kill returns false for unknown taskId', () => {
    const { agentLoop } = createMockAgentLoop(10);
    const pool = createTaskPool(agentLoop, { maxConcurrent: 2 });

    const killed = pool.kill('nonexistent-id');
    expect(killed).toBe(false);
  });

  it('getRunning() shows only active tasks', async () => {
    const { agentLoop, resolvers } = createControllableAgentLoop();
    const pool = createTaskPool(agentLoop, { maxConcurrent: 3 });

    pool.submit('conv-1', 'a', 'cli');
    pool.submit('conv-2', 'b', 'cli');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pool.getRunning().length).toBe(2);

    // Complete one
    resolvers[0](mockResult('done'));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pool.getRunning().length).toBe(1);

    // Complete the other
    resolvers[1](mockResult('done'));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pool.getRunning().length).toBe(0);
  });

  it('getPendingCount() shows queued count', async () => {
    const { agentLoop } = createControllableAgentLoop();
    const pool = createTaskPool(agentLoop, { maxConcurrent: 1 });

    pool.submit('conv-1', 'a', 'cli');
    pool.submit('conv-2', 'b', 'cli');
    pool.submit('conv-3', 'c', 'cli');

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(pool.getPendingCount()).toBe(2);
    expect(pool.getStats().running).toBe(1);
  });

  it('getStats() returns correct totals', async () => {
    const { agentLoop } = createMockAgentLoop(10);
    const pool = createTaskPool(agentLoop, { maxConcurrent: 2 });

    const stats0 = pool.getStats();
    expect(stats0.running).toBe(0);
    expect(stats0.pending).toBe(0);
    expect(stats0.completed).toBe(0);
    expect(stats0.maxConcurrent).toBe(2);

    // Submit and wait for completion
    await pool.submit('conv-1', 'hello', 'cli');

    const stats1 = pool.getStats();
    expect(stats1.completed).toBe(1);
    expect(stats1.running).toBe(0);
  });

  it('shutdown waits for running tasks', async () => {
    const { agentLoop, resolvers } = createControllableAgentLoop();
    const pool = createTaskPool(agentLoop, { maxConcurrent: 2 });

    const taskPromise = pool.submit('conv-1', 'running', 'cli');
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Start shutdown — should not resolve until task completes
    const shutdownPromise = pool.shutdown();

    // Task still running
    expect(pool.getStats().running).toBe(1);

    // Complete the task
    resolvers[0](mockResult('done-during-shutdown'));

    await taskPromise;
    await shutdownPromise;

    // After shutdown, pool should reject new submissions
    await expect(pool.submit('conv-2', 'rejected', 'cli')).rejects.toThrow('shutting down');
  });

  it('shutdown rejects pending queue items', async () => {
    const { agentLoop, resolvers } = createControllableAgentLoop();
    const pool = createTaskPool(agentLoop, { maxConcurrent: 1 });

    const promise1 = pool.submit('conv-1', 'running', 'cli');
    const promise2 = pool.submit('conv-2', 'queued', 'cli');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pool.getStats().pending).toBe(1);

    // Start shutdown — queued task should be rejected
    const shutdownPromise = pool.shutdown();

    await expect(promise2).rejects.toThrow('shutting down');

    // Complete the running task so shutdown finishes
    resolvers[0](mockResult('done'));
    await promise1;
    await shutdownPromise;
  });

  it('tasks in getRunning() have correct entry shape', async () => {
    const { agentLoop } = createControllableAgentLoop();
    const pool = createTaskPool(agentLoop, { maxConcurrent: 2 });

    pool.submit('conv-1', 'shape-test', 'cli');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const entries = pool.getRunning();
    expect(entries.length).toBe(1);
    const entry = entries[0];
    expect(typeof entry.taskId).toBe('string');
    expect(entry.taskId.length).toBeGreaterThan(0);
    expect(entry.startedAt).toBeInstanceOf(Date);
    expect(entry.abortController).toBeInstanceOf(AbortController);
    expect(entry.promise).toBeInstanceOf(Promise);
  });
});
