/**
 * Voice configuration API routes.
 * GET  /api/v1/voice/config  — Retrieve full voice configuration.
 * PUT  /api/v1/voice/config  — Update voice configuration (hot-reload, persists to disk).
 * POST /api/v1/voice/preview — Quick text-to-speech preview with current settings.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config/schema.js';
import type { InstallTier } from '../../types/index.js';
import { saveConfig } from '../../config/loader.js';
import {
  synthesizeSpeech,
  listAvailableVoices,
  resetTtsCache,
  type VoiceOverrides,
} from '../../voice/tts-router.js';
import { createModuleLogger } from '../../utils/logger.js';

const log = createModuleLogger('api-voice-config');

/** Schema for updating voice configuration. */
const UpdateVoiceConfigSchema = z.object({
  enabled: z.boolean().optional(),
  synthesis: z.object({
    enabled: z.boolean().optional(),
    backend: z.enum(['say', 'kokoro', 'elevenlabs']).optional(),
    elevenLabsApiKey: z.string().optional(),
    voiceId: z.string().optional(),
    sayVoice: z.string().optional(),
    sayRate: z.number().min(0.1).max(3.0).optional(),
    kokoroSpeaker: z.string().optional(),
    kokoroModelId: z.string().optional(),
    autoSpeak: z.boolean().optional(),
  }).optional(),
  transcription: z.object({
    backend: z.enum(['groq', 'local']).optional(),
    groqApiKey: z.string().optional(),
    language: z.string().optional(),
  }).optional(),
});

const PreviewRequestSchema = z.object({
  text: z.string().min(1, 'Text is required').max(500, 'Preview text too long (max 500 chars)'),
  /** Optional voice overrides so the preview uses unsaved form selections. */
  backend: z.enum(['say', 'kokoro', 'elevenlabs']).optional(),
  sayVoice: z.string().optional(),
  sayRate: z.number().min(0.1).max(3.0).optional(),
  kokoroSpeaker: z.string().optional(),
  voiceId: z.string().optional(),
});

/**
 * Register voice configuration API routes.
 *
 * @param app - The Fastify server instance.
 * @param config - The mutable application configuration.
 * @param getTier - Callback returning the current install tier.
 */
export function registerVoiceConfigRoutes(
  app: FastifyInstance,
  config: Config,
  getTier: () => InstallTier,
): void {
  /**
   * GET /api/v1/voice/config
   * Return the full voice configuration with available voices per backend.
   */
  app.get('/api/v1/voice/config', async (_request, reply) => {
    try {
      const voices = await listAvailableVoices(config).catch(() => []);

      return reply.send({
        enabled: config.voice.enabled,
        synthesis: {
          enabled: config.voice.synthesis.enabled,
          backend: config.voice.synthesis.backend,
          voiceId: config.voice.synthesis.voiceId,
          sayVoice: config.voice.synthesis.sayVoice ?? null,
          sayRate: config.voice.synthesis.sayRate,
          kokoroSpeaker: config.voice.synthesis.kokoroSpeaker,
          kokoroModelId: config.voice.synthesis.kokoroModelId,
          hasElevenLabsApiKey: Boolean(config.voice.synthesis.elevenLabsApiKey),
          autoSpeak: config.voice.synthesis.autoSpeak,
        },
        transcription: {
          backend: config.voice.transcription.backend,
          language: config.voice.transcription.language,
          hasGroqApiKey: Boolean(config.voice.transcription.groqApiKey),
        },
        availableVoices: voices,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to fetch voice config');
      return reply.status(500).send({ error: 'Failed to fetch voice config' });
    }
  });

  /**
   * PUT /api/v1/voice/config
   * Update voice configuration, persist to disk, and reset TTS cache.
   */
  app.put('/api/v1/voice/config', async (request, reply) => {
    const parsed = UpdateVoiceConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(400).send({ error: issues });
    }

    try {
      const updates = parsed.data;

      // Apply updates to in-memory config
      if (updates.enabled !== undefined) {
        config.voice.enabled = updates.enabled;
      }
      if (updates.synthesis) {
        const s = updates.synthesis;
        if (s.enabled !== undefined) config.voice.synthesis.enabled = s.enabled;
        if (s.backend !== undefined) config.voice.synthesis.backend = s.backend;
        if (s.elevenLabsApiKey !== undefined) config.voice.synthesis.elevenLabsApiKey = s.elevenLabsApiKey;
        if (s.voiceId !== undefined) config.voice.synthesis.voiceId = s.voiceId;
        if (s.sayVoice !== undefined) config.voice.synthesis.sayVoice = s.sayVoice;
        if (s.sayRate !== undefined) config.voice.synthesis.sayRate = s.sayRate;
        if (s.kokoroSpeaker !== undefined) config.voice.synthesis.kokoroSpeaker = s.kokoroSpeaker;
        if (s.kokoroModelId !== undefined) config.voice.synthesis.kokoroModelId = s.kokoroModelId;
        if (s.autoSpeak !== undefined) config.voice.synthesis.autoSpeak = s.autoSpeak;
      }
      if (updates.transcription) {
        const t = updates.transcription;
        if (t.backend !== undefined) config.voice.transcription.backend = t.backend;
        if (t.groqApiKey !== undefined) config.voice.transcription.groqApiKey = t.groqApiKey;
        if (t.language !== undefined) config.voice.transcription.language = t.language;
      }

      // Reset TTS backend cache so the new config takes effect immediately
      resetTtsCache();

      // Persist to disk
      await saveConfig(config);

      log.info({ backend: config.voice.synthesis.backend }, 'Voice config updated');

      return reply.send({
        ok: true,
        voice: {
          enabled: config.voice.enabled,
          synthesis: {
            enabled: config.voice.synthesis.enabled,
            backend: config.voice.synthesis.backend,
          },
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Failed to update voice config');
      return reply.status(500).send({ error: 'Failed to save voice config' });
    }
  });

  /**
   * POST /api/v1/voice/preview
   * Quick text-to-speech preview using current config.
   * Returns audio binary.
   */
  app.post('/api/v1/voice/preview', async (request, reply) => {
    const parsed = PreviewRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join('; ');
      return reply.status(400).send({ error: issues });
    }

    try {
      const tier = getTier();
      const { text, backend: ovBackend, sayVoice, sayRate, kokoroSpeaker, voiceId } = parsed.data;
      const overrides: VoiceOverrides | undefined =
        (ovBackend || sayVoice || sayRate !== undefined || kokoroSpeaker || voiceId)
          ? { backend: ovBackend, sayVoice, sayRate, kokoroSpeaker, voiceId }
          : undefined;
      const result = await synthesizeSpeech(config, text, tier, overrides);

      if (result.audio.length === 0) {
        return reply.status(503).send({
          error: 'Voice synthesis returned no audio. Check backend configuration.',
        });
      }

      const mimeType = result.format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
      return reply
        .header('Content-Type', mimeType)
        .header('Content-Length', result.audio.length)
        .send(result.audio);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, 'Voice preview failed');
      return reply.status(500).send({ error: `Preview failed: ${message}` });
    }
  });

  log.debug('Voice config routes registered');
}
