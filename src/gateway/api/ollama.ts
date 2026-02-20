/**
 * Ollama REST API proxy routes.
 * Provides endpoints for managing Ollama models from the web panel:
 *   - GET  /api/v1/ollama/status  — check if Ollama is running
 *   - GET  /api/v1/ollama/models  — list installed models
 *   - POST /api/v1/ollama/pull    — pull a model (streams progress via WS)
 *   - POST /api/v1/ollama/stop    — stop the Ollama process
 *
 * See Phase 3 of the onboarding sprint.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WSManager } from '../ws.js';
import { createModuleLogger, securityLogger } from '../../utils/logger.js';
import {
  isOllamaRunning,
  stopOllamaProcess,
  markOllamaManaged,
} from '../../providers/ollama-lifecycle.js';

const log = createModuleLogger('api-ollama');

const OLLAMA_BASE = 'http://localhost:11434';

/** Regex for valid Ollama model names */
const MODEL_NAME_PATTERN = /^[a-zA-Z0-9._:/-]+$/;

const PullModelSchema = z.object({
  model: z.string().min(1).regex(MODEL_NAME_PATTERN, 'Invalid model name'),
});

/**
 * Register Ollama API routes on the given Fastify instance.
 *
 * @param app - The Fastify server instance
 * @param wsManager - WebSocket manager for broadcasting pull progress
 */
export function registerOllamaRoutes(app: FastifyInstance, wsManager: WSManager): void {
  /**
   * GET /api/v1/ollama/status
   * Check whether Ollama is reachable and return its version.
   */
  app.get('/api/v1/ollama/status', async (_request, reply) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${OLLAMA_BASE}/api/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as { version?: string };
        return reply.send({ running: true, version: data.version ?? 'unknown' });
      }

      return reply.send({ running: false });
    } catch {
      return reply.send({ running: false });
    }
  });

  /**
   * GET /api/v1/ollama/models
   * List installed Ollama models. Returns 503 if Ollama is not running.
   */
  app.get('/api/v1/ollama/models', async (_request, reply) => {
    const running = await isOllamaRunning();
    if (!running) {
      return reply.status(503).send({ error: 'Ollama is not running', models: [] });
    }

    try {
      const response = await fetch(`${OLLAMA_BASE}/api/tags`);
      if (!response.ok) {
        return reply.status(502).send({ error: 'Failed to fetch models from Ollama', models: [] });
      }

      const data = (await response.json()) as {
        models?: Array<{
          name: string;
          size: number;
          digest: string;
          modified_at: string;
        }>;
      };

      const models = (data.models ?? []).map((m) => ({
        name: m.name,
        size: m.size,
        digest: m.digest,
        modifiedAt: m.modified_at,
      }));

      return reply.send({ models });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to list Ollama models');
      return reply.status(502).send({ error: 'Failed to communicate with Ollama', models: [] });
    }
  });

  /**
   * POST /api/v1/ollama/pull
   * Start pulling a model from the Ollama registry.
   * Progress is streamed to clients via WebSocket.
   */
  app.post('/api/v1/ollama/pull', async (request, reply) => {
    const parsed = PullModelSchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join('; ');
      return reply.status(400).send({ error: issues });
    }

    const { model } = parsed.data;

    const running = await isOllamaRunning();
    if (!running) {
      return reply.status(503).send({ error: 'Ollama is not running' });
    }

    securityLogger.info(
      { action: 'ollama_pull', model },
      'Starting Ollama model pull',
    );

    // Mark that we manage Ollama (for lifecycle shutdown)
    markOllamaManaged();

    // Start async pull in the background
    pullModelAsync(model, wsManager).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message, model }, 'Ollama model pull failed');
    });

    return reply.send({ status: 'started', model });
  });

  /**
   * POST /api/v1/ollama/stop
   * Gracefully stop the Ollama process.
   */
  app.post('/api/v1/ollama/stop', async (_request, reply) => {
    securityLogger.info(
      { action: 'ollama_stop' },
      'Stopping Ollama process via API',
    );

    try {
      await stopOllamaProcess();
      return reply.send({ ok: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to stop Ollama');
      return reply.status(500).send({ ok: false, error: message });
    }
  });
}

/**
 * Pull a model from Ollama, streaming NDJSON progress to WebSocket clients.
 *
 * @param model - The model name to pull (e.g. 'llama3.2')
 * @param wsManager - WebSocket manager for broadcasting progress events
 */
async function pullModelAsync(model: string, wsManager: WSManager): Promise<void> {
  log.info({ model }, 'Starting async model pull');

  const response = await fetch(`${OLLAMA_BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`Ollama pull failed (${response.status}): ${errorBody}`);
  }

  if (!response.body) {
    throw new Error('Ollama pull response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete NDJSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const progress = JSON.parse(trimmed) as {
            status?: string;
            completed?: number;
            total?: number;
          };

          wsManager.broadcast('*', {
            type: 'ollama_pull_progress',
            payload: {
              model,
              status: progress.status ?? 'unknown',
              completed: progress.completed ?? 0,
              total: progress.total ?? 0,
            },
            timestamp: new Date().toISOString(),
          });
        } catch {
          log.debug({ line: trimmed }, 'Skipping unparseable NDJSON line');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  log.info({ model }, 'Model pull completed');

  // Send final completion event
  wsManager.broadcast('*', {
    type: 'ollama_pull_progress',
    payload: {
      model,
      status: 'success',
      completed: 1,
      total: 1,
    },
    timestamp: new Date().toISOString(),
  });
}
