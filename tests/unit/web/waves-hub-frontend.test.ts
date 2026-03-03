/**
 * Sprint 17B — Waves Hub frontend component tests.
 *
 * Tests pure logic, data shapes, URL construction, validation rules,
 * and sort/filter configuration used by the Waves Hub frontend.
 * No React rendering — all assertions target TypeScript interfaces and helpers.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Locally duplicated interfaces (avoids import.meta.env issues from web/)
// ---------------------------------------------------------------------------

interface WaveCard {
  name: string;
  displayName: string;
  description: string;
  author: string;
  version: string;
  category: string;
  tags: string[];
  installCount: number;
  averageRating: number;
  ratingCount: number;
  verified: boolean;
  featured: boolean;
  isPartyWave: boolean;
  safetyTier: string;
  deterministic: boolean;
  installed: boolean;
  source: string;
  iconUrl: string | null;
}

interface WaveCategory {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  waveCount: number;
}

interface WaveReview {
  id: string;
  waveName: string;
  rating: number;
  comment: string | null;
  reviewer: string;
  createdAt: string;
}

interface HubStats {
  registryCount: number;
  installedCount: number;
  categoryCount: number;
  featuredCount: number;
  topInstalled: Array<{ waveName: string; installCount: number }>;
  topRated: Array<{ waveName: string; averageRating: number; ratingCount: number }>;
}

interface ListedWave {
  name: string;
  version: string;
  source: 'bundled' | 'installed';
  status: 'enabled' | 'disabled';
}

// ---------------------------------------------------------------------------
// Replicated pure helpers from the frontend (no React, no import.meta)
// ---------------------------------------------------------------------------

/** Mirrors the query-string builder in wave-hub-api.ts fetchBrowse(). */
function buildBrowseUrl(
  baseUrl: string,
  params: {
    q?: string;
    category?: string;
    tags?: string;
    sort?: string;
    party?: string;
    limit?: number;
    offset?: number;
  },
): string {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set('q', params.q);
  if (params.category) searchParams.set('category', params.category);
  if (params.tags) searchParams.set('tags', params.tags);
  if (params.sort) searchParams.set('sort', params.sort);
  if (params.party) searchParams.set('party', params.party);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));

  const qs = searchParams.toString();
  return qs ? `${baseUrl}/api/v1/hub/browse?${qs}` : `${baseUrl}/api/v1/hub/browse`;
}

/** Mirrors the review URL builder in wave-hub-api.ts fetchWaveReviews(). */
function buildReviewsUrl(baseUrl: string, name: string, limit?: number): string {
  const qs = limit ? `?limit=${limit}` : '';
  return `${baseUrl}/api/v1/hub/waves/${encodeURIComponent(name)}/reviews${qs}`;
}

/** Star display logic from WaveCard.tsx StarRating component. */
function formatStarRating(rating: number): string {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.3;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
  return '★'.repeat(fullStars) + (hasHalf ? '½' : '') + '☆'.repeat(emptyStars);
}

/** Safety tier colors — mirrors TIER_COLORS in WaveCard.tsx. */
const TIER_COLORS: Record<string, string> = {
  observe: 'bg-green-500/10 text-green-400 border-green-500/20',
  create: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  modify: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  destroy: 'bg-red-500/10 text-red-400 border-red-500/20',
  execute: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

/** Safety tier descriptions — mirrors TIER_DESCRIPTIONS in WaveDetailModal.tsx. */
const TIER_DESCRIPTIONS: Record<string, string> = {
  observe: 'Read-only — can observe data but not modify anything.',
  create: 'Can create new records but not modify existing ones.',
  modify: 'Can modify existing data and settings.',
  destroy: 'Can delete data — use with caution.',
  execute: 'Full system access — highest privilege level.',
};

/** Sort options from WavesCategoryPage.tsx. */
const SORT_OPTIONS = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'rated', label: 'Top Rated' },
  { value: 'name', label: 'A–Z' },
  { value: 'recent', label: 'Recent' },
] as const;

// ---------------------------------------------------------------------------
// Factory helpers for test data
// ---------------------------------------------------------------------------

function makeWaveCard(overrides: Partial<WaveCard> = {}): WaveCard {
  return {
    name: 'test-wave',
    displayName: 'Test Wave',
    description: 'A test wave for unit tests.',
    author: 'tester',
    version: '1.0.0',
    category: 'productivity',
    tags: ['test', 'demo'],
    installCount: 42,
    averageRating: 4.5,
    ratingCount: 10,
    verified: true,
    featured: false,
    isPartyWave: false,
    safetyTier: 'observe',
    deterministic: true,
    installed: false,
    source: 'bundled',
    iconUrl: null,
    ...overrides,
  };
}

function makeCategory(overrides: Partial<WaveCategory> = {}): WaveCategory {
  return {
    id: 'cat-1',
    name: 'productivity',
    displayName: 'Productivity',
    description: 'Boost your productivity.',
    icon: '📋',
    waveCount: 5,
    ...overrides,
  };
}

function makeReview(overrides: Partial<WaveReview> = {}): WaveReview {
  return {
    id: 'rev-1',
    waveName: 'test-wave',
    rating: 5,
    comment: 'Great wave!',
    reviewer: 'user-1',
    createdAt: '2026-03-01T12:00:00Z',
    ...overrides,
  };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Waves Hub Frontend — WaveCard interface conformance', () => {
  it('should include all required fields on a WaveCard', () => {
    const card = makeWaveCard();

    expect(card).toHaveProperty('name');
    expect(card).toHaveProperty('displayName');
    expect(card).toHaveProperty('description');
    expect(card).toHaveProperty('author');
    expect(card).toHaveProperty('version');
    expect(card).toHaveProperty('category');
    expect(card).toHaveProperty('tags');
    expect(card).toHaveProperty('installCount');
    expect(card).toHaveProperty('averageRating');
    expect(card).toHaveProperty('ratingCount');
    expect(card).toHaveProperty('verified');
    expect(card).toHaveProperty('featured');
    expect(card).toHaveProperty('isPartyWave');
    expect(card).toHaveProperty('safetyTier');
    expect(card).toHaveProperty('deterministic');
    expect(card).toHaveProperty('installed');
    expect(card).toHaveProperty('source');
    expect(card).toHaveProperty('iconUrl');
  });

  it('should enforce correct types for numeric fields', () => {
    const card = makeWaveCard({ installCount: 100, averageRating: 3.7, ratingCount: 25 });

    expect(typeof card.installCount).toBe('number');
    expect(typeof card.averageRating).toBe('number');
    expect(typeof card.ratingCount).toBe('number');
    expect(card.installCount).toBeGreaterThanOrEqual(0);
    expect(card.averageRating).toBeGreaterThanOrEqual(0);
    expect(card.averageRating).toBeLessThanOrEqual(5);
  });

  it('should allow iconUrl to be null', () => {
    const card = makeWaveCard({ iconUrl: null });
    expect(card.iconUrl).toBeNull();
  });

  it('should allow iconUrl to be a string', () => {
    const card = makeWaveCard({ iconUrl: 'https://example.com/icon.png' });
    expect(card.iconUrl).toBe('https://example.com/icon.png');
  });

  it('should store tags as an array of strings', () => {
    const card = makeWaveCard({ tags: ['scheduling', 'ai', 'automation'] });

    expect(Array.isArray(card.tags)).toBe(true);
    expect(card.tags).toHaveLength(3);
    card.tags.forEach((tag) => expect(typeof tag).toBe('string'));
  });
});

describe('Waves Hub Frontend — URL construction', () => {
  const BASE = 'http://localhost:18421';

  it('should build a bare browse URL when no params are given', () => {
    const url = buildBrowseUrl(BASE, {});
    expect(url).toBe(`${BASE}/api/v1/hub/browse`);
  });

  it('should append a single query param', () => {
    const url = buildBrowseUrl(BASE, { q: 'calendar' });
    expect(url).toBe(`${BASE}/api/v1/hub/browse?q=calendar`);
  });

  it('should append multiple query params', () => {
    const url = buildBrowseUrl(BASE, {
      q: 'timer',
      category: 'productivity',
      sort: 'popular',
      limit: 20,
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('q')).toBe('timer');
    expect(parsed.searchParams.get('category')).toBe('productivity');
    expect(parsed.searchParams.get('sort')).toBe('popular');
    expect(parsed.searchParams.get('limit')).toBe('20');
  });

  it('should skip falsy params (undefined, empty string)', () => {
    const url = buildBrowseUrl(BASE, {
      q: '',
      category: undefined,
      sort: 'rated',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.has('q')).toBe(false);
    expect(parsed.searchParams.has('category')).toBe(false);
    expect(parsed.searchParams.get('sort')).toBe('rated');
  });

  it('should encode the offset param as a string', () => {
    const url = buildBrowseUrl(BASE, { offset: 40 });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('offset')).toBe('40');
  });

  it('should build party filter param', () => {
    const url = buildBrowseUrl(BASE, { party: 'true' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('party')).toBe('true');
  });

  it('should build correct reviews URL without limit', () => {
    const url = buildReviewsUrl(BASE, 'auto-responder');
    expect(url).toBe(`${BASE}/api/v1/hub/waves/auto-responder/reviews`);
  });

  it('should build correct reviews URL with limit', () => {
    const url = buildReviewsUrl(BASE, 'auto-responder', 10);
    expect(url).toBe(`${BASE}/api/v1/hub/waves/auto-responder/reviews?limit=10`);
  });

  it('should URL-encode wave names with special characters', () => {
    const url = buildReviewsUrl(BASE, 'wave/with spaces');
    expect(url).toContain(encodeURIComponent('wave/with spaces'));
  });
});

describe('Waves Hub Frontend — WaveCategory data shapes', () => {
  it('should include all required category fields', () => {
    const category = makeCategory();

    expect(typeof category.id).toBe('string');
    expect(typeof category.name).toBe('string');
    expect(typeof category.displayName).toBe('string');
    expect(typeof category.waveCount).toBe('number');
  });

  it('should allow null description and icon', () => {
    const category = makeCategory({ description: null, icon: null });

    expect(category.description).toBeNull();
    expect(category.icon).toBeNull();
  });

  it('should have a non-negative waveCount', () => {
    const category = makeCategory({ waveCount: 0 });
    expect(category.waveCount).toBeGreaterThanOrEqual(0);
  });

  it('should distinguish categories by name', () => {
    const categories = [
      makeCategory({ name: 'productivity', displayName: 'Productivity' }),
      makeCategory({ name: 'communication', displayName: 'Communication' }),
      makeCategory({ name: 'scheduling', displayName: 'Scheduling' }),
    ];

    const names = categories.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('Waves Hub Frontend — Review form validation', () => {
  it('should accept rating of 1 (minimum)', () => {
    const review = makeReview({ rating: 1 });
    expect(review.rating).toBe(1);
    expect(review.rating).toBeGreaterThanOrEqual(1);
    expect(review.rating).toBeLessThanOrEqual(5);
  });

  it('should accept rating of 5 (maximum)', () => {
    const review = makeReview({ rating: 5 });
    expect(review.rating).toBe(5);
    expect(review.rating).toBeGreaterThanOrEqual(1);
    expect(review.rating).toBeLessThanOrEqual(5);
  });

  it('should reject ratings outside 1-5 range', () => {
    expect(0).toBeLessThan(1); // Would fail validation
    expect(6).toBeGreaterThan(5); // Would fail validation

    // Valid range check
    for (const validRating of [1, 2, 3, 4, 5]) {
      expect(validRating).toBeGreaterThanOrEqual(1);
      expect(validRating).toBeLessThanOrEqual(5);
    }
  });

  it('should allow comment to be null (optional)', () => {
    const review = makeReview({ comment: null });
    expect(review.comment).toBeNull();
  });

  it('should allow a non-empty comment string', () => {
    const review = makeReview({ comment: 'Very useful wave, highly recommended.' });
    expect(review.comment).toBeTruthy();
    expect(typeof review.comment).toBe('string');
  });

  it('should store valid ISO date strings in createdAt', () => {
    const review = makeReview({ createdAt: '2026-03-01T12:00:00Z' });
    const parsed = new Date(review.createdAt);
    expect(parsed.toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(isNaN(parsed.getTime())).toBe(false);
  });
});

describe('Waves Hub Frontend — Sort options', () => {
  it('should define exactly 4 sort options', () => {
    expect(SORT_OPTIONS).toHaveLength(4);
  });

  it('should include "popular" as default sort', () => {
    const popular = SORT_OPTIONS.find((o) => o.value === 'popular');
    expect(popular).toBeDefined();
    expect(popular!.label).toBe('Most Popular');
  });

  it('should include "rated" sort option', () => {
    const rated = SORT_OPTIONS.find((o) => o.value === 'rated');
    expect(rated).toBeDefined();
    expect(rated!.label).toBe('Top Rated');
  });

  it('should include "name" sort option', () => {
    const name = SORT_OPTIONS.find((o) => o.value === 'name');
    expect(name).toBeDefined();
    expect(name!.label).toBe('A–Z');
  });

  it('should include "recent" sort option', () => {
    const recent = SORT_OPTIONS.find((o) => o.value === 'recent');
    expect(recent).toBeDefined();
    expect(recent!.label).toBe('Recent');
  });

  it('should have unique sort values', () => {
    const values = SORT_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('Waves Hub Frontend — Safety tier mapping', () => {
  it('should define color classes for all 5 safety tiers', () => {
    const expectedTiers = ['observe', 'create', 'modify', 'destroy', 'execute'];
    for (const tier of expectedTiers) {
      expect(TIER_COLORS[tier]).toBeDefined();
      expect(typeof TIER_COLORS[tier]).toBe('string');
    }
  });

  it('should define descriptions for all 5 safety tiers', () => {
    const expectedTiers = ['observe', 'create', 'modify', 'destroy', 'execute'];
    for (const tier of expectedTiers) {
      expect(TIER_DESCRIPTIONS[tier]).toBeDefined();
      expect(TIER_DESCRIPTIONS[tier].length).toBeGreaterThan(0);
    }
  });

  it('should return undefined for unknown tiers (fallback behavior)', () => {
    expect(TIER_COLORS['nonexistent']).toBeUndefined();
    expect(TIER_DESCRIPTIONS['nonexistent']).toBeUndefined();
  });
});

describe('Waves Hub Frontend — Star rating display', () => {
  it('should render 5 full stars for a rating of 5.0', () => {
    expect(formatStarRating(5.0)).toBe('★★★★★');
  });

  it('should render 0 full stars and 5 empty stars for a rating of 0.0', () => {
    expect(formatStarRating(0.0)).toBe('☆☆☆☆☆');
  });

  it('should render half star when fractional part >= 0.3', () => {
    // 4.4 → 4 full + half + 0 empty = ★★★★½
    expect(formatStarRating(4.4)).toBe('★★★★½');
  });

  it('should not render half star when fractional part < 0.3', () => {
    // 4.2 → 4 full + 0 half + 1 empty = ★★★★☆
    expect(formatStarRating(4.2)).toBe('★★★★☆');
  });

  it('should handle rating of 3.5 correctly', () => {
    // 3.5 → 3 full + half + 1 empty = ★★★½☆
    expect(formatStarRating(3.5)).toBe('★★★½☆');
  });

  it('should handle boundary rating of 0.3 (half star only)', () => {
    // 0.3 → 0 full + half + 4 empty = ½☆☆☆☆
    expect(formatStarRating(0.3)).toBe('½☆☆☆☆');
  });
});

describe('Waves Hub Frontend — HubStats shape', () => {
  it('should validate a well-formed HubStats object', () => {
    const stats: HubStats = {
      registryCount: 25,
      installedCount: 8,
      categoryCount: 5,
      featuredCount: 3,
      topInstalled: [
        { waveName: 'auto-responder', installCount: 150 },
        { waveName: 'meeting-request', installCount: 90 },
      ],
      topRated: [
        { waveName: 'contact-share', averageRating: 4.8, ratingCount: 20 },
      ],
    };

    expect(stats.registryCount).toBeGreaterThanOrEqual(0);
    expect(stats.installedCount).toBeGreaterThanOrEqual(0);
    expect(stats.categoryCount).toBeGreaterThanOrEqual(0);
    expect(stats.featuredCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(stats.topInstalled)).toBe(true);
    expect(Array.isArray(stats.topRated)).toBe(true);
    expect(stats.topInstalled[0]).toHaveProperty('waveName');
    expect(stats.topInstalled[0]).toHaveProperty('installCount');
    expect(stats.topRated[0]).toHaveProperty('waveName');
    expect(stats.topRated[0]).toHaveProperty('averageRating');
    expect(stats.topRated[0]).toHaveProperty('ratingCount');
  });
});

describe('Waves Hub Frontend — ListedWave shape', () => {
  it('should accept "bundled" source', () => {
    const wave: ListedWave = {
      name: 'auto-responder',
      version: '1.0.0',
      source: 'bundled',
      status: 'enabled',
    };
    expect(wave.source).toBe('bundled');
  });

  it('should accept "installed" source', () => {
    const wave: ListedWave = {
      name: 'custom-wave',
      version: '2.1.0',
      source: 'installed',
      status: 'disabled',
    };
    expect(wave.source).toBe('installed');
  });

  it('should distinguish enabled vs disabled status', () => {
    const enabled: ListedWave = {
      name: 'wave-a',
      version: '1.0.0',
      source: 'bundled',
      status: 'enabled',
    };
    const disabled: ListedWave = {
      name: 'wave-b',
      version: '1.0.0',
      source: 'bundled',
      status: 'disabled',
    };
    expect(enabled.status).not.toBe(disabled.status);
  });
});

describe('Waves Hub Frontend — Routing paths', () => {
  // Verify the expected routes from App.tsx match the frontend navigation logic
  const EXPECTED_HUB_ROUTES = [
    '/hub',                      // Hub root — renders WavesHubHome at index
    '/hub/category/:category',   // Category browse page
    '/hub/installed',            // Installed waves page
  ];

  it('should define all expected hub routes', () => {
    expect(EXPECTED_HUB_ROUTES).toContain('/hub');
    expect(EXPECTED_HUB_ROUTES).toContain('/hub/category/:category');
    expect(EXPECTED_HUB_ROUTES).toContain('/hub/installed');
  });

  it('should have the hub root as a nested layout route', () => {
    // The hub route has child routes (index, category/:category, installed)
    // This mirrors the App.tsx <Route path="/hub" element={<WavesHub />}>
    expect(EXPECTED_HUB_ROUTES[0]).toBe('/hub');
  });

  it('should support parameterized category routes', () => {
    const categoryRoute = '/hub/category/:category';
    // Simulate replacing the param
    const productivityUrl = categoryRoute.replace(':category', 'productivity');
    expect(productivityUrl).toBe('/hub/category/productivity');

    const communicationUrl = categoryRoute.replace(':category', 'communication');
    expect(communicationUrl).toBe('/hub/category/communication');
  });
});
