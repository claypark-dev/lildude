/**
 * Feature gating by install tier.
 * Determines which features, channels, and waves are available
 * for a given install tier (lite / standard / full).
 *
 * Tiers are additive — each higher tier includes everything from lower tiers.
 * - lite: Core agent, webchat + 2 channels, basic deterministic waves
 * - standard: All channels, browser automation, all waves, local models via Ollama
 * - full: Everything + voice (TTS/STT), large local models, custom voice profiles
 */

import type { InstallTier } from '../types/index.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('feature-gate');

/** Features that can be gated by tier. */
export type GatedFeature =
  | 'webchat'
  | 'channels_basic'       // Up to 2 messaging channels
  | 'channels_all'         // Unlimited messaging channels
  | 'browser_automation'
  | 'local_models'
  | 'voice_transcription'
  | 'voice_synthesis'
  | 'party_waves'
  | 'waves_hub'
  | 'deterministic_waves'  // Waves that don't use LLM
  | 'ai_waves'             // Waves that require LLM
  | 'integrations'         // Google/Microsoft OAuth integrations
  | 'model_routing'        // Smart model routing across providers
  | 'quality_checks';      // Post-LLM quality validation

/** Maximum number of messaging channels allowed per tier. */
const CHANNEL_LIMITS: Record<InstallTier, number> = {
  lite: 2,
  standard: 10,
  full: 10,
};

/** Maximum monthly budget allowed per tier (USD). */
const BUDGET_LIMITS: Record<InstallTier, number> = {
  lite: 10,
  standard: 50,
  full: 200,
};

/** Maximum concurrent task executions per tier. */
const CONCURRENT_TASK_LIMITS: Record<InstallTier, number> = {
  lite: 1,
  standard: 5,
  full: 10,
};

/** Feature availability matrix. */
const FEATURE_MATRIX: Record<GatedFeature, Set<InstallTier>> = {
  webchat: new Set(['lite', 'standard', 'full']),
  channels_basic: new Set(['lite', 'standard', 'full']),
  channels_all: new Set(['standard', 'full']),
  browser_automation: new Set(['standard', 'full']),
  local_models: new Set(['standard', 'full']),
  voice_transcription: new Set(['full']),
  voice_synthesis: new Set(['full']),
  party_waves: new Set(['standard', 'full']),
  waves_hub: new Set(['standard', 'full']),
  deterministic_waves: new Set(['lite', 'standard', 'full']),
  ai_waves: new Set(['lite', 'standard', 'full']),
  integrations: new Set(['standard', 'full']),
  model_routing: new Set(['standard', 'full']),
  quality_checks: new Set(['standard', 'full']),
};

/**
 * Check if a feature is enabled for the given install tier.
 *
 * @param tier - The current install tier.
 * @param feature - The feature to check.
 * @returns True if the feature is available at the given tier.
 */
export function isFeatureEnabled(tier: InstallTier, feature: GatedFeature): boolean {
  const allowed = FEATURE_MATRIX[feature];
  if (!allowed) {
    log.warn({ feature, tier }, 'Unknown gated feature queried');
    return false;
  }
  return allowed.has(tier);
}

/**
 * Get the maximum number of messaging channels for the given tier.
 *
 * @param tier - The current install tier.
 * @returns Maximum number of channels.
 */
export function getChannelLimit(tier: InstallTier): number {
  return CHANNEL_LIMITS[tier];
}

/**
 * Get the maximum monthly budget for the given tier.
 *
 * @param tier - The current install tier.
 * @returns Maximum monthly budget in USD.
 */
export function getBudgetLimit(tier: InstallTier): number {
  return BUDGET_LIMITS[tier];
}

/**
 * Get the maximum concurrent task executions for the given tier.
 *
 * @param tier - The current install tier.
 * @returns Maximum concurrent tasks.
 */
export function getConcurrentTaskLimit(tier: InstallTier): number {
  return CONCURRENT_TASK_LIMITS[tier];
}

/**
 * Get all features enabled for the given tier.
 *
 * @param tier - The current install tier.
 * @returns Array of feature names enabled at this tier.
 */
export function getEnabledFeatures(tier: InstallTier): GatedFeature[] {
  const enabled: GatedFeature[] = [];
  for (const [feature, tiers] of Object.entries(FEATURE_MATRIX)) {
    if (tiers.has(tier)) {
      enabled.push(feature as GatedFeature);
    }
  }
  return enabled;
}

/**
 * Get a human-friendly summary of what each tier provides.
 *
 * @returns A record mapping each tier to a description.
 */
export function getTierDescriptions(): Record<InstallTier, TierDescription> {
  return {
    lite: {
      name: 'Lite',
      ramRequirement: '4-8 GB',
      cpuRequirement: '2+ cores',
      gpuRequired: false,
      description: 'Core agent with webchat and up to 2 messaging channels. Cloud LLM only.',
      highlights: [
        'Core message pipeline',
        'Webchat + 2 channels',
        'Cloud LLM providers',
        'Basic deterministic waves',
        'Low memory footprint (~60 MB)',
      ],
      channelLimit: CHANNEL_LIMITS.lite,
      budgetLimit: BUDGET_LIMITS.lite,
      concurrentTasks: CONCURRENT_TASK_LIMITS.lite,
    },
    standard: {
      name: 'Standard',
      ramRequirement: '16 GB',
      cpuRequirement: '4+ cores',
      gpuRequired: false,
      description: 'Full executive assistant with all channels, browser automation, and all waves.',
      highlights: [
        'All messaging channels',
        'Browser automation',
        'All 16+ bundled waves',
        'Party waves for external contacts',
        'Waves Hub marketplace',
        'Local models via Ollama',
        'Google & Microsoft integrations',
        'Up to 5 concurrent tasks',
      ],
      channelLimit: CHANNEL_LIMITS.standard,
      budgetLimit: BUDGET_LIMITS.standard,
      concurrentTasks: CONCURRENT_TASK_LIMITS.standard,
    },
    full: {
      name: 'Full',
      ramRequirement: '32+ GB',
      cpuRequirement: '4+ cores',
      gpuRequired: true,
      description: 'Everything plus voice, local TTS, and large local models.',
      highlights: [
        'Everything in Standard',
        'Voice transcription (local Whisper or cloud)',
        'Text-to-speech (local or cloud)',
        'Larger local models (13B+)',
        'Custom voice profiles',
        'Up to 10 concurrent tasks',
      ],
      channelLimit: CHANNEL_LIMITS.full,
      budgetLimit: BUDGET_LIMITS.full,
      concurrentTasks: CONCURRENT_TASK_LIMITS.full,
    },
  };
}

/** Description of what an install tier provides. */
export interface TierDescription {
  name: string;
  ramRequirement: string;
  cpuRequirement: string;
  gpuRequired: boolean;
  description: string;
  highlights: string[];
  channelLimit: number;
  budgetLimit: number;
  concurrentTasks: number;
}

/**
 * Map a wave's minTier to an InstallTier.
 * Wave manifests use 'basic' | 'standard' | 'power', which maps to our tier system.
 *
 * @param waveMinTier - The wave's minimum tier requirement.
 * @returns The corresponding InstallTier.
 */
export function waveMinTierToInstallTier(waveMinTier: string): InstallTier {
  switch (waveMinTier) {
    case 'basic':
      return 'lite';
    case 'standard':
      return 'standard';
    case 'power':
      return 'full';
    default:
      return 'lite';
  }
}

/**
 * Check if a wave can run at the given install tier.
 *
 * @param tier - The current install tier.
 * @param waveMinTier - The wave's minimum tier requirement ('basic' | 'standard' | 'power').
 * @returns True if the wave can run at the given tier.
 */
export function canRunWave(tier: InstallTier, waveMinTier: string): boolean {
  const tierOrder: InstallTier[] = ['lite', 'standard', 'full'];
  const requiredTier = waveMinTierToInstallTier(waveMinTier);
  return tierOrder.indexOf(tier) >= tierOrder.indexOf(requiredTier);
}
