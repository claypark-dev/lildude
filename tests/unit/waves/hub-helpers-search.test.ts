/**
 * Tests for searchRegistryAdvanced in hub-helpers.
 * Covers text query, category, tag, party wave, sort, and pagination filters.
 */

import { describe, it, expect } from 'vitest';
import { searchRegistryAdvanced, type WaveRegistryEntry } from '../../../src/waves/hub-helpers.js';

const TEST_ENTRIES: WaveRegistryEntry[] = [
  {
    name: 'weather-checker',
    description: 'Check weather forecasts',
    author: 'community',
    source: 'github:community/weather-checker',
    triggers: ['weather', 'forecast'],
    version: '1.2.0',
    category: 'utilities',
    tags: ['weather', 'forecast'],
    waveCategory: 'personal',
    safetyTier: 'observe',
    deterministic: true,
    installCount: 342,
    averageRating: 4.5,
    ratingCount: 28,
  },
  {
    name: 'email-summarizer',
    description: 'Summarize unread emails',
    author: 'community',
    source: 'github:community/email-summarizer',
    triggers: ['email', 'inbox'],
    version: '0.9.0',
    category: 'communication',
    tags: ['email', 'summary'],
    waveCategory: 'personal',
    safetyTier: 'observe',
    deterministic: false,
    installCount: 215,
    averageRating: 4.2,
    ratingCount: 18,
  },
  {
    name: 'code-reviewer',
    description: 'Review code changes',
    author: 'community',
    source: 'github:community/code-reviewer',
    triggers: ['review', 'code'],
    version: '2.0.1',
    category: 'developer',
    tags: ['code', 'review'],
    waveCategory: 'personal',
    safetyTier: 'observe',
    deterministic: false,
    installCount: 189,
    averageRating: 4.7,
    ratingCount: 42,
  },
  {
    name: 'auto-responder',
    description: 'Automatic responses for contacts',
    author: 'lil-dude',
    source: 'github:lildude/auto-responder',
    triggers: ['status', 'away'],
    version: '1.0.0',
    category: 'party',
    tags: ['auto', 'response'],
    waveCategory: 'party',
    safetyTier: 'observe',
    deterministic: true,
    installCount: 150,
    averageRating: 4.0,
    ratingCount: 15,
  },
  {
    name: 'note-taker',
    description: 'Take notes from conversations',
    author: 'community',
    source: 'github:community/note-taker',
    triggers: ['note', 'save'],
    version: '1.0.0',
    category: 'productivity',
    tags: ['notes', 'organize'],
    waveCategory: 'personal',
    safetyTier: 'create',
    deterministic: true,
    installCount: 127,
    averageRating: 3.8,
    ratingCount: 12,
  },
];

describe('searchRegistryAdvanced', () => {
  // ── No filter ────────────────────────────────────────────────────────

  it('returns all entries when no filters are provided', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, {});
    expect(results).toHaveLength(5);
  });

  // ── Query filter ─────────────────────────────────────────────────────

  it('query filter: matches by wave name', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { query: 'weather' });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('weather-checker');
  });

  it('query filter: matches by description text', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { query: 'unread emails' });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('email-summarizer');
  });

  it('query filter: matches by tag', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { query: 'forecast' });
    // 'forecast' appears in weather-checker's tags and triggers
    expect(results.some((r) => r.name === 'weather-checker')).toBe(true);
  });

  it('query filter: is case-insensitive', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { query: 'CODE' });
    expect(results.some((r) => r.name === 'code-reviewer')).toBe(true);
  });

  it('query filter: returns empty array when nothing matches', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { query: 'xyz-nonexistent' });
    expect(results).toHaveLength(0);
  });

  // ── Category filter ──────────────────────────────────────────────────

  it('category filter: returns only entries in the given category', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { category: 'developer' });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('code-reviewer');
  });

  it('category filter: unknown category returns empty array', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { category: 'nonexistent-category' });
    expect(results).toHaveLength(0);
  });

  // ── Tags filter ──────────────────────────────────────────────────────

  it('tags filter: returns entries matching any of the provided tags', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { tags: ['email'] });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('email-summarizer');
  });

  // ── Party wave filter ────────────────────────────────────────────────

  it('isPartyWave: true returns only party waves', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { isPartyWave: true });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('auto-responder');
  });

  it('isPartyWave: false returns only non-party waves', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { isPartyWave: false });
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.waveCategory !== 'party')).toBe(true);
  });

  // ── Sort options ─────────────────────────────────────────────────────

  it('sort "popular": first entry has the highest installCount', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { sort: 'popular' });
    expect(results[0]?.installCount).toBe(342); // weather-checker
  });

  it('sort "rated": first entry has the highest averageRating', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { sort: 'rated' });
    expect(results[0]?.averageRating).toBe(4.7); // code-reviewer
  });

  it('sort "name": entries are ordered alphabetically', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { sort: 'name' });
    const names = results.map((r) => r.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  // ── Pagination ───────────────────────────────────────────────────────

  it('limit: returns only the requested number of results', () => {
    const results = searchRegistryAdvanced(TEST_ENTRIES, { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('offset + limit: paginates correctly through results', () => {
    const firstPage = searchRegistryAdvanced(TEST_ENTRIES, { sort: 'name', limit: 2, offset: 0 });
    const secondPage = searchRegistryAdvanced(TEST_ENTRIES, { sort: 'name', limit: 2, offset: 2 });

    expect(firstPage).toHaveLength(2);
    expect(secondPage).toHaveLength(2);

    // No overlap between pages
    const firstNames = new Set(firstPage.map((r) => r.name));
    const overlap = secondPage.filter((r) => firstNames.has(r.name));
    expect(overlap).toHaveLength(0);
  });

  // ── Combined filters ─────────────────────────────────────────────────

  it('combined category + query filters narrow results correctly', () => {
    // Only 'utilities' category — should give weather-checker. Querying 'weather' narrows further.
    const results = searchRegistryAdvanced(TEST_ENTRIES, {
      category: 'utilities',
      query: 'weather',
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('weather-checker');
  });
});
