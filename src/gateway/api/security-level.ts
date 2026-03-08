/**
 * Security level hot-reload endpoint.
 * PUT /api/v1/security/level — Update the runtime security level without restarting.
 */

import type { FastifyInstance } from 'fastify';
import type { AgentLoop } from '../../orchestrator/agent-loop-helpers.js';
import type { SecurityLevel } from '../../security/permissions.js';
import type { Config } from '../../config/schema.js';
import { saveConfig } from '../../config/loader.js';
import { appendSecurityLog } from '../../persistence/security-log.js';
import type BetterSqlite3 from 'better-sqlite3';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('api-security-level');

/** Valid security levels. */
const VALID_LEVELS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

/** Request body for updating the security level. */
interface UpdateSecurityLevelBody {
  level: number;
}

/**
 * Register the security level hot-reload route.
 * Called from index.ts after both gateway and agentLoop are created.
 *
 * @param app - The Fastify server instance.
 * @param db - The database connection for audit logging.
 * @param agentLoop - The agent loop to update at runtime.
 * @param config - The mutable config object (persisted to disk on change).
 */
export function registerSecurityLevelRoute(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
  agentLoop: AgentLoop,
  config: Config,
): void {
  app.put<{ Body: UpdateSecurityLevelBody }>(
    '/api/v1/security/level',
    async (request, reply) => {
      try {
        const { level } = request.body as UpdateSecurityLevelBody;

        if (level === undefined || level === null) {
          return reply.status(400).send({ error: 'Missing required field: level' });
        }

        if (!VALID_LEVELS.has(level)) {
          return reply.status(400).send({
            error: `Invalid security level: ${level}. Must be 1-5.`,
          });
        }

        const previousLevel = config.security.level;
        const newLevel = level as SecurityLevel;

        // Update runtime agent loop
        agentLoop.updateSecurityLevel(newLevel);

        // Update in-memory config
        config.security.level = newLevel;

        // Persist to config.json
        await saveConfig(config);

        // Audit log
        appendSecurityLog(db, {
          actionType: 'security_level_change',
          actionDetail: `Security level changed from ${previousLevel} to ${newLevel}`,
          allowed: true,
          securityLevel: newLevel,
          reason: 'User-initiated hot-reload via web panel',
        });

        log.info({ previousLevel, newLevel }, 'Security level hot-reloaded');

        return reply.status(200).send({
          ok: true,
          previousLevel,
          currentLevel: newLevel,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ error: message }, 'Failed to update security level');
        return reply.status(500).send({
          error: 'Failed to update security level',
          detail: message,
        });
      }
    },
  );

  log.debug('Security level hot-reload route registered');
}
