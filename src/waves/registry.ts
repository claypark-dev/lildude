/**
 * In-memory wave registry.
 * Maintains a map of loaded waves and provides trigger-based matching.
 * Waves are registered after validation and remain in memory for fast lookup.
 */

import type { Wave } from '../types/index.js';
import { createModuleLogger } from '../utils/logger.js';

const wavesLogger = createModuleLogger('wave-registry');

/** Result of a trigger match: the matched wave and a confidence score. */
export interface WaveMatch {
  wave: Wave;
  score: number;
}

/** In-memory store of registered waves, keyed by name. */
const wavesMap = new Map<string, Wave>();

/**
 * Register a wave in the in-memory registry.
 * If a wave with the same name already exists, it is overwritten and a warning is logged.
 * @param name - The unique wave name (from the manifest).
 * @param wave - The validated Wave object.
 */
export function registerWave(name: string, wave: Wave): void {
  if (wavesMap.has(name)) {
    wavesLogger.warn({ name }, 'Overwriting existing wave registration');
  }

  wavesMap.set(name, wave);
  wavesLogger.info({ name, triggers: wave.manifest.triggers }, 'Wave registered');
}

/**
 * Retrieve a wave by its exact name.
 * @param name - The wave name to look up.
 * @returns The Wave object, or undefined if not registered.
 */
export function getWave(name: string): Wave | undefined {
  return wavesMap.get(name);
}

/**
 * Match a user message against registered wave triggers.
 * Checks each wave's trigger keywords against the user message (case-insensitive).
 * Returns the wave with the highest match score, or null if no triggers match.
 * @param userMessage - The raw user message to match against wave triggers.
 * @returns The best matching wave and its score, or null if no match found.
 */
export function matchWave(userMessage: string): WaveMatch | null {
  const lowerMessage = userMessage.toLowerCase();
  let bestMatch: WaveMatch | null = null;

  for (const [, wave] of wavesMap) {
    const matchingTriggers = wave.manifest.triggers.filter(
      (trigger) => lowerMessage.includes(trigger.toLowerCase()),
    );

    if (matchingTriggers.length === 0) {
      continue;
    }

    const score = computeMatchScore(lowerMessage, matchingTriggers);

    if (bestMatch === null || score > bestMatch.score) {
      bestMatch = { wave, score };
    }
  }

  return bestMatch;
}

/**
 * Get all registered waves as an immutable Map snapshot.
 * @returns A new Map containing all registered waves.
 */
export function getAllWaves(): Map<string, Wave> {
  return new Map(wavesMap);
}

/**
 * Remove all registered waves from the registry.
 * Primarily used for testing to reset state between test runs.
 */
export function clearRegistry(): void {
  wavesMap.clear();
  wavesLogger.debug('Wave registry cleared');
}

/**
 * Maximum effective message length for coverage ratio calculation.
 * Without a cap, long messages (100+ chars) make it nearly impossible
 * for a few trigger words to reach a reasonable score, even when the
 * triggers are clearly relevant (e.g. "flight" in a 150-char travel
 * request). Capping the denominator ensures that trigger relevance is
 * evaluated consistently regardless of message verbosity.
 */
const COVERAGE_DENOMINATOR_CAP = 80;

/**
 * Compute a match score for a message against a set of matching triggers.
 * Score is based on the number of matching triggers and the proportion
 * of the message covered by those triggers (with a length cap to avoid
 * penalising long messages).
 * @param lowerMessage - The lowercased user message.
 * @param matchingTriggers - Triggers that were found in the message.
 * @returns A score between 0 and 1 (exclusive of 0).
 */
function computeMatchScore(lowerMessage: string, matchingTriggers: string[]): number {
  const triggerCoverage = matchingTriggers.reduce(
    (totalLength, trigger) => totalLength + trigger.length,
    0,
  );

  const effectiveLength = Math.min(lowerMessage.length, COVERAGE_DENOMINATOR_CAP);
  const coverageRatio = Math.min(triggerCoverage / effectiveLength, 1);
  const countBonus = Math.min(matchingTriggers.length * 0.1, 0.5);

  return coverageRatio + countBonus;
}

/**
 * Match a user message against only party wave triggers.
 * Used when routing external user messages — only party-category waves
 * should be considered for external contacts.
 *
 * @param userMessage - The raw user message to match against party wave triggers.
 * @returns The best matching party wave and its score, or null if no match found.
 */
export function matchPartyWave(userMessage: string): WaveMatch | null {
  const lowerMessage = userMessage.toLowerCase();
  let bestMatch: WaveMatch | null = null;

  for (const [, wave] of wavesMap) {
    // Only consider party-category waves
    if (wave.manifest.waveCategory !== 'party') {
      continue;
    }

    const matchingTriggers = wave.manifest.triggers.filter(
      (trigger) => lowerMessage.includes(trigger.toLowerCase()),
    );

    if (matchingTriggers.length === 0) {
      continue;
    }

    const score = computeMatchScore(lowerMessage, matchingTriggers);

    if (bestMatch === null || score > bestMatch.score) {
      bestMatch = { wave, score };
    }
  }

  return bestMatch;
}
