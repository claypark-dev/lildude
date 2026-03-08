/**
 * Wave card mapper.
 * Transforms registry entries + local data into display-ready wave cards
 * for the Waves Hub frontend. "Wave card" is the UI representation.
 */

import type { WaveRegistryEntry, ListedWave } from './hub-helpers.js';
import { getTrustTier, type TrustTier } from './community-trust.js';

/** Display-ready wave card for the Waves Hub UI. */
export interface WaveCard {
  /** Wave name (internal identifier). */
  name: string;
  /** Human-friendly display name. */
  displayName: string;
  /** Short description. */
  description: string;
  /** Author attribution. */
  author: string;
  /** Wave version. */
  version: string;
  /** Category for filtering (e.g., "productivity", "utilities"). */
  category: string;
  /** Search/filter tags. */
  tags: string[];
  /** Total install count (from registry + local). */
  installCount: number;
  /** Average user rating (1–5). */
  averageRating: number;
  /** Number of ratings. */
  ratingCount: number;
  /** Whether the wave is verified by the community. */
  verified: boolean;
  /** Whether the wave is featured. */
  featured: boolean;
  /** Whether this is a party wave (external-facing). */
  isPartyWave: boolean;
  /** Safety tier (observe, create, modify, destroy, execute). */
  safetyTier: string;
  /** Whether the wave uses deterministic execution. */
  deterministic: boolean;
  /** Whether the wave is installed locally. */
  installed: boolean;
  /** Source reference (e.g., "github:user/repo"). */
  source: string;
  /** Optional icon URL. */
  iconUrl: string | null;
  /** Total execution count (from local tracking). */
  executionCount: number;
  /** Success rate (0–1) across all executions. */
  successRate: number;
  /** Timestamp of last execution (ISO string or null). */
  lastExecutedAt: string | null;
  /** Community trust score (0–100). */
  trustScore: number | null;
  /** Community trust tier. */
  trustTier: TrustTier | null;
  /** Author profile for community waves. */
  authorProfile: {
    githubUsername: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  /** Timestamp when the wave was first published (ISO string). */
  publishedAt: string | null;
  /** Timestamp when the wave was last updated (ISO string). */
  updatedAt: string | null;
  /** SHA-256 package hash for integrity verification. */
  packageHash: string | null;
}

/** Local data to merge into a wave card. */
export interface LocalWaveData {
  installed: boolean;
  localInstallCount?: number;
  localAverageRating?: number;
  localRatingCount?: number;
  featured?: boolean;
  /** Total local execution count. */
  executionCount?: number;
  /** Local execution success rate (0–1). */
  successRate?: number;
  /** Last execution timestamp. */
  lastExecutedAt?: string | null;
  /** Community trust score (0–100). */
  trustScore?: number | null;
  /** Community trust tier. */
  trustTier?: TrustTier | null;
  /** Author profile for community waves. */
  authorProfile?: {
    githubUsername: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
}

/**
 * Convert a human-unfriendly wave name to a display name.
 * Capitalizes words and replaces hyphens with spaces.
 *
 * @param name - The wave name (e.g., "weather-checker").
 * @returns A display name (e.g., "Weather Checker").
 */
export function nameToDisplayName(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Map a registry entry + local data into a WaveCard for the UI.
 *
 * @param entry - The remote registry entry.
 * @param localData - Optional local data (installed status, local ratings).
 * @returns A display-ready WaveCard.
 */
export function registryEntryToWaveCard(
  entry: WaveRegistryEntry,
  localData: LocalWaveData = { installed: false },
): WaveCard {
  return {
    name: entry.name,
    displayName: nameToDisplayName(entry.name),
    description: entry.description,
    author: entry.author,
    version: entry.version,
    category: entry.category ?? 'uncategorized',
    tags: entry.tags ?? [],
    installCount: Math.max(entry.installCount ?? 0, localData.localInstallCount ?? 0),
    averageRating: localData.localAverageRating ?? entry.averageRating ?? 0,
    ratingCount: Math.max(entry.ratingCount ?? 0, localData.localRatingCount ?? 0),
    verified: entry.verified ?? false,
    featured: localData.featured ?? entry.featured ?? false,
    isPartyWave: entry.waveCategory === 'party',
    safetyTier: entry.safetyTier ?? 'observe',
    deterministic: entry.deterministic ?? false,
    installed: localData.installed,
    source: entry.source,
    iconUrl: entry.iconUrl ?? null,
    executionCount: localData.executionCount ?? 0,
    successRate: localData.successRate ?? 0,
    lastExecutedAt: localData.lastExecutedAt ?? null,
    trustScore: localData.trustScore ?? entry.communityTrust ?? null,
    trustTier: localData.trustTier ?? (entry.communityTrust != null ? getTrustTier(entry.communityTrust) : null),
    authorProfile: localData.authorProfile ?? null,
    publishedAt: entry.publishedAt ?? null,
    updatedAt: entry.updatedAt ?? null,
    packageHash: entry.packageHash ?? null,
  };
}

/**
 * Map a locally listed wave into a WaveCard.
 * Used for waves that exist locally but may not be in the remote registry.
 *
 * @param listedWave - The locally listed wave.
 * @returns A WaveCard with local-only data.
 */
export function listedWaveToWaveCard(listedWave: ListedWave): WaveCard {
  return {
    name: listedWave.name,
    displayName: nameToDisplayName(listedWave.name),
    description: '',
    author: listedWave.source === 'bundled' ? 'lil-dude' : 'unknown',
    version: listedWave.version,
    category: listedWave.waveCategory === 'party' ? 'party' : 'uncategorized',
    tags: [],
    installCount: 0,
    averageRating: 0,
    ratingCount: 0,
    verified: listedWave.source === 'bundled',
    featured: false,
    isPartyWave: listedWave.waveCategory === 'party',
    safetyTier: 'observe',
    deterministic: false,
    installed: true,
    source: listedWave.source,
    iconUrl: null,
    executionCount: 0,
    successRate: 0,
    lastExecutedAt: null,
    trustScore: null,
    trustTier: null,
    authorProfile: null,
    publishedAt: null,
    updatedAt: null,
    packageHash: null,
  };
}

/**
 * Merge remote registry entries with local wave data.
 * Registry entries get merged with install/rating data; local-only waves are appended.
 *
 * @param registryEntries - Remote registry entries.
 * @param localWaves - Locally listed waves.
 * @param localDataMap - Map of wave name to local data.
 * @returns Merged array of WaveCards.
 */
export function mergeRegistryWithLocal(
  registryEntries: WaveRegistryEntry[],
  localWaves: ListedWave[],
  localDataMap: Map<string, LocalWaveData>,
): WaveCard[] {
  const cards: WaveCard[] = [];
  const processedNames = new Set<string>();

  // Map registry entries with local overrides
  for (const entry of registryEntries) {
    const localData = localDataMap.get(entry.name) ?? { installed: false };
    const isInstalled = localWaves.some((w) => w.name === entry.name);
    cards.push(registryEntryToWaveCard(entry, { ...localData, installed: isInstalled }));
    processedNames.add(entry.name);
  }

  // Append local-only waves not in registry
  for (const localWave of localWaves) {
    if (!processedNames.has(localWave.name)) {
      cards.push(listedWaveToWaveCard(localWave));
    }
  }

  return cards;
}
