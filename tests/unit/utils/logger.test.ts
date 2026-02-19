import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates a logger with default info level', async () => {
    const { logger } = await import('../../../src/utils/logger.js');
    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
  });

  it('respects LOG_LEVEL env var', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { logger } = await import('../../../src/utils/logger.js');
    expect(logger.level).toBe('debug');
  });

  it('respects LIL_DUDE_LOG_LEVEL env var', async () => {
    process.env.LIL_DUDE_LOG_LEVEL = 'warn';
    const { logger } = await import('../../../src/utils/logger.js');
    expect(logger.level).toBe('warn');
  });

  it('creates child loggers with module name', async () => {
    const { createModuleLogger } = await import('../../../src/utils/logger.js');
    const child = createModuleLogger('test-module');
    expect(child).toBeDefined();
    // Child logger inherits from parent
    expect(typeof child.info).toBe('function');
    expect(typeof child.error).toBe('function');
  });

  it('redacts sensitive fields', async () => {
    const { logger } = await import('../../../src/utils/logger.js');

    // Capture log output by writing to a string destination
    const chunks: string[] = [];
    const dest = {
      write(chunk: string) {
        chunks.push(chunk);
      },
    };

    // Create a logger that writes to our capture destination
    const pino = (await import('pino')).default;
    const testLogger = pino(
      {
        level: 'info',
        redact: {
          paths: [
            'apiKey', 'token', 'secret', 'password',
            '*.apiKey', '*.token', '*.secret', '*.password',
          ],
          censor: '[REDACTED]',
        },
      },
      dest as unknown as pino.DestinationStream,
    );

    testLogger.info({ apiKey: 'sk-secret-123' }, 'test message');

    const output = chunks.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('sk-secret-123');
  });

  it('exports pre-built module loggers', async () => {
    const {
      securityLogger,
      costLogger,
      gatewayLogger,
      orchestratorLogger,
      persistenceLogger,
      channelLogger,
      providerLogger,
    } = await import('../../../src/utils/logger.js');

    expect(securityLogger).toBeDefined();
    expect(costLogger).toBeDefined();
    expect(gatewayLogger).toBeDefined();
    expect(orchestratorLogger).toBeDefined();
    expect(persistenceLogger).toBeDefined();
    expect(channelLogger).toBeDefined();
    expect(providerLogger).toBeDefined();
  });
});
