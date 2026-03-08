/**
 * Remote Wave Hub registry.
 * Fetches the curated wave registry from a remote URL (GitHub JSON)
 * with 24-hour caching in SQLite. Returns an empty list if the remote
 * fetch and all caches fail.
 * Supports update checking for installed waves.
 */

import type BetterSqlite3 from 'better-sqlite3';
import {
  getCachedRegistry,
  setCachedRegistry,
  getCachedEtag,
} from '../persistence/wave-hub-cache.js';
import { createModuleLogger } from '../utils/logger.js';
import type { WaveRegistryEntry } from './hub-helpers.js';
import { listWaves } from './hub.js';

const registryLogger = createModuleLogger('hub-registry');

// ── In-memory request coalescing ─────────────────────────────────────────
// When the hub page loads, it fires multiple API calls (featured, browse,
// categories, stats) all of which call fetchRegistry(). This cache prevents
// redundant SQLite reads and network fetches within a short window.

/** In-memory cache entry. */
interface MemoryCacheEntry {
  waves: WaveRegistryEntry[];
  expiresAt: number;
}

/** In-memory cache TTL in milliseconds (5 seconds — short enough to stay fresh). */
const MEMORY_CACHE_TTL_MS = 5_000;

/** In-memory cache keyed by registry URL. */
const memoryCache = new Map<string, MemoryCacheEntry>();

/** Pending fetch promises for request coalescing (deduplicates concurrent calls). */
const pendingFetches = new Map<string, Promise<WaveRegistryEntry[]>>();

/**
 * Clear the in-memory registry cache. Useful for testing.
 */
export function clearRegistryMemoryCache(): void {
  memoryCache.clear();
  pendingFetches.clear();
}

/** Default registry URL (GitHub raw JSON). */
const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/clapyark/wave-registry/main/registry.json';

/** Default cache TTL in hours. */
const DEFAULT_CACHE_TTL_HOURS = 24;

/** Schema for v1 registry JSON. */
interface RegistryJsonV1 {
  version: string;
  waves: WaveRegistryEntry[];
}

/** Schema for v2 registry JSON (with categories and featured list). */
interface RegistryJsonV2 {
  version: string;
  categories?: string[];
  featured?: string[];
  waves: WaveRegistryEntry[];
}

/** Category definition for v3 registry. */
export interface CategoryDefinition {
  name: string;
  displayName: string;
  description: string;
  icon?: string;
}

/** Schema for v3 registry JSON (with community trust data and category definitions). */
interface RegistryJsonV3 {
  version: string;
  generatedAt: string;
  categories: CategoryDefinition[];
  featured: string[];
  waves: WaveRegistryEntry[];
}

/** Union of v1, v2, and v3 registry shapes. */
type RegistryJson = RegistryJsonV1 | RegistryJsonV2 | RegistryJsonV3;

/**
 * Detect the registry format version from the payload.
 * v3: has `generatedAt` field and version starts with "3."
 * v2: has `featured` or `categories` arrays
 * v1: just has `waves` array
 *
 * @param raw - The parsed JSON object.
 * @returns The detected version: 1, 2, or 3.
 */
export function detectRegistryVersion(raw: RegistryJson): 1 | 2 | 3 {
  if ('generatedAt' in raw && raw.version?.startsWith('3')) return 3;
  if ('featured' in raw || 'categories' in raw) return 2;
  return 1;
}

/**
 * Parse a registry JSON payload, supporting v1, v2, and v3 formats.
 * v2 adds optional `featured` and `categories` arrays.
 * v3 adds `generatedAt`, typed category definitions, and per-wave
 * community trust data (publishedAt, packageHash, communityTrust, etc.).
 *
 * @param raw - The parsed JSON object.
 * @returns Array of enriched wave registry entries.
 */
export function parseRegistryPayload(raw: RegistryJson): WaveRegistryEntry[] {
  if (!Array.isArray(raw.waves)) {
    throw new Error('Invalid registry format: missing waves array');
  }

  const version = detectRegistryVersion(raw);

  if (version === 1) return raw.waves;

  const featuredSet = new Set(
    'featured' in raw && Array.isArray(raw.featured) ? raw.featured : [],
  );

  return raw.waves.map((wave) => ({
    ...wave,
    featured: wave.featured ?? featuredSet.has(wave.name),
  }));
}

/**
 * Fetch the wave registry with three cache layers:
 * 1. In-memory cache (5s TTL) — avoids repeated reads during a single page load
 * 2. SQLite cache (24h TTL) — persists across server restarts
 * 3. Remote fetch with ETag — only downloads when content changes
 *
 * Concurrent calls to the same URL are coalesced (only one fetch runs).
 * Returns an empty list on all failures (community waves now live in the remote registry).
 *
 * @param db - The database instance.
 * @param registryUrl - The registry URL to fetch from.
 * @param cacheTtlHours - SQLite cache TTL in hours.
 * @returns Array of wave registry entries.
 */
export async function fetchRegistry(
  db: BetterSqlite3.Database,
  registryUrl = DEFAULT_REGISTRY_URL,
  cacheTtlHours = DEFAULT_CACHE_TTL_HOURS,
): Promise<WaveRegistryEntry[]> {
  // Layer 1: In-memory cache (ultra-fast, short-lived)
  const memoryCached = memoryCache.get(registryUrl);
  if (memoryCached && Date.now() < memoryCached.expiresAt) {
    registryLogger.debug({ registryUrl }, 'Using in-memory cached registry');
    return memoryCached.waves;
  }

  // Request coalescing: if another call is already fetching, piggyback on it
  const pending = pendingFetches.get(registryUrl);
  if (pending) {
    registryLogger.debug({ registryUrl }, 'Coalescing registry request');
    return pending;
  }

  // Start the actual fetch and register it for coalescing
  const fetchPromise = fetchRegistryInternal(db, registryUrl, cacheTtlHours);
  pendingFetches.set(registryUrl, fetchPromise);

  try {
    const waves = await fetchPromise;

    // Store in memory cache
    memoryCache.set(registryUrl, {
      waves,
      expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
    });

    return waves;
  } finally {
    pendingFetches.delete(registryUrl);
  }
}

/**
 * Internal registry fetch — handles SQLite cache and remote fetch.
 * Called by fetchRegistry() after memory cache miss.
 */
async function fetchRegistryInternal(
  db: BetterSqlite3.Database,
  registryUrl: string,
  cacheTtlHours: number,
): Promise<WaveRegistryEntry[]> {
  // Layer 2: SQLite cache
  try {
    const cached = getCachedRegistry(db, registryUrl);
    if (cached) {
      registryLogger.debug({ registryUrl }, 'Using SQLite cached registry');
      const parsed = JSON.parse(cached.data) as RegistryJson;
      return parseRegistryPayload(parsed);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    registryLogger.warn({ error: message }, 'Failed to read registry cache');
  }

  // Layer 3: Remote fetch
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'lil-dude-hub/1.0',
    };

    // Conditional fetch with ETag
    const cachedEtag = getCachedEtag(db, registryUrl);
    if (cachedEtag) {
      headers['If-None-Match'] = cachedEtag;
    }

    const response = await fetch(registryUrl, { headers, signal: AbortSignal.timeout(10000) });

    if (response.status === 304) {
      // Not modified — extend cache TTL
      registryLogger.debug('Registry not modified (304), extending cache');
      const existingCached = getCachedRegistry(db, registryUrl);
      if (existingCached) {
        setCachedRegistry(db, registryUrl, existingCached.data, cacheTtlHours, cachedEtag ?? undefined);
        const parsed = JSON.parse(existingCached.data) as RegistryJson;
        return parseRegistryPayload(parsed);
      }
    }

    if (!response.ok) {
      throw new Error(`Registry fetch failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.text();
    const parsed = JSON.parse(data) as RegistryJson;

    // Validate and parse (supports both v1 and v2 formats)
    const waves = parseRegistryPayload(parsed);

    // Cache the result
    const etag = response.headers.get('ETag') ?? undefined;
    setCachedRegistry(db, registryUrl, data, cacheTtlHours, etag);

    registryLogger.info(
      { registryUrl, waveCount: waves.length, version: parsed.version },
      'Registry fetched and cached',
    );

    return waves;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    registryLogger.warn(
      { registryUrl, error: message },
      'Failed to fetch remote registry, returning empty list',
    );
    return [];
  }
}

/**
 * Search the registry for waves matching a query string.
 * Matches against name, description, and triggers.
 *
 * @param waves - The registry entries to search.
 * @param query - The search query.
 * @returns Matching registry entries.
 */
export function searchRegistry(
  waves: WaveRegistryEntry[],
  query: string,
): WaveRegistryEntry[] {
  const lowerQuery = query.toLowerCase();

  return waves.filter((entry) => {
    const nameMatch = entry.name.toLowerCase().includes(lowerQuery);
    const descMatch = entry.description.toLowerCase().includes(lowerQuery);
    const triggerMatch = entry.triggers.some(
      (trigger) => trigger.toLowerCase().includes(lowerQuery),
    );
    return nameMatch || descMatch || triggerMatch;
  });
}

/** Information about a wave update. */
export interface WaveUpdateInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  source: string;
  description: string;
}

/**
 * Compare two semver-ish version strings.
 * Returns true if `latest` is newer than `current`.
 *
 * @param current - The currently installed version.
 * @param latest - The latest available version.
 * @returns True if latest > current.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parseParts = (version: string): number[] =>
    version
      .replace(/^v/, '')
      .split('.')
      .map((part) => parseInt(part, 10) || 0);

  const currentParts = parseParts(current);
  const latestParts = parseParts(latest);

  const maxLen = Math.max(currentParts.length, latestParts.length);
  for (let i = 0; i < maxLen; i++) {
    const curVal = currentParts[i] ?? 0;
    const latVal = latestParts[i] ?? 0;
    if (latVal > curVal) return true;
    if (latVal < curVal) return false;
  }

  return false;
}

/**
 * Check installed waves against the registry for available updates.
 * Compares version strings of installed waves with registry entries.
 *
 * @param db - The database instance.
 * @param registryUrl - Optional override for the registry URL.
 * @returns Array of waves with updates available.
 */
export async function checkForUpdates(
  db: BetterSqlite3.Database,
  registryUrl?: string,
): Promise<WaveUpdateInfo[]> {
  try {
    const registryWaves = await fetchRegistry(db, registryUrl);
    const installedWaves = listWaves(db);
    const updates: WaveUpdateInfo[] = [];

    const registryByName = new Map<string, WaveRegistryEntry>();
    for (const entry of registryWaves) {
      registryByName.set(entry.name, entry);
    }

    for (const installed of installedWaves) {
      const registryEntry = registryByName.get(installed.name);
      if (!registryEntry) continue;

      if (isNewerVersion(installed.version, registryEntry.version)) {
        updates.push({
          name: installed.name,
          currentVersion: installed.version,
          latestVersion: registryEntry.version,
          source: registryEntry.source,
          description: registryEntry.description,
        });
      }
    }

    registryLogger.info(
      { updatesAvailable: updates.length, checkedCount: installedWaves.length },
      'Update check complete',
    );

    return updates;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    registryLogger.warn({ error: errorMessage }, 'Failed to check for updates');
    return [];
  }
}
