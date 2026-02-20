/**
 * Voice synthesis REST API routes.
 * Provides endpoints for TTS from the web panel:
 *   - GET  /api/v1/voice/status     — check voice synthesis config
 *   - POST /api/v1/voice/synthesize — synthesize text to audio
 *
 * See Phase 4 of the onboarding sprint.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config/schema.js';
import { synthesizeSpeech } from '../../voice/synthesizer.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('api-voice');

const SynthesizeRequestSchema = z.object({
  text: z.string().min(1, 'Text is required').max(5000, 'Text too long (max 5000 chars)'),
});

/**
 * Register voice API routes on the given Fastify instance.
 *
 * @param app - The Fastify server instance
 * @param config - The application configuration
 */
export function registerVoiceRoutes(app: FastifyInstance, config: Config): void {
  /**
   * GET /api/v1/voice/status
   * Returns voice synthesis availability and backend configuration.
   */
  app.get('/api/v1/voice/status', async (_request, reply) => {
    const synthesisConfig = config.voice.synthesis;

    return reply.send({
      enabled: synthesisConfig.enabled,
      backend: synthesisConfig.backend,
      hasApiKey: Boolean(synthesisConfig.elevenLabsApiKey),
    });
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
      const result = await synthesizeSpeech(text, {
        backend: config.voice.synthesis.backend,
        apiKey: config.voice.synthesis.elevenLabsApiKey,
        voiceId: config.voice.synthesis.voiceId,
      });

      if (result.audioData.length === 0) {
        return reply.status(503).send({
          error: 'Voice synthesis backend returned no audio data. Check your configuration.',
        });
      }

      return reply
        .header('Content-Type', result.mimeType)
        .header('Content-Length', result.audioData.length)
        .send(result.audioData);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Voice synthesis failed');
      return reply.status(500).send({ error: `Synthesis failed: ${message}` });
    }
  });
}
