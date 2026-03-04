/**
 * Remote Wave Hub registry.
 * Fetches the curated wave registry from a remote URL (GitHub JSON)
 * with 24-hour caching in SQLite. Falls back to the hardcoded registry
 * if the remote fetch fails. Supports update checking for installed waves.
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

/** Default registry URL (GitHub raw JSON). */
const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/lildude-community/wave-registry/main/registry.json';

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

/** Union of v1 and v2 registry shapes. */
type RegistryJson = RegistryJsonV1 | RegistryJsonV2;

/**
 * Parse a registry JSON payload, supporting both v1 and v2 formats.
 * v2 adds optional `featured` and `categories` arrays. If `featured` is
 * present, each matching wave gets `featured: true` merged in.
 *
 * @param raw - The parsed JSON object.
 * @returns Array of enriched wave registry entries.
 */
export function parseRegistryPayload(raw: RegistryJson): WaveRegistryEntry[] {
  if (!Array.isArray(raw.waves)) {
    throw new Error('Invalid registry format: missing waves array');
  }

  const isV2 = 'featured' in raw || 'categories' in raw;
  if (!isV2) return raw.waves;

  const v2 = raw as RegistryJsonV2;
  const featuredSet = new Set(v2.featured ?? []);

  return v2.waves.map((wave) => ({
    ...wave,
    featured: wave.featured ?? featuredSet.has(wave.name),
  }));
}

/** Hardcoded fallback registry for offline/error scenarios. */
const FALLBACK_REGISTRY: WaveRegistryEntry[] = [
  { name: 'weather-checker', description: 'Check weather forecasts for any location', author: 'lil-dude-community', source: 'github:claypark-dev/weather-checker', triggers: ['weather', 'forecast', 'temperature'], version: '1.2.0', category: 'utilities', tags: ['weather', 'forecast'], waveCategory: 'personal', safetyTier: 'observe', deterministic: true, verified: true, installCount: 342, averageRating: 4.5, ratingCount: 28 },
  { name: 'email-summarizer', description: 'Summarize unread emails from Gmail or Outlook', author: 'lil-dude-community', source: 'github:claypark-dev/email-summarizer', triggers: ['email', 'inbox', 'unread', 'mail'], version: '0.9.0', category: 'communication', tags: ['email', 'inbox', 'summary'], waveCategory: 'personal', safetyTier: 'observe', deterministic: false, verified: true, installCount: 215, averageRating: 4.2, ratingCount: 18 },
  { name: 'code-reviewer', description: 'Review code changes and provide feedback', author: 'lil-dude-community', source: 'github:claypark-dev/code-reviewer', triggers: ['review', 'code review', 'PR', 'pull request'], version: '2.0.1', category: 'developer', tags: ['code', 'review', 'git'], waveCategory: 'personal', safetyTier: 'observe', deterministic: false, verified: true, installCount: 189, averageRating: 4.7, ratingCount: 42 },
  { name: 'note-taker', description: 'Take and organize notes from conversations', author: 'lil-dude-community', source: 'github:claypark-dev/note-taker', triggers: ['note', 'notes', 'remember', 'save'], version: '1.0.0', category: 'productivity', tags: ['notes', 'organize', 'save'], waveCategory: 'personal', safetyTier: 'create', deterministic: true, verified: false, installCount: 127, averageRating: 3.8, ratingCount: 12 },
  { name: 'file-organizer', description: 'Organize files in directories by type and date', author: 'lil-dude-community', source: 'github:claypark-dev/file-organizer', triggers: ['organize', 'files', 'cleanup', 'sort files'], version: '1.1.0', category: 'utilities', tags: ['files', 'organize', 'cleanup'], waveCategory: 'personal', safetyTier: 'modify', deterministic: true, verified: false, installCount: 96, averageRating: 4.0, ratingCount: 8 },
];

/**
 * Fetch the wave registry, using cached data if available and fresh.
 * Falls back to hardcoded registry on failure.
 *
 * @param db - The database instance.
 * @param registryUrl - The registry URL to fetch from.
 * @param cacheTtlHours - Cache TTL in hours.
 * @returns Array of wave registry entries.
 */
export async function fetchRegistry(
  db: BetterSqlite3.Database,
  registryUrl = DEFAULT_REGISTRY_URL,
  cacheTtlHours = DEFAULT_CACHE_TTL_HOURS,
): Promise<WaveRegistryEntry[]> {
  // Check cache first
  try {
    const cached = getCachedRegistry(db, registryUrl);
    if (cached) {
      registryLogger.debug({ registryUrl }, 'Using cached registry');
      const parsed = JSON.parse(cached.data) as RegistryJson;
      return parseRegistryPayload(parsed);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    registryLogger.warn({ error: message }, 'Failed to read registry cache');
  }

  // Fetch from remote
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
      'Failed to fetch remote registry, using fallback',
    );
    return FALLBACK_REGISTRY;
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
