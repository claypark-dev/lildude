/**
 * Voice synthesis REST API routes.
 * Provides endpoints for TTS from the web panel:
 *   - GET  /api/v1/voice/status     — check voice synthesis config
 *   - GET  /api/v1/voice/voices     — list available voices
 *   - POST /api/v1/voice/synthesize — synthesize text to audio
 *
 * Uses the TTS router which selects say/kokoro/elevenlabs backends.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config/schema.js';
import type { InstallTier } from '../../types/index.js';
import {
  synthesizeSpeech,
  listAvailableVoices,
  isTtsAvailable,
} from '../../voice/tts-router.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('api-voice');

const SynthesizeRequestSchema = z.object({
  text: z.string().min(1, 'Text is required').max(5000, 'Text too long (max 5000 chars)'),
});

/**
 * Register voice API routes on the given Fastify instance.
 *
 * @param app - The Fastify server instance.
 * @param config - The application configuration.
 * @param getTier - Callback returning the current install tier.
 */
export function registerVoiceRoutes(
  app: FastifyInstance,
  config: Config,
  getTier: () => InstallTier,
): void {
  /**
   * GET /api/v1/voice/status
   * Returns voice synthesis availability and backend configuration.
   */
  app.get('/api/v1/voice/status', async (_request, reply) => {
    try {
      const synthesisConfig = config.voice.synthesis;
      const available = await isTtsAvailable(config);

      return reply.send({
        enabled: synthesisConfig.enabled,
        backend: synthesisConfig.backend,
        available,
        hasApiKey: Boolean(synthesisConfig.elevenLabsApiKey),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to check voice status');
      return reply.status(500).send({ error: 'Failed to check voice status' } as never);
    }
  });

  /**
   * GET /api/v1/voice/voices
   * List available voices for the configured TTS backend.
   */
  app.get('/api/v1/voice/voices', async (_request, reply) => {
    try {
      const voices = await listAvailableVoices(config);
      return reply.send({ voices, backend: config.voice.synthesis.backend });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to list voices');
      return reply.status(500).send({ error: 'Failed to list voices' } as never);
    }
  });

  /**
   * POST /api/v1/voice/synthesize
   * Synthesize text to audio. Returns audio binary with appropriate headers.
   */
  app.post('/api/v1/voice/synthesize', async (request, reply) => {
    // Check if voice synthesis is enabled
    if (!config.voice.synthesis.enabled) {
      return reply.status(503).send({
        error: 'Voice synthesis is not enabled. Enable it in Settings.',
      });
    }

    const parsed = SynthesizeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join('; ');
      return reply.status(400).send({ error: issues });
    }

    const { text } = parsed.data;

    try {
      const tier = getTier();
      const result = await synthesizeSpeech(config, text, tier);

      if (result.audio.length === 0) {
        return reply.status(503).send({
          error: 'Voice synthesis backend returned no audio data. Check your configuration.',
        });
      }

      const mimeType = result.format === 'mp3' ? 'audio/mpeg' : 'audio/wav';

      return reply
        .header('Content-Type', mimeType)
        .header('Content-Length', result.audio.length)
        .send(result.audio);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Voice synthesis failed');
      return reply.status(500).send({ error: `Synthesis failed: ${message}` });
    }
  });
}
