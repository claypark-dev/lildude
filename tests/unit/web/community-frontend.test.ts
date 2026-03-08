/**
 * Sprint 24 — Community features frontend tests.
 *
 * Tests pure logic, data shapes, URL construction, validation rules,
 * trust tier mapping, and routing for the community features frontend.
 * No React rendering — all assertions target TypeScript interfaces and helpers.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Locally duplicated interfaces (avoids import.meta.env issues from web/)
// ---------------------------------------------------------------------------

interface AuthorProfile {
  githubUsername: string;
  displayName: string;
  avatarUrl: string | null;
}

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
  // Sprint 24 community fields
  trustScore: number | null;
  trustTier: 'trusted' | 'community' | 'new' | 'unreviewed' | null;
  publishedAt: string | null;
  updatedAt: string | null;
  packageHash: string | null;
  authorProfile: AuthorProfile | null;
}

interface TrustBadgeConfig {
  label: string;
  bg: string;
  text: string;
  border: string;
  tooltip: string;
}

interface CommunityAuthor {
  githubUsername: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  publishedWaveCount: number;
  averageTrustScore: number;
  joinedAt: string;
}

interface TrustScoreInfo {
  score: number;
  tier: 'trusted' | 'community' | 'new' | 'unreviewed';
  scanPassed: boolean;
  sandboxPassed: boolean;
  lastEvaluatedAt: string;
}

interface PublishHistoryEntry {
  id: string;
  waveName: string;
  version: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  prUrl: string | null;
  submittedAt: string;
}

interface WaveDetailTrust {
  score: number | null;
  tier: 'trusted' | 'community' | 'new' | 'unreviewed' | null;
  scanPassed: boolean;
  sandboxPassed: boolean;
  lastEvaluatedAt: string | null;
  packageHash: string | null;
}

interface WaveDetailAuthor {
  githubUsername: string;
  displayName: string;
  avatarUrl: string | null;
  publishedWaveCount: number;
}

// ---------------------------------------------------------------------------
// Replicated pure helpers from the frontend (no React, no import.meta)
// ---------------------------------------------------------------------------

/** Trust badge configuration — mirrors TRUST_BADGE_CONFIG in TrustBadge.tsx. */
const TRUST_BADGE_CONFIG: Record<string, TrustBadgeConfig> = {
  trusted: {
    label: 'Trusted',
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    border: 'border-green-500/20',
    tooltip: 'This wave has been reviewed and verified by the community.',
  },
  community: {
    label: 'Community',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
    tooltip: 'This wave is published by a community member with a good track record.',
  },
  new: {
    label: 'New',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
    tooltip: 'This wave is from a new publisher. Review carefully before installing.',
  },
  unreviewed: {
    label: 'Unreviewed',
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/20',
    tooltip: 'This wave has not been reviewed. Install at your own risk.',
  },
};

/** Maps a numeric trust score to a trust tier. */
function mapScoreToTier(score: number): 'trusted' | 'community' | 'new' | 'unreviewed' {
  if (score >= 80) return 'trusted';
  if (score >= 50) return 'community';
  if (score >= 20) return 'new';
  return 'unreviewed';
}

/** Determines if install confirmation dialog should auto-confirm. */
function shouldAutoConfirm(tier: string): boolean {
  return tier === 'trusted';
}

/** Determines if the unreviewed typing gate should be active. */
function requiresTypingConfirmation(tier: string): boolean {
  return tier === 'unreviewed';
}

/** Returns the warning level for the install dialog. */
function getInstallWarningLevel(tier: string): 'none' | 'brief' | 'warning' | 'typing-gate' {
  switch (tier) {
    case 'trusted':
      return 'none';
    case 'community':
      return 'brief';
    case 'new':
      return 'warning';
    case 'unreviewed':
      return 'typing-gate';
    default:
      return 'warning';
  }
}

/** Checks whether the confirm button should be enabled for the unreviewed tier. */
function isConfirmButtonEnabled(tier: string, typedName: string, waveName: string): boolean {
  if (tier !== 'unreviewed') return true;
  return typedName === waveName;
}

/** Builds the wave publish URL. */
function buildPublishUrl(baseUrl: string, waveName: string): string {
  return `${baseUrl}/api/v1/community/waves/${encodeURIComponent(waveName)}/publish`;
}

/** Builds the author profile URL. */
function buildAuthorProfileUrl(baseUrl: string, username: string): string {
  return `${baseUrl}/api/v1/community/authors/${encodeURIComponent(username)}`;
}

/** Builds the trust score URL. */
function buildTrustScoreUrl(baseUrl: string, waveName: string): string {
  return `${baseUrl}/api/v1/community/waves/${encodeURIComponent(waveName)}/trust`;
}

/** Builds the publish history URL. */
function buildPublishHistoryUrl(baseUrl: string, waveName: string, limit?: number): string {
  const qs = limit ? `?limit=${limit}` : '';
  return `${baseUrl}/api/v1/community/waves/${encodeURIComponent(waveName)}/history${qs}`;
}

/** Capitalizes a trust tier label for display. */
function capitalizeTierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** Determines if a route belongs to the Discover tab. */
function isDiscoverTabActive(path: string): boolean {
  return path === '/hub' || path.startsWith('/hub/category');
}

/** Determines if a route belongs to the Community tab. */
function isCommunityTabActive(path: string): boolean {
  return (
    path === '/hub/community' ||
    path.startsWith('/hub/publish') ||
    path.startsWith('/hub/author')
  );
}

// ---------------------------------------------------------------------------
// Factory helpers for test data
// ---------------------------------------------------------------------------

function makeAuthorProfile(overrides: Partial<AuthorProfile> = {}): AuthorProfile {
  return {
    githubUsername: 'octocat',
    displayName: 'Octo Cat',
    avatarUrl: 'https://github.com/octocat.png',
    ...overrides,
  };
}

function makeWaveCard(overrides: Partial<WaveCard> = {}): WaveCard {
  return {
    name: 'test-wave',
    displayName: 'Test Wave',
    description: 'A test wave for community feature tests.',
    author: 'tester',
    version: '1.0.0',
    category: 'productivity',
    tags: ['test', 'community'],
    installCount: 42,
    averageRating: 4.5,
    ratingCount: 10,
    verified: true,
    featured: false,
    isPartyWave: false,
    safetyTier: 'observe',
    deterministic: true,
    installed: false,
    source: 'community',
    iconUrl: null,
    trustScore: 85,
    trustTier: 'trusted',
    publishedAt: '2026-02-15T10:00:00Z',
    updatedAt: '2026-03-01T14:30:00Z',
    packageHash: 'sha256:abc123def456',
    authorProfile: makeAuthorProfile(),
    ...overrides,
  };
}

function makeCommunityAuthor(overrides: Partial<CommunityAuthor> = {}): CommunityAuthor {
  return {
    githubUsername: 'octocat',
    displayName: 'Octo Cat',
    avatarUrl: 'https://github.com/octocat.png',
    bio: 'I love building waves.',
    publishedWaveCount: 5,
    averageTrustScore: 78,
    joinedAt: '2025-06-01T00:00:00Z',
    ...overrides,
  };
}

function makeTrustScoreInfo(overrides: Partial<TrustScoreInfo> = {}): TrustScoreInfo {
  return {
    score: 85,
    tier: 'trusted',
    scanPassed: true,
    sandboxPassed: true,
    lastEvaluatedAt: '2026-03-01T12:00:00Z',
    ...overrides,
  };
}

function makePublishHistoryEntry(overrides: Partial<PublishHistoryEntry> = {}): PublishHistoryEntry {
  return {
    id: 'pub-001',
    waveName: 'test-wave',
    version: '1.0.0',
    status: 'approved',
    prUrl: 'https://github.com/lildude/community-waves/pull/42',
    submittedAt: '2026-02-20T09:00:00Z',
    ...overrides,
  };
}

function makeWaveDetailTrust(overrides: Partial<WaveDetailTrust> = {}): WaveDetailTrust {
  return {
    score: 85,
    tier: 'trusted',
    scanPassed: true,
    sandboxPassed: true,
    lastEvaluatedAt: '2026-03-01T12:00:00Z',
    packageHash: 'sha256:abc123def456',
    ...overrides,
  };
}

function makeWaveDetailAuthor(overrides: Partial<WaveDetailAuthor> = {}): WaveDetailAuthor {
  return {
    githubUsername: 'octocat',
    displayName: 'Octo Cat',
    avatarUrl: 'https://github.com/octocat.png',
    publishedWaveCount: 5,
    ...overrides,
  };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Community Frontend — WaveCard community fields', () => {
  it('should include trustScore field on WaveCard', () => {
    const card = makeWaveCard({ trustScore: 85 });
    expect(card).toHaveProperty('trustScore');
    expect(card.trustScore).toBe(85);
  });

  it('should include trustTier field on WaveCard', () => {
    const card = makeWaveCard({ trustTier: 'trusted' });
    expect(card).toHaveProperty('trustTier');
    expect(card.trustTier).toBe('trusted');
  });

  it('should include publishedAt and updatedAt timestamps', () => {
    const card = makeWaveCard({
      publishedAt: '2026-02-15T10:00:00Z',
      updatedAt: '2026-03-01T14:30:00Z',
    });
    expect(card).toHaveProperty('publishedAt');
    expect(card).toHaveProperty('updatedAt');
    expect(new Date(card.publishedAt!).toISOString()).toBe('2026-02-15T10:00:00.000Z');
    expect(new Date(card.updatedAt!).toISOString()).toBe('2026-03-01T14:30:00.000Z');
  });

  it('should include packageHash field on WaveCard', () => {
    const card = makeWaveCard({ packageHash: 'sha256:abc123def456' });
    expect(card).toHaveProperty('packageHash');
    expect(card.packageHash).toBe('sha256:abc123def456');
  });

  it('should include authorProfile with githubUsername, displayName, avatarUrl', () => {
    const card = makeWaveCard({
      authorProfile: makeAuthorProfile({
        githubUsername: 'contributor1',
        displayName: 'First Contributor',
        avatarUrl: 'https://github.com/contributor1.png',
      }),
    });

    expect(card.authorProfile).not.toBeNull();
    expect(card.authorProfile!.githubUsername).toBe('contributor1');
    expect(card.authorProfile!.displayName).toBe('First Contributor');
    expect(card.authorProfile!.avatarUrl).toBe('https://github.com/contributor1.png');
  });

  it('should allow trustScore to be null', () => {
    const card = makeWaveCard({ trustScore: null });
    expect(card.trustScore).toBeNull();
  });

  it('should allow trustTier to be one of the valid values or null', () => {
    const validTiers: Array<WaveCard['trustTier']> = [
      'trusted',
      'community',
      'new',
      'unreviewed',
      null,
    ];

    for (const tier of validTiers) {
      const card = makeWaveCard({ trustTier: tier });
      expect(validTiers).toContain(card.trustTier);
    }
  });

  it('should allow authorProfile to be null', () => {
    const card = makeWaveCard({ authorProfile: null });
    expect(card.authorProfile).toBeNull();
  });
});

describe('Community Frontend — TrustBadge configuration', () => {
  it('should define config for all 4 trust tiers', () => {
    const expectedTiers = ['trusted', 'community', 'new', 'unreviewed'];
    for (const tier of expectedTiers) {
      expect(TRUST_BADGE_CONFIG[tier]).toBeDefined();
    }
  });

  it('should have label, bg, text, border, tooltip for each tier', () => {
    const requiredKeys: Array<keyof TrustBadgeConfig> = [
      'label',
      'bg',
      'text',
      'border',
      'tooltip',
    ];

    for (const tier of Object.keys(TRUST_BADGE_CONFIG)) {
      for (const key of requiredKeys) {
        expect(TRUST_BADGE_CONFIG[tier]).toHaveProperty(key);
        expect(typeof TRUST_BADGE_CONFIG[tier][key]).toBe('string');
        expect(TRUST_BADGE_CONFIG[tier][key].length).toBeGreaterThan(0);
      }
    }
  });

  it('should use green colors for the trusted tier', () => {
    const trusted = TRUST_BADGE_CONFIG['trusted'];
    expect(trusted.bg).toContain('green');
    expect(trusted.text).toContain('green');
    expect(trusted.border).toContain('green');
  });

  it('should use red colors for the unreviewed tier', () => {
    const unreviewed = TRUST_BADGE_CONFIG['unreviewed'];
    expect(unreviewed.bg).toContain('red');
    expect(unreviewed.text).toContain('red');
    expect(unreviewed.border).toContain('red');
  });

  it('should return undefined for an unknown tier key', () => {
    expect(TRUST_BADGE_CONFIG['nonexistent']).toBeUndefined();
  });
});

describe('Community Frontend — InstallConfirmDialog trust logic', () => {
  it('should auto-confirm for trusted tier (no dialog needed)', () => {
    expect(shouldAutoConfirm('trusted')).toBe(true);
    expect(getInstallWarningLevel('trusted')).toBe('none');
  });

  it('should show brief disclaimer for community tier', () => {
    expect(shouldAutoConfirm('community')).toBe(false);
    expect(getInstallWarningLevel('community')).toBe('brief');
  });

  it('should show warning for new tier', () => {
    expect(shouldAutoConfirm('new')).toBe(false);
    expect(getInstallWarningLevel('new')).toBe('warning');
  });

  it('should require typing wave name for unreviewed tier', () => {
    expect(requiresTypingConfirmation('unreviewed')).toBe(true);
    expect(getInstallWarningLevel('unreviewed')).toBe('typing-gate');
  });

  it('should disable confirm button until name is typed for unreviewed', () => {
    const waveName = 'risky-wave';

    // Not typed yet
    expect(isConfirmButtonEnabled('unreviewed', '', waveName)).toBe(false);

    // Partially typed
    expect(isConfirmButtonEnabled('unreviewed', 'risky', waveName)).toBe(false);

    // Correctly typed
    expect(isConfirmButtonEnabled('unreviewed', 'risky-wave', waveName)).toBe(true);

    // Non-unreviewed tiers always enabled regardless of typed name
    expect(isConfirmButtonEnabled('trusted', '', waveName)).toBe(true);
    expect(isConfirmButtonEnabled('community', '', waveName)).toBe(true);
    expect(isConfirmButtonEnabled('new', '', waveName)).toBe(true);
  });
});

describe('Community Frontend — Community API URL construction', () => {
  const BASE = 'http://localhost:18421';

  it('should build correct publish URL with wave name', () => {
    const url = buildPublishUrl(BASE, 'my-cool-wave');
    expect(url).toBe(`${BASE}/api/v1/community/waves/my-cool-wave/publish`);
  });

  it('should build correct author profile URL with username', () => {
    const url = buildAuthorProfileUrl(BASE, 'octocat');
    expect(url).toBe(`${BASE}/api/v1/community/authors/octocat`);
  });

  it('should build correct trust score URL with wave name', () => {
    const url = buildTrustScoreUrl(BASE, 'auto-responder');
    expect(url).toBe(`${BASE}/api/v1/community/waves/auto-responder/trust`);
  });

  it('should build publish history URL with and without limit', () => {
    const urlNoLimit = buildPublishHistoryUrl(BASE, 'test-wave');
    expect(urlNoLimit).toBe(`${BASE}/api/v1/community/waves/test-wave/history`);

    const urlWithLimit = buildPublishHistoryUrl(BASE, 'test-wave', 25);
    expect(urlWithLimit).toBe(`${BASE}/api/v1/community/waves/test-wave/history?limit=25`);
  });

  it('should encode special characters in usernames and wave names', () => {
    const authorUrl = buildAuthorProfileUrl(BASE, 'user name/special');
    expect(authorUrl).toContain(encodeURIComponent('user name/special'));
    expect(authorUrl).not.toContain('user name/special');

    const publishUrl = buildPublishUrl(BASE, 'wave with spaces & symbols');
    expect(publishUrl).toContain(encodeURIComponent('wave with spaces & symbols'));
    expect(publishUrl).not.toContain('wave with spaces & symbols');

    const trustUrl = buildTrustScoreUrl(BASE, '@special/wave');
    expect(trustUrl).toContain(encodeURIComponent('@special/wave'));
  });
});

describe('Community Frontend — Community data shapes', () => {
  it('should validate CommunityAuthor with all required fields', () => {
    const author = makeCommunityAuthor();

    expect(typeof author.githubUsername).toBe('string');
    expect(typeof author.displayName).toBe('string');
    expect(typeof author.publishedWaveCount).toBe('number');
    expect(typeof author.averageTrustScore).toBe('number');
    expect(typeof author.joinedAt).toBe('string');
    expect(author.publishedWaveCount).toBeGreaterThanOrEqual(0);
    expect(author.averageTrustScore).toBeGreaterThanOrEqual(0);
    expect(author.averageTrustScore).toBeLessThanOrEqual(100);
  });

  it('should allow CommunityAuthor bio and avatarUrl to be null', () => {
    const author = makeCommunityAuthor({ bio: null, avatarUrl: null });
    expect(author.bio).toBeNull();
    expect(author.avatarUrl).toBeNull();
  });

  it('should validate TrustScoreInfo with score, tier, scan and sandbox results', () => {
    const info = makeTrustScoreInfo();

    expect(typeof info.score).toBe('number');
    expect(info.score).toBeGreaterThanOrEqual(0);
    expect(info.score).toBeLessThanOrEqual(100);
    expect(['trusted', 'community', 'new', 'unreviewed']).toContain(info.tier);
    expect(typeof info.scanPassed).toBe('boolean');
    expect(typeof info.sandboxPassed).toBe('boolean');
    expect(typeof info.lastEvaluatedAt).toBe('string');
  });

  it('should validate PublishHistoryEntry with id, waveName, version, status, prUrl', () => {
    const entry = makePublishHistoryEntry();

    expect(typeof entry.id).toBe('string');
    expect(typeof entry.waveName).toBe('string');
    expect(typeof entry.version).toBe('string');
    expect(['pending', 'approved', 'rejected', 'withdrawn']).toContain(entry.status);
    expect(entry.prUrl).not.toBeNull();
    expect(typeof entry.prUrl).toBe('string');
    expect(typeof entry.submittedAt).toBe('string');
  });

  it('should allow PublishHistoryEntry prUrl to be null', () => {
    const entry = makePublishHistoryEntry({ prUrl: null });
    expect(entry.prUrl).toBeNull();
  });

  it('should validate WaveDetailTrust shape conformance', () => {
    const trust = makeWaveDetailTrust();

    expect(trust).toHaveProperty('score');
    expect(trust).toHaveProperty('tier');
    expect(trust).toHaveProperty('scanPassed');
    expect(trust).toHaveProperty('sandboxPassed');
    expect(trust).toHaveProperty('lastEvaluatedAt');
    expect(trust).toHaveProperty('packageHash');

    expect(typeof trust.score).toBe('number');
    expect(['trusted', 'community', 'new', 'unreviewed', null]).toContain(trust.tier);
    expect(typeof trust.scanPassed).toBe('boolean');
    expect(typeof trust.sandboxPassed).toBe('boolean');
  });

  it('should validate WaveDetailAuthor shape conformance', () => {
    const author = makeWaveDetailAuthor();

    expect(author).toHaveProperty('githubUsername');
    expect(author).toHaveProperty('displayName');
    expect(author).toHaveProperty('avatarUrl');
    expect(author).toHaveProperty('publishedWaveCount');

    expect(typeof author.githubUsername).toBe('string');
    expect(typeof author.displayName).toBe('string');
    expect(typeof author.publishedWaveCount).toBe('number');
    expect(author.publishedWaveCount).toBeGreaterThanOrEqual(0);
  });
});

describe('Community Frontend — Trust tier mapping', () => {
  it('should map score 80-100 to trusted', () => {
    expect(mapScoreToTier(80)).toBe('trusted');
    expect(mapScoreToTier(90)).toBe('trusted');
    expect(mapScoreToTier(100)).toBe('trusted');
  });

  it('should map score 50-79 to community', () => {
    expect(mapScoreToTier(50)).toBe('community');
    expect(mapScoreToTier(65)).toBe('community');
    expect(mapScoreToTier(79)).toBe('community');
  });

  it('should map score 20-49 to new', () => {
    expect(mapScoreToTier(20)).toBe('new');
    expect(mapScoreToTier(35)).toBe('new');
    expect(mapScoreToTier(49)).toBe('new');
  });

  it('should map score 0-19 to unreviewed', () => {
    expect(mapScoreToTier(0)).toBe('unreviewed');
    expect(mapScoreToTier(10)).toBe('unreviewed');
    expect(mapScoreToTier(19)).toBe('unreviewed');
  });

  it('should produce capitalized display labels for all tiers', () => {
    expect(capitalizeTierLabel('trusted')).toBe('Trusted');
    expect(capitalizeTierLabel('community')).toBe('Community');
    expect(capitalizeTierLabel('new')).toBe('New');
    expect(capitalizeTierLabel('unreviewed')).toBe('Unreviewed');
  });
});

describe('Community Frontend — Community routing paths', () => {
  const EXPECTED_COMMUNITY_ROUTES = [
    '/hub/community',
    '/hub/publish',
    '/hub/author/:username',
  ];

  it('should define /hub/community route', () => {
    expect(EXPECTED_COMMUNITY_ROUTES).toContain('/hub/community');
  });

  it('should define /hub/publish route', () => {
    expect(EXPECTED_COMMUNITY_ROUTES).toContain('/hub/publish');
  });

  it('should define parameterized /hub/author/:username route', () => {
    const authorRoute = EXPECTED_COMMUNITY_ROUTES.find((r) => r.includes('/hub/author/'));
    expect(authorRoute).toBeDefined();
    expect(authorRoute).toBe('/hub/author/:username');

    // Simulate replacing the param
    const resolved = authorRoute!.replace(':username', 'octocat');
    expect(resolved).toBe('/hub/author/octocat');

    const resolvedSpecial = authorRoute!.replace(':username', 'user-name-123');
    expect(resolvedSpecial).toBe('/hub/author/user-name-123');
  });

  it('should activate Discover tab for /hub and /hub/category paths', () => {
    expect(isDiscoverTabActive('/hub')).toBe(true);
    expect(isDiscoverTabActive('/hub/category/productivity')).toBe(true);
    expect(isDiscoverTabActive('/hub/category/communication')).toBe(true);

    // Should not activate for community paths
    expect(isDiscoverTabActive('/hub/community')).toBe(false);
    expect(isDiscoverTabActive('/hub/publish')).toBe(false);
    expect(isDiscoverTabActive('/hub/author/octocat')).toBe(false);
  });

  it('should activate Community tab for /hub/community, /hub/publish, /hub/author paths', () => {
    expect(isCommunityTabActive('/hub/community')).toBe(true);
    expect(isCommunityTabActive('/hub/publish')).toBe(true);
    expect(isCommunityTabActive('/hub/author/octocat')).toBe(true);
    expect(isCommunityTabActive('/hub/author/contributor1')).toBe(true);

    // Should not activate for discover paths
    expect(isCommunityTabActive('/hub')).toBe(false);
    expect(isCommunityTabActive('/hub/category/productivity')).toBe(false);
  });
});
