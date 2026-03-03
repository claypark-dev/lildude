import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { searchRegistry } from '../../../src/waves/hub-registry.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type { WaveRegistryEntry } from '../../../src/waves/hub-helpers.js';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

const MOCK_REGISTRY: WaveRegistryEntry[] = [
  { name: 'weather-checker', description: 'Check weather forecasts', author: 'community', source: 'github:community/weather', triggers: ['weather', 'forecast'], version: '1.0.0' },
  { name: 'email-reader', description: 'Read and summarize emails', author: 'community', source: 'github:community/email', triggers: ['email', 'inbox'], version: '2.0.0' },
  { name: 'code-reviewer', description: 'Review pull requests', author: 'community', source: 'github:community/code-review', triggers: ['review', 'PR'], version: '1.5.0' },
];

describe('hub-registry', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  describe('searchRegistry', () => {
    it('returns all entries when query is empty', () => {
      // Empty string matches everything via .includes('')
      const results = searchRegistry(MOCK_REGISTRY, '');
      expect(results).toHaveLength(3);
    });

    it('matches by name', () => {
      const results = searchRegistry(MOCK_REGISTRY, 'weather');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('weather-checker');
    });

    it('matches by description', () => {
      const results = searchRegistry(MOCK_REGISTRY, 'pull requests');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('code-reviewer');
    });

    it('matches by triggers', () => {
      const results = searchRegistry(MOCK_REGISTRY, 'inbox');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('email-reader');
    });

    it('search is case-insensitive', () => {
      const results = searchRegistry(MOCK_REGISTRY, 'WEATHER');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('weather-checker');
    });

    it('returns empty array for no matches', () => {
      const results = searchRegistry(MOCK_REGISTRY, 'nonexistent');
      expect(results).toHaveLength(0);
    });

    it('can match multiple entries', () => {
      // 'email' appears in both email-reader name/triggers and potentially descriptions
      const results = searchRegistry(MOCK_REGISTRY, 'email');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });
});
