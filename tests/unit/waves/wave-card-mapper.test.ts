import { describe, it, expect } from 'vitest';
import {
  nameToDisplayName,
  registryEntryToWaveCard,
  listedWaveToWaveCard,
  mergeRegistryWithLocal,
} from '../../../src/waves/wave-card-mapper.js';
import type { LocalWaveData } from '../../../src/waves/wave-card-mapper.js';
import type { WaveRegistryEntry, ListedWave } from '../../../src/waves/hub-helpers.js';

const SAMPLE_ENTRY: WaveRegistryEntry = {
  name: 'weather-checker',
  description: 'Check weather',
  author: 'community',
  source: 'github:claypark-dev/weather-checker',
  triggers: ['weather'],
  version: '1.0.0',
  category: 'utilities',
  tags: ['weather'],
  waveCategory: 'personal' as const,
  safetyTier: 'observe',
  deterministic: true,
  verified: true,
  installCount: 100,
  averageRating: 4.5,
  ratingCount: 10,
};

const SAMPLE_LISTED_WAVE: ListedWave = {
  name: 'my-wave',
  version: '1.0.0',
  source: 'bundled' as const,
  status: 'enabled' as const,
  waveCategory: 'personal' as const,
};

describe('wave-card-mapper', () => {
  describe('nameToDisplayName', () => {
    it('converts a single hyphenated name to title case', () => {
      expect(nameToDisplayName('weather-checker')).toBe('Weather Checker');
    });

    it('converts a multi-segment hyphenated name', () => {
      expect(nameToDisplayName('email-reader-pro')).toBe('Email Reader Pro');
    });

    it('handles a single-word name', () => {
      expect(nameToDisplayName('reminders')).toBe('Reminders');
    });

    it('capitalizes the first character of each word', () => {
      expect(nameToDisplayName('code-reviewer')).toBe('Code Reviewer');
    });

    it('handles names with numbers', () => {
      expect(nameToDisplayName('wave-v2')).toBe('Wave V2');
    });
  });

  describe('registryEntryToWaveCard', () => {
    it('maps all required fields from the registry entry', () => {
      const card = registryEntryToWaveCard(SAMPLE_ENTRY);

      expect(card.name).toBe('weather-checker');
      expect(card.displayName).toBe('Weather Checker');
      expect(card.description).toBe('Check weather');
      expect(card.author).toBe('community');
      expect(card.version).toBe('1.0.0');
      expect(card.source).toBe('github:claypark-dev/weather-checker');
    });

    it('maps optional hub marketplace fields correctly', () => {
      const card = registryEntryToWaveCard(SAMPLE_ENTRY);

      expect(card.category).toBe('utilities');
      expect(card.tags).toEqual(['weather']);
      expect(card.installCount).toBe(100);
      expect(card.averageRating).toBe(4.5);
      expect(card.ratingCount).toBe(10);
      expect(card.verified).toBe(true);
      expect(card.safetyTier).toBe('observe');
      expect(card.deterministic).toBe(true);
    });

    it('defaults installed to false when no local data is provided', () => {
      const card = registryEntryToWaveCard(SAMPLE_ENTRY);
      expect(card.installed).toBe(false);
    });

    it('sets installed to true when local data indicates installation', () => {
      const localData: LocalWaveData = { installed: true };
      const card = registryEntryToWaveCard(SAMPLE_ENTRY, localData);
      expect(card.installed).toBe(true);
    });

    it('prefers local average rating over registry rating', () => {
      const localData: LocalWaveData = { installed: true, localAverageRating: 3.2 };
      const card = registryEntryToWaveCard(SAMPLE_ENTRY, localData);
      expect(card.averageRating).toBe(3.2);
    });

    it('falls back to "uncategorized" when category is missing', () => {
      const entryNoCategory: WaveRegistryEntry = { ...SAMPLE_ENTRY, category: undefined };
      const card = registryEntryToWaveCard(entryNoCategory);
      expect(card.category).toBe('uncategorized');
    });

    it('defaults tags to empty array when missing', () => {
      const entryNoTags: WaveRegistryEntry = { ...SAMPLE_ENTRY, tags: undefined };
      const card = registryEntryToWaveCard(entryNoTags);
      expect(card.tags).toEqual([]);
    });

    it('sets isPartyWave to true for party waveCategory', () => {
      const partyEntry: WaveRegistryEntry = { ...SAMPLE_ENTRY, waveCategory: 'party' };
      const card = registryEntryToWaveCard(partyEntry);
      expect(card.isPartyWave).toBe(true);
    });

    it('sets isPartyWave to false for personal waveCategory', () => {
      const card = registryEntryToWaveCard(SAMPLE_ENTRY);
      expect(card.isPartyWave).toBe(false);
    });

    it('defaults iconUrl to null when not provided', () => {
      const card = registryEntryToWaveCard(SAMPLE_ENTRY);
      expect(card.iconUrl).toBeNull();
    });
  });

  describe('listedWaveToWaveCard', () => {
    it('creates a card from a bundled local wave with expected defaults', () => {
      const card = listedWaveToWaveCard(SAMPLE_LISTED_WAVE);

      expect(card.name).toBe('my-wave');
      expect(card.displayName).toBe('My Wave');
      expect(card.version).toBe('1.0.0');
      expect(card.source).toBe('bundled');
      expect(card.installed).toBe(true);
    });

    it('sets author to "lil-dude" for bundled waves', () => {
      const card = listedWaveToWaveCard(SAMPLE_LISTED_WAVE);
      expect(card.author).toBe('lil-dude');
    });

    it('sets author to "unknown" for installed (non-bundled) waves', () => {
      const installedWave: ListedWave = { ...SAMPLE_LISTED_WAVE, source: 'installed' };
      const card = listedWaveToWaveCard(installedWave);
      expect(card.author).toBe('unknown');
    });

    it('sets verified to true for bundled waves', () => {
      const card = listedWaveToWaveCard(SAMPLE_LISTED_WAVE);
      expect(card.verified).toBe(true);
    });

    it('sets verified to false for installed waves', () => {
      const installedWave: ListedWave = { ...SAMPLE_LISTED_WAVE, source: 'installed' };
      const card = listedWaveToWaveCard(installedWave);
      expect(card.verified).toBe(false);
    });

    it('sets isPartyWave and category correctly for party waveCategory', () => {
      const partyWave: ListedWave = { ...SAMPLE_LISTED_WAVE, waveCategory: 'party' };
      const card = listedWaveToWaveCard(partyWave);

      expect(card.isPartyWave).toBe(true);
      expect(card.category).toBe('party');
    });

    it('uses empty defaults for rating fields', () => {
      const card = listedWaveToWaveCard(SAMPLE_LISTED_WAVE);

      expect(card.installCount).toBe(0);
      expect(card.averageRating).toBe(0);
      expect(card.ratingCount).toBe(0);
      expect(card.tags).toEqual([]);
      expect(card.featured).toBe(false);
      expect(card.iconUrl).toBeNull();
    });
  });

  describe('mergeRegistryWithLocal', () => {
    it('maps registry entries without local matches as not installed', () => {
      const cards = mergeRegistryWithLocal([SAMPLE_ENTRY], [], new Map());

      expect(cards).toHaveLength(1);
      expect(cards[0].name).toBe('weather-checker');
      expect(cards[0].installed).toBe(false);
    });

    it('marks registry entries as installed when they appear in local waves', () => {
      const localWave: ListedWave = { ...SAMPLE_LISTED_WAVE, name: 'weather-checker' };
      const cards = mergeRegistryWithLocal([SAMPLE_ENTRY], [localWave], new Map());

      expect(cards[0].name).toBe('weather-checker');
      expect(cards[0].installed).toBe(true);
    });

    it('appends local-only waves not present in the registry', () => {
      const localOnlyWave: ListedWave = { ...SAMPLE_LISTED_WAVE, name: 'local-only-wave' };
      const cards = mergeRegistryWithLocal([SAMPLE_ENTRY], [localOnlyWave], new Map());

      expect(cards).toHaveLength(2);
      const localCard = cards.find((c) => c.name === 'local-only-wave');
      expect(localCard).not.toBeUndefined();
      expect(localCard!.installed).toBe(true);
    });

    it('does not duplicate a wave that appears in both registry and local list', () => {
      const localWave: ListedWave = { ...SAMPLE_LISTED_WAVE, name: 'weather-checker' };
      const cards = mergeRegistryWithLocal([SAMPLE_ENTRY], [localWave], new Map());

      const weatherCards = cards.filter((c) => c.name === 'weather-checker');
      expect(weatherCards).toHaveLength(1);
    });

    it('applies local data overrides via the localDataMap', () => {
      const localDataMap = new Map<string, LocalWaveData>([
        ['weather-checker', { installed: true, localAverageRating: 3.0, localRatingCount: 2 }],
      ]);
      const cards = mergeRegistryWithLocal([SAMPLE_ENTRY], [], localDataMap);

      expect(cards[0].averageRating).toBe(3.0);
    });

    it('returns empty array when registry and local are both empty', () => {
      const cards = mergeRegistryWithLocal([], [], new Map());
      expect(cards).toHaveLength(0);
    });
  });
});
