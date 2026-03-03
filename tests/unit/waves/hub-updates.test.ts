import { describe, it, expect, vi } from 'vitest';
import {
  isNewerVersion,
  checkForUpdates,
  searchRegistry,
  type WaveUpdateInfo,
} from '../../../src/waves/hub-registry.js';

// Mock dependencies
vi.mock('../../../src/waves/hub.js', () => ({
  listWaves: vi.fn().mockReturnValue([
    { name: 'weather-checker', version: '1.0.0', source: 'installed', status: 'enabled' },
    { name: 'note-taker', version: '1.0.0', source: 'installed', status: 'enabled' },
    { name: 'email-reader', version: '1.0.0', source: 'bundled', status: 'enabled' },
    { name: 'custom-wave', version: '2.0.0', source: 'installed', status: 'enabled' },
  ]),
  installWave: vi.fn(),
  uninstallWave: vi.fn(),
  searchWaves: vi.fn(),
}));

vi.mock('../../../src/persistence/wave-hub-cache.js', () => ({
  getCachedRegistry: vi.fn().mockReturnValue({
    data: JSON.stringify({
      version: '1',
      waves: [
        { name: 'weather-checker', description: 'Check weather', author: 'community', source: 'github:community/weather-checker', triggers: ['weather'], version: '1.2.0' },
        { name: 'note-taker', description: 'Take notes', author: 'community', source: 'github:community/note-taker', triggers: ['note'], version: '1.0.0' },
        { name: 'email-reader', description: 'Read emails', author: 'community', source: 'github:community/email-reader', triggers: ['email'], version: '2.0.0' },
        { name: 'new-wave', description: 'Brand new', author: 'community', source: 'github:community/new-wave', triggers: ['new'], version: '1.0.0' },
      ],
    }),
    etag: null,
  }),
  setCachedRegistry: vi.fn(),
  getCachedEtag: vi.fn().mockReturnValue(null),
}));

describe('isNewerVersion', () => {
  it('detects newer major version', () => {
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true);
  });

  it('detects newer minor version', () => {
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
  });

  it('detects newer patch version', () => {
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
  });

  it('returns false for same version', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns false for older version', () => {
    expect(isNewerVersion('2.0.0', '1.0.0')).toBe(false);
  });

  it('handles version strings with v prefix', () => {
    expect(isNewerVersion('v1.0.0', 'v1.1.0')).toBe(true);
  });

  it('handles two-part versions', () => {
    expect(isNewerVersion('1.0', '1.1')).toBe(true);
  });

  it('handles mismatched version lengths', () => {
    expect(isNewerVersion('1.0', '1.0.1')).toBe(true);
    expect(isNewerVersion('1.0.1', '1.0')).toBe(false);
  });

  it('compares major before minor', () => {
    expect(isNewerVersion('1.9.9', '2.0.0')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });
});

describe('checkForUpdates', () => {
  it('finds waves with available updates', async () => {
    const db = {} as never;
    const updates = await checkForUpdates(db);

    // weather-checker: 1.0.0 → 1.2.0 (update available)
    // note-taker: 1.0.0 → 1.0.0 (no update)
    // email-reader: 1.0.0 → 2.0.0 (update available)
    // custom-wave: 2.0.0 → not in registry (no update)
    expect(updates).toHaveLength(2);

    const weatherUpdate = updates.find((u: WaveUpdateInfo) => u.name === 'weather-checker');
    expect(weatherUpdate).toBeDefined();
    expect(weatherUpdate!.currentVersion).toBe('1.0.0');
    expect(weatherUpdate!.latestVersion).toBe('1.2.0');

    const emailUpdate = updates.find((u: WaveUpdateInfo) => u.name === 'email-reader');
    expect(emailUpdate).toBeDefined();
    expect(emailUpdate!.currentVersion).toBe('1.0.0');
    expect(emailUpdate!.latestVersion).toBe('2.0.0');
  });

  it('returns empty array when no updates available', async () => {
    const { listWaves } = await import('../../../src/waves/hub.js');
    vi.mocked(listWaves).mockReturnValueOnce([
      { name: 'note-taker', version: '1.0.0', source: 'installed', status: 'enabled' },
    ]);

    const db = {} as never;
    const updates = await checkForUpdates(db);
    expect(updates).toHaveLength(0);
  });
});

describe('searchRegistry', () => {
  const waves = [
    { name: 'weather-checker', description: 'Check weather forecasts', author: 'community', source: 'github:community/weather-checker', triggers: ['weather', 'forecast'], version: '1.0.0' },
    { name: 'note-taker', description: 'Take and organize notes', author: 'community', source: 'github:community/note-taker', triggers: ['note', 'notes'], version: '1.0.0' },
    { name: 'email-summarizer', description: 'Summarize emails', author: 'community', source: 'github:community/email-summarizer', triggers: ['email', 'inbox'], version: '1.0.0' },
  ];

  it('matches by name', () => {
    const results = searchRegistry(waves, 'weather');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('weather-checker');
  });

  it('matches by description', () => {
    const results = searchRegistry(waves, 'organize');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('note-taker');
  });

  it('matches by trigger', () => {
    const results = searchRegistry(waves, 'inbox');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('email-summarizer');
  });

  it('is case-insensitive', () => {
    const results = searchRegistry(waves, 'WEATHER');
    expect(results).toHaveLength(1);
  });

  it('returns empty for no matches', () => {
    const results = searchRegistry(waves, 'zzz-nonexistent');
    expect(results).toHaveLength(0);
  });
});
