/**
 * TTS backend router.
 * Selects and initializes the appropriate TTS backend based on configuration.
 * Provides a single entry point for all text-to-speech operations.
 *
 * Backend selection order:
 * 1. Use the configured backend from voice.synthesis.backend
 * 2. If the configured backend is unavailable, fall back to 'say' (OS native)
 * 3. If no backends are available, throw a clear error
 *
 * The router also validates that the selected backend is compatible
 * with the current install tier (voice features require 'full' tier).
 */

import type { Config } from '../config/schema.js';
import type { InstallTier } from '../types/index.js';
import type {
  TtsBackend,
  TtsBackendName,
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
  TtsVoiceInfo,
} from './types.js';
import { createSayBackend } from './tts-say.js';
import { createKokoroBackend } from './tts-kokoro.js';
import { isFeatureEnabled } from '../tiers/feature-gate.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('tts-router');

/** Cached backend instance. */
let cachedBackend: TtsBackend | null = null;
let cachedBackendName: TtsBackendName | null = null;

/**
 * Create a TTS backend based on the backend name and config.
 *
 * @param backendName - The backend to create.
 * @param config - The full application config.
 * @returns The created TTS backend.
 */
function createBackend(backendName: TtsBackendName, config: Config): TtsBackend {
  switch (backendName) {
    case 'say':
      return createSayBackend();
    case 'kokoro':
      return createKokoroBackend(
        config.voice.synthesis.kokoroModelId,
        config.voice.synthesis.kokoroSpeaker,
      );
    case 'elevenlabs':
      // ElevenLabs is a cloud service — not implemented here
      // (user explicitly chose local backends over ElevenLabs)
      throw new Error(
        'ElevenLabs backend is not yet implemented. Use "say" or "kokoro" for local TTS.',
      );
    default:
      throw new Error(`Unknown TTS backend: ${backendName}`);
  }
}

/**
 * Get the active TTS backend, creating it if necessary.
 * Uses the configured backend or falls back to OS native TTS.
 *
 * @param config - The full application config.
 * @returns The active TTS backend.
 * @throws If no TTS backend is available.
 */
export async function getTtsBackend(config: Config): Promise<TtsBackend> {
  const configuredBackend = config.voice.synthesis.backend as TtsBackendName;

  // Return cached backend if still valid
  if (cachedBackend && cachedBackendName === configuredBackend) {
    return cachedBackend;
  }

  // Try the configured backend first
  const backend = createBackend(configuredBackend, config);
  const available = await backend.isAvailable();

  if (available) {
    cachedBackend = backend;
    cachedBackendName = configuredBackend;
    log.info({ backend: configuredBackend }, 'TTS backend initialized');
    return backend;
  }

  // Fall back to OS native TTS
  if (configuredBackend !== 'say') {
    log.warn(
      { configured: configuredBackend },
      'Configured TTS backend unavailable — falling back to OS native TTS',
    );
    const sayBackend = createSayBackend();
    const sayAvailable = await sayBackend.isAvailable();

    if (sayAvailable) {
      cachedBackend = sayBackend;
      cachedBackendName = 'say';
      return sayBackend;
    }
  }

  throw new Error(
    `No TTS backend available. Configured: ${configuredBackend}. ` +
    'Ensure your OS supports text-to-speech or install kokoro-js.',
  );
}

/**
 * Synthesize text to speech using the configured backend.
 * This is the main entry point for TTS operations.
 *
 * @param config - The full application config.
 * @param text - The text to synthesize.
 * @param tier - The current install tier (for gating).
 * @returns The synthesized audio result.
 * @throws If TTS is not enabled, not available at this tier, or synthesis fails.
 */
export async function synthesizeSpeech(
  config: Config,
  text: string,
  tier: InstallTier,
): Promise<TtsSynthesizeResult> {
  // Check if TTS is enabled in config
  if (!config.voice.enabled || !config.voice.synthesis.enabled) {
    throw new Error('Voice synthesis is not enabled in configuration');
  }

  // Check tier gating
  if (!isFeatureEnabled(tier, 'voice_synthesis')) {
    throw new Error(
      `Voice synthesis requires the "full" install tier. Current tier: ${tier}`,
    );
  }

  const backend = await getTtsBackend(config);

  const options: TtsSynthesizeOptions = {
    text,
    voice: config.voice.synthesis.backend === 'say'
      ? config.voice.synthesis.sayVoice
      : config.voice.synthesis.backend === 'kokoro'
        ? config.voice.synthesis.kokoroSpeaker
        : config.voice.synthesis.voiceId,
    rate: config.voice.synthesis.backend === 'say'
      ? config.voice.synthesis.sayRate
      : 1.0,
  };

  return backend.synthesize(options);
}

/**
 * List available voices for the configured TTS backend.
 *
 * @param config - The full application config.
 * @returns Array of available voices.
 */
export async function listAvailableVoices(config: Config): Promise<TtsVoiceInfo[]> {
  try {
    const backend = await getTtsBackend(config);
    return backend.listVoices();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ error: message }, 'Failed to list TTS voices');
    return [];
  }
}

/**
 * Check if TTS is available on the current system.
 *
 * @param config - The full application config.
 * @returns True if at least one TTS backend is available.
 */
export async function isTtsAvailable(config: Config): Promise<boolean> {
  try {
    await getTtsBackend(config);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset the cached backend (useful for testing or config changes).
 */
export function resetTtsCache(): void {
  cachedBackend = null;
  cachedBackendName = null;
}
