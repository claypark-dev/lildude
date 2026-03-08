/**
 * Wave discovery — suggests installable community waves when the agent
 * encounters a task it cannot currently handle.
 *
 * Queries the local registry cache (synced from Shorebreak) for waves
 * matching the user's intent, and returns installation suggestions.
 * Zero LLM cost — uses deterministic keyword matching.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('wave-discovery');

/** A wave suggestion returned by the discovery engine. */
export interface WaveSuggestion {
  /** Wave name (e.g., 'weather-checker'). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Category (e.g., 'utilities'). */
  category: string;
  /** Safety tier (observe/create/modify/destroy/execute). */
  safetyTier: string;
  /** Install command for the user. */
  installCommand: string;
  /** Match relevance score (0-1). */
  score: number;
}

/** Result of a wave discovery query. */
export interface DiscoveryResult {
  /** Whether any matching waves were found. */
  found: boolean;
  /** Suggested waves, sorted by relevance (best first). */
  suggestions: WaveSuggestion[];
  /** Human-readable message to present to the user. */
  message: string;
}

// ── Stop words for keyword extraction ─────────────────────────────

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'the', 'a', 'an', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'can', 'may', 'might',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'it', 'its', 'this', 'that', 'these', 'those', 'and', 'or', 'but',
  'not', 'no', 'if', 'then', 'so', 'up', 'out', 'about', 'into',
  'just', 'also', 'than', 'very', 'too', 'how', 'what', 'when',
  'where', 'who', 'which', 'some', 'any', 'all', 'each', 'every',
  'please', 'want', 'need', 'help', 'me', 'you', 'your', 'let',
  'make', 'get', 'put', 'use', 'try', 'hey', 'hi', 'hello',
]);

/**
 * Extract meaningful keywords from a user message.
 * Removes stop words, punctuation, and very short words.
 */
function extractKeywords(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 10);
}

/**
 * Calculate a match score between keywords and a wave entry.
 * Checks name, description, triggers, and tags.
 */
function scoreWave(
  keywords: string[],
  wave: { name: string; description: string; triggers: string; tags: string },
): number {
  if (keywords.length === 0) return 0;

  let hits = 0;
  const searchable = `${wave.name} ${wave.description} ${wave.triggers} ${wave.tags}`.toLowerCase();

  for (const kw of keywords) {
    if (searchable.includes(kw)) {
      hits++;
      // Bonus for name match
      if (wave.name.toLowerCase().includes(kw)) {
        hits += 0.5;
      }
    }
  }

  return hits / keywords.length;
}

/**
 * Search the wave registry cache for waves matching a user message.
 * Returns up to 3 most relevant suggestions.
 *
 * @param db - Database with the Shorebreak cache table (wave_hub_cache).
 * @param userMessage - The user's message text.
 * @param installedWaves - Set of already-installed wave names to exclude.
 * @returns Discovery result with suggestions and a formatted message.
 */
export function discoverWaves(
  db: BetterSqlite3.Database,
  userMessage: string,
  installedWaves: Set<string> = new Set(),
): DiscoveryResult {
  const keywords = extractKeywords(userMessage);

  if (keywords.length === 0) {
    return { found: false, suggestions: [], message: '' };
  }

  try {
    // Query the Shorebreak cache for all waves
    const stmt = db.prepare(`
      SELECT name, description, category, safety_tier, triggers, tags
      FROM wave_hub_cache
      WHERE name NOT IN (${[...installedWaves].map(() => '?').join(',') || "''"})
      LIMIT 500
    `);

    const rows = stmt.all(...installedWaves) as Array<{
      name: string;
      description: string;
      category: string;
      safety_tier: string;
      triggers: string;
      tags: string;
    }>;

    // Score each wave
    const scored: Array<{ wave: typeof rows[0]; score: number }> = [];
    for (const wave of rows) {
      const score = scoreWave(keywords, wave);
      if (score >= 0.3) {
        scored.push({ wave, score });
      }
    }

    // Sort by score (best first) and take top 3
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3);

    if (top.length === 0) {
      return { found: false, suggestions: [], message: '' };
    }

    const suggestions: WaveSuggestion[] = top.map(({ wave, score }) => ({
      name: wave.name,
      description: wave.description,
      category: wave.category,
      safetyTier: wave.safety_tier,
      installCommand: `lildude wave install ${wave.name}`,
      score,
    }));

    // Build a friendly message
    const lines = [
      "I can't do that yet, but I found some waves that might help:",
      '',
    ];
    for (const s of suggestions) {
      lines.push(`  **${s.name}** — ${s.description}`);
      lines.push(`  \`$ ${s.installCommand}\` (${s.safetyTier})`);
      lines.push('');
    }
    lines.push('Want me to install any of these?');

    logger.info(
      { keywords, matchCount: suggestions.length, topScore: suggestions[0]?.score },
      'Wave discovery found suggestions',
    );

    return {
      found: true,
      suggestions,
      message: lines.join('\n'),
    };
  } catch (error) {
    logger.debug({ error }, 'Wave discovery query failed (Shorebreak cache may not exist yet)');
    return { found: false, suggestions: [], message: '' };
  }
}
