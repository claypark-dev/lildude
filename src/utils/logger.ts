/**
 * Logger module wrapping pino.
 * Provides child loggers per module with automatic redaction of secrets.
 * See HLD Section 5.1.
 */

import pino from 'pino';

const REDACT_PATHS = [
  'apiKey', 'token', 'secret', 'password',
  'api_key', 'api_token', 'access_token', 'refresh_token',
  '*.apiKey', '*.token', '*.secret', '*.password',
  '*.api_key', '*.api_token', '*.access_token', '*.refresh_token',
];

/** Create the root logger instance */
function createLogger(): pino.Logger {
  const level = process.env.LOG_LEVEL ?? process.env.LIL_DUDE_LOG_LEVEL ?? 'info';

  const transport = process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined;

  return pino({
    level,
    transport,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  });
}

/** Root logger instance */
export const logger = createLogger();

/** Create a child logger for a specific module */
export function createModuleLogger(moduleName: string): pino.Logger {
  return logger.child({ module: moduleName });
}

/** Pre-built module loggers for core subsystems */
export const securityLogger = createModuleLogger('security');
export const costLogger = createModuleLogger('cost');
export const gatewayLogger = createModuleLogger('gateway');
export const orchestratorLogger = createModuleLogger('orchestrator');
export const persistenceLogger = createModuleLogger('persistence');
export const channelLogger = createModuleLogger('channel');
export const providerLogger = createModuleLogger('provider');
