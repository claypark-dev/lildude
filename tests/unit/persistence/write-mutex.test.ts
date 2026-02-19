import { describe, it, expect } from 'vitest';
import { createDbWriteMutex } from '../../../src/persistence/write-mutex.js';

describe('DbWriteMutex', () => {
  it('single writer acquires and releases', async () => {
    const mutex = createDbWriteMutex();
    const release = await mutex.acquire();
    // If we got here, we acquired successfully
    expect(typeof release).toBe('function');
    release();
  });

  it('two concurrent writers are serialized (second waits for first)', async () => {
    const mutex = createDbWriteMutex();
    const executionOrder: string[] = [];

    const release1 = await mutex.acquire();
    executionOrder.push('acquired-1');

    // Start second acquire — it should block until first releases
    const acquire2Promise = mutex.acquire().then((release2) => {
      executionOrder.push('acquired-2');
      return release2;
    });

    // Give the microtask queue a tick to prove second hasn't acquired
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(executionOrder).toEqual(['acquired-1']);

    // Release first — second should now proceed
    release1();
    const release2 = await acquire2Promise;
    expect(executionOrder).toEqual(['acquired-1', 'acquired-2']);
    release2();
  });

  it('lock is released even on error (try/finally pattern)', async () => {
    const mutex = createDbWriteMutex();

    // First: withLock that throws
    try {
      await mutex.withLock(() => {
        throw new Error('Intentional failure');
      });
    } catch {
      // expected
    }

    // Second acquire should succeed immediately — lock was released
    const release = await mutex.acquire();
    expect(typeof release).toBe('function');
    release();
  });

  it('withLock convenience wrapper works', async () => {
    const mutex = createDbWriteMutex();
    const result = await mutex.withLock(() => 42);
    expect(result).toBe(42);
  });

  it('withLock works with async functions', async () => {
    const mutex = createDbWriteMutex();
    const result = await mutex.withLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'async-result';
    });
    expect(result).toBe('async-result');
  });

  it('queue processes in FIFO order', async () => {
    const mutex = createDbWriteMutex();
    const executionOrder: number[] = [];

    const release1 = await mutex.acquire();

    // Queue up writers 2, 3, 4
    const promise2 = mutex.withLock(() => { executionOrder.push(2); });
    const promise3 = mutex.withLock(() => { executionOrder.push(3); });
    const promise4 = mutex.withLock(() => { executionOrder.push(4); });

    // Release the first lock to let the queue drain
    release1();

    await Promise.all([promise2, promise3, promise4]);
    expect(executionOrder).toEqual([2, 3, 4]);
  });

  it('withLock propagates errors correctly', async () => {
    const mutex = createDbWriteMutex();
    await expect(
      mutex.withLock(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('withLock propagates async errors correctly', async () => {
    const mutex = createDbWriteMutex();
    await expect(
      mutex.withLock(async () => {
        throw new Error('async-boom');
      }),
    ).rejects.toThrow('async-boom');
  });
});
