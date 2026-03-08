/**
 * Cron job execution handler.
 * Invoked by the cron runner when a scheduled job fires.
 * Loads the associated wave, re-executes it, and delivers
 * the output to the originating channel.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { CronJobRow } from '../persistence/cron-jobs.js';
import type { CronJobHandler } from './cron-runner.js';
import type { ChannelManager } from '../channels/index.js';
import type { LLMProvider, ChannelType } from '../types/index.js';
import type { WSManager } from '../gateway/ws.js';
import { getWave } from '../waves/registry.js';
import { executeWave } from '../waves/executor.js';
import { deleteCronJob } from '../persistence/cron-jobs.js';
import { createModuleLogger } from '../utils/logger.js';

const handlerLogger = createModuleLogger('cron-job-handler');

/** Dependencies needed to execute cron jobs and deliver results. */
export interface CronJobHandlerDeps {
  db: BetterSqlite3.Database;
  channelManager: ChannelManager;
  provider: LLMProvider;
  wsManager?: WSManager;
  enabledProviders: string[];
  securityLevel?: number;
  /** Per-task budget in USD for wave executions triggered by cron. */
  taskBudgetUsd?: number;
}

/**
 * Create a CronJobHandler function that executes waves and delivers results.
 *
 * @param deps - Dependencies for wave execution and channel delivery.
 * @returns A CronJobHandler callback for use with startCronRunner().
 */
export function createCronJobHandler(deps: CronJobHandlerDeps): CronJobHandler {
  return async (job: CronJobRow): Promise<void> => {
    const { id: jobId, waveId, taskDescription, channelType, channelId, expiresAt } = job;

    handlerLogger.info(
      { jobId, waveId, taskDescription, channelType },
      'Cron job fired',
    );

    // Check if job has expired
    if (expiresAt && new Date() >= expiresAt) {
      handlerLogger.info({ jobId }, 'Cron job expired, deleting');
      deleteCronJob(deps.db, jobId);
      return;
    }

    let outputText: string;

    // If there's a wave associated, re-execute it
    if (waveId) {
      const wave = getWave(waveId);
      if (!wave) {
        handlerLogger.warn({ jobId, waveId }, 'Wave not found for cron job, sending description');
        outputText = `⏰ Reminder: ${taskDescription}`;
      } else {
        try {
          const result = await executeWave(wave, taskDescription, {
            db: deps.db,
            provider: deps.provider,
            taskBudgetUsd: deps.taskBudgetUsd ?? 0.10,
            taskSpentUsd: 0,
            enabledProviders: deps.enabledProviders,
            securityLevel: deps.securityLevel,
          });

          if (result.success) {
            outputText = result.output;
          } else {
            handlerLogger.warn(
              { jobId, waveId, error: result.output },
              'Cron wave execution failed',
            );
            outputText = `⏰ Scheduled task "${taskDescription}" encountered an error: ${result.output}`;
          }
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          handlerLogger.error({ jobId, waveId, error: msg }, 'Cron wave execution threw');
          outputText = `⏰ Scheduled task "${taskDescription}" failed: ${msg}`;
        }
      }
    } else {
      // Plain reminder — just deliver the description
      outputText = `⏰ Reminder: ${taskDescription}`;
    }

    // Deliver to the originating channel
    if (channelType && channelId) {
      const adapter = deps.channelManager.getAdapter(channelType as ChannelType);
      if (adapter && adapter.isConnected()) {
        try {
          await adapter.send(channelId, outputText);
          handlerLogger.info(
            { jobId, channelType, channelId },
            'Cron job output delivered to channel',
          );
        } catch (sendError: unknown) {
          const msg = sendError instanceof Error ? sendError.message : String(sendError);
          handlerLogger.error(
            { jobId, channelType, error: msg },
            'Failed to deliver cron output to channel',
          );
        }
      } else {
        handlerLogger.warn(
          { jobId, channelType },
          'Channel adapter not available for cron delivery',
        );
      }
    }

    // Broadcast via WebSocket for the web panel
    if (deps.wsManager) {
      try {
        deps.wsManager.broadcast('*', {
          type: 'cron.fired',
          payload: {
            jobId,
            waveId,
            taskDescription,
            output: outputText,
            timestamp: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Non-critical — don't fail the job
      }
    }
  };
}
