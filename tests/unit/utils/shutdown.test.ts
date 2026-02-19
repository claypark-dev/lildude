import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('shutdown', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createShutdownHandler', () => {
    it('creates a handler without errors', async () => {
      const { createShutdownHandler } = await import('../../../src/utils/shutdown.js');
      const handler = createShutdownHandler();

      expect(handler).toBeDefined();
      expect(typeof handler.register).toBe('function');
      expect(typeof handler.shutdown).toBe('function');
      expect(typeof handler.isShuttingDown).toBe('function');
    });

    it('starts with isShuttingDown as false', async () => {
      const { createShutdownHandler } = await import('../../../src/utils/shutdown.js');
      const handler = createShutdownHandler();

      expect(handler.isShuttingDown()).toBe(false);
    });

    it('sets isShuttingDown to true after shutdown is called', async () => {
      const { createShutdownHandler } = await import('../../../src/utils/shutdown.js');
      const handler = createShutdownHandler();

      // Mock process.exit to prevent the test runner from exiting
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      await handler.shutdown();

      expect(handler.isShuttingDown()).toBe(true);

      exitSpy.mockRestore();
    });

    it('runs cleanup functions in reverse registration order', async () => {
      const { createShutdownHandler } = await import('../../../src/utils/shutdown.js');
      const handler = createShutdownHandler();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      const executionOrder: string[] = [];

      handler.register('first', async () => {
        executionOrder.push('first');
      });
      handler.register('second', async () => {
        executionOrder.push('second');
      });
      handler.register('third', async () => {
        executionOrder.push('third');
      });

      await handler.shutdown();

      expect(executionOrder).toEqual(['third', 'second', 'first']);

      exitSpy.mockRestore();
    });

    it('runs all cleanup functions even if one throws', async () => {
      const { createShutdownHandler } = await import('../../../src/utils/shutdown.js');
      const handler = createShutdownHandler();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      const executionOrder: string[] = [];

      handler.register('first', async () => {
        executionOrder.push('first');
      });
      handler.register('failing', async () => {
        executionOrder.push('failing');
        throw new Error('Cleanup error');
      });
      handler.register('third', async () => {
        executionOrder.push('third');
      });

      await handler.shutdown();

      // All three should have been called despite the error in 'failing'
      expect(executionOrder).toEqual(['third', 'failing', 'first']);

      exitSpy.mockRestore();
    });

    it('ignores duplicate shutdown calls', async () => {
      const { createShutdownHandler } = await import('../../../src/utils/shutdown.js');
      const handler = createShutdownHandler();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      let callCount = 0;

      handler.register('counter', async () => {
        callCount++;
      });

      await handler.shutdown();
      await handler.shutdown(); // duplicate call

      expect(callCount).toBe(1);

      exitSpy.mockRestore();
    });

    it('handles sync cleanup functions', async () => {
      const { createShutdownHandler } = await import('../../../src/utils/shutdown.js');
      const handler = createShutdownHandler();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      let called = false;

      handler.register('sync-cleanup', () => {
        called = true;
      });

      await handler.shutdown();

      expect(called).toBe(true);

      exitSpy.mockRestore();
    });

    it('handles empty registry without errors', async () => {
      const { createShutdownHandler } = await import('../../../src/utils/shutdown.js');
      const handler = createShutdownHandler();

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      // Should not throw with no registered cleanup functions
      await expect(handler.shutdown()).resolves.toBeUndefined();

      exitSpy.mockRestore();
    });
  });
});
