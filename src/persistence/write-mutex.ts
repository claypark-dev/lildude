/**
 * SQLite write mutex — serializes all database write operations.
 * SQLite supports only one writer at a time; concurrent writes cause
 * WAL contention and SQLITE_BUSY errors. This module provides a
 * simple async queue-based mutex so callers wait in FIFO order.
 * See HLD Section S3.S.1.
 */

import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('write-mutex');

/** A waiter in the mutex queue with its resolve callback. */
interface MutexWaiter {
  resolve: (release: () => void) => void;
}

/**
 * Async mutex that serializes access to a shared resource.
 * Callers acquire the lock (waiting in a FIFO queue if held)
 * and release it when done.
 */
export interface DbWriteMutex {
  /**
   * Acquire the lock. If already held, the returned promise
   * resolves once all preceding callers have released.
   * @returns A release function that MUST be called when done.
   */
  acquire(): Promise<() => void>;

  /**
   * Convenience wrapper: acquires the lock, runs fn, then
   * releases the lock (even if fn throws).
   * @param fn - The function to run while holding the lock.
   * @returns The return value of fn.
   */
  withLock<T>(fn: () => T | Promise<T>): Promise<T>;
}

/**
 * Create a new DbWriteMutex instance.
 * The mutex uses an internal FIFO queue so writers are
 * processed in the order they called acquire().
 *
 * @returns A DbWriteMutex ready for use.
 */
export function createDbWriteMutex(): DbWriteMutex {
  let locked = false;
  const waiters: MutexWaiter[] = [];

  /** Release the lock and hand it to the next waiter if any. */
  function release(): void {
    if (waiters.length > 0) {
      const nextWaiter = waiters.shift()!;
      // Stay locked — hand off to next waiter
      log.debug({ queueLength: waiters.length }, 'Mutex handed to next waiter');
      nextWaiter.resolve(release);
    } else {
      locked = false;
      log.debug('Mutex released, no waiters');
    }
  }

  return {
    async acquire(): Promise<() => void> {
      if (!locked) {
        locked = true;
        log.debug('Mutex acquired immediately');
        return release;
      }

      log.debug({ queueLength: waiters.length + 1 }, 'Mutex busy, queuing waiter');
      return new Promise<() => void>((resolve) => {
        waiters.push({ resolve });
      });
    },

    async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
      const releaseFn = await this.acquire();
      try {
        return await fn();
      } finally {
        releaseFn();
      }
    },
  };
}
