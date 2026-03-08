import { describe, it, expect } from 'vitest';
import { registryEntryToWaveCard, listedWaveToWaveCard } from '../../../src/waves/wave-card-mapper.js';
import type { WaveRegistryEntry, ListedWave } from '../../../src/waves/hub-helpers.js';

const SAMPLE_ENTRY: WaveRegistryEntry = {
  name: 'test-wave',
  description: 'Test wave',
  author: 'test-author',
  source: 'github:test/wave',
  triggers: ['test'],
  version: '1.0.0',
};

const SAMPLE_LISTED_WAVE: ListedWave = {
  name: 'local-wave',
  version: '1.0.0',
  source: 'bundled' as const,
  status: 'enabled' as const,
  waveCategory: 'personal' as const,
};

describe('wave-card-mapper trust fields', () => {
  describe('registryEntryToWaveCard', () => {
    it('sets trust fields to null when no trust data exists', () => {
      const card = registryEntryToWaveCard(SAMPLE_ENTRY);

      expect(card.trustScore).toBeNull();
      expect(card.trustTier).toBeNull();
      expect(card.authorProfile).toBeNull();
      expect(card.publishedAt).toBeNull();
      expect(card.updatedAt).toBeNull();
      expect(card.packageHash).toBeNull();
    });

    it('uses registry communityTrust as trustScore when no local override', () => {
      const entry: WaveRegistryEntry = { ...SAMPLE_ENTRY, communityTrust: 72 };
      const card = registryEntryToWaveCard(entry);

      expect(card.trustScore).toBe(72);
    });

    it('computes trustTier from communityTrust via getTrustTier', () => {
      const entry: WaveRegistryEntry = { ...SAMPLE_ENTRY, communityTrust: 55 };
      const card = registryEntryToWaveCard(entry);

      expect(card.trustTier).toBe('community');
    });

    it('overrides registry communityTrust with localData trustScore', () => {
      const entry: WaveRegistryEntry = { ...SAMPLE_ENTRY, communityTrust: 40 };
      const card = registryEntryToWaveCard(entry, {
        installed: true,
        trustScore: 90,
      });

      expect(card.trustScore).toBe(90);
    });

    it('overrides computed tier with localData trustTier', () => {
      const entry: WaveRegistryEntry = { ...SAMPLE_ENTRY, communityTrust: 55 };
      const card = registryEntryToWaveCard(entry, {
        installed: true,
        trustTier: 'trusted',
      });

      // communityTrust of 55 would compute to 'community', but localData overrides it
      expect(card.trustTier).toBe('trusted');
    });

    it('sets authorProfile from localData', () => {
      const authorProfile = {
        githubUsername: 'octocat',
        displayName: 'Octo Cat',
        avatarUrl: 'https://example.com/avatar.png',
      };
      const card = registryEntryToWaveCard(SAMPLE_ENTRY, {
        installed: true,
        authorProfile,
      });

      expect(card.authorProfile).toEqual(authorProfile);
    });

    it('maps publishedAt and updatedAt from registry entry', () => {
      const entry: WaveRegistryEntry = {
        ...SAMPLE_ENTRY,
        publishedAt: '2026-01-15T10:00:00Z',
        updatedAt: '2026-02-20T14:30:00Z',
      };
      const card = registryEntryToWaveCard(entry);

      expect(card.publishedAt).toBe('2026-01-15T10:00:00Z');
      expect(card.updatedAt).toBe('2026-02-20T14:30:00Z');
    });

    it('maps packageHash from registry entry', () => {
      const entry: WaveRegistryEntry = {
        ...SAMPLE_ENTRY,
        packageHash: 'sha256-abc123def456',
      };
      const card = registryEntryToWaveCard(entry);

      expect(card.packageHash).toBe('sha256-abc123def456');
    });

    it('computes tier "trusted" for communityTrust of 85', () => {
      const entry: WaveRegistryEntry = { ...SAMPLE_ENTRY, communityTrust: 85 };
      const card = registryEntryToWaveCard(entry);

      expect(card.trustScore).toBe(85);
      expect(card.trustTier).toBe('trusted');
    });
  });

  describe('listedWaveToWaveCard', () => {
    it('sets all trust fields to null', () => {
      const card = listedWaveToWaveCard(SAMPLE_LISTED_WAVE);

      expect(card.trustScore).toBeNull();
      expect(card.trustTier).toBeNull();
      expect(card.authorProfile).toBeNull();
      expect(card.publishedAt).toBeNull();
      expect(card.updatedAt).toBeNull();
      expect(card.packageHash).toBeNull();
    });
  });
});
