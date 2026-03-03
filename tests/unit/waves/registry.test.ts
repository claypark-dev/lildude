import { describe, it, expect, beforeEach } from 'vitest';
import type { Wave, WaveManifest, WavePlan, ToolResult } from '../../../src/types/index.js';
import {
  registerWave,
  getWave,
  matchWave,
  getAllWaves,
  clearRegistry,
} from '../../../src/waves/registry.js';

/** Create a minimal test wave with specified manifest overrides. */
function createTestWave(overrides: Partial<WaveManifest> = {}): Wave {
  const manifest: WaveManifest = {
    name: overrides.name ?? 'test-wave',
    version: '1.0.0',
    description: 'A test wave',
    author: 'test-author',
    permissions: {
      domains: [],
      shell: [],
      directories: [],
      requiresBrowser: false,
      requiresOAuth: [],
    },
    triggers: overrides.triggers ?? ['test'],
    deterministic: true,
    tools: [],
    minTier: 'basic',
    entryPoint: 'index.js',
    ...overrides,
  };

  return {
    manifest,
    plan: async (_userInput: string, _context: Record<string, unknown>): Promise<WavePlan> => ({
      steps: [],
      estimatedCostUsd: 0,
      isDeterministic: true,
      extractedParams: {},
    }),
    execute: async (_plan: WavePlan): Promise<ToolResult> => ({
      success: true,
      output: 'test output',
    }),
  };
}

describe('wave registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('registerWave and getWave', () => {
    it('registers a wave and retrieves it by name', () => {
      const wave = createTestWave({ name: 'my-wave' });

      registerWave('my-wave', wave);

      const retrieved = getWave('my-wave');
      expect(retrieved).toBeDefined();
      expect(retrieved!.manifest.name).toBe('my-wave');
    });

    it('returns undefined for unregistered wave name', () => {
      const retrieved = getWave('nonexistent-wave');
      expect(retrieved).toBeUndefined();
    });

    it('overwrites an existing wave with the same name', () => {
      const waveV1 = createTestWave({ name: 'my-wave', version: '1.0.0' });
      const waveV2 = createTestWave({ name: 'my-wave', version: '2.0.0' });

      registerWave('my-wave', waveV1);
      registerWave('my-wave', waveV2);

      const retrieved = getWave('my-wave');
      expect(retrieved!.manifest.version).toBe('2.0.0');
    });
  });

  describe('getAllWaves', () => {
    it('returns all registered waves', () => {
      registerWave('wave-a', createTestWave({ name: 'wave-a' }));
      registerWave('wave-b', createTestWave({ name: 'wave-b' }));

      const allWaves = getAllWaves();
      expect(allWaves.size).toBe(2);
      expect(allWaves.has('wave-a')).toBe(true);
      expect(allWaves.has('wave-b')).toBe(true);
    });

    it('returns an empty map when no waves are registered', () => {
      const allWaves = getAllWaves();
      expect(allWaves.size).toBe(0);
    });
  });

  describe('matchWave', () => {
    it('"check my stocks" matches wave with trigger "stock"', () => {
      const stockWave = createTestWave({
        name: 'stock-checker',
        triggers: ['stock', 'stocks', 'share price', 'ticker'],
      });
      registerWave('stock-checker', stockWave);

      const match = matchWave('check my stocks');
      expect(match).not.toBeNull();
      expect(match!.wave.manifest.name).toBe('stock-checker');
      expect(match!.score).toBeGreaterThan(0);
    });

    it('"tell me a joke" returns null when no triggers match', () => {
      const stockWave = createTestWave({
        name: 'stock-checker',
        triggers: ['stock', 'stocks', 'share price'],
      });
      registerWave('stock-checker', stockWave);

      const match = matchWave('tell me a joke');
      expect(match).toBeNull();
    });

    it('performs case-insensitive matching', () => {
      const weatherWave = createTestWave({
        name: 'weather',
        triggers: ['weather', 'forecast', 'temperature'],
      });
      registerWave('weather', weatherWave);

      const matchUpper = matchWave('What is the WEATHER today?');
      expect(matchUpper).not.toBeNull();
      expect(matchUpper!.wave.manifest.name).toBe('weather');

      const matchMixed = matchWave('Check the Forecast please');
      expect(matchMixed).not.toBeNull();
      expect(matchMixed!.wave.manifest.name).toBe('weather');
    });

    it('returns the highest-scoring wave when multiple match', () => {
      const stockWave = createTestWave({
        name: 'stock-checker',
        triggers: ['stock', 'price'],
      });
      const financeWave = createTestWave({
        name: 'finance-advisor',
        triggers: ['stock', 'price', 'portfolio', 'market'],
      });
      registerWave('stock-checker', stockWave);
      registerWave('finance-advisor', financeWave);

      // "stock price of my portfolio in the market" should match finance-advisor better
      // because it matches more triggers (stock, price, portfolio, market)
      const match = matchWave('stock price of my portfolio in the market');
      expect(match).not.toBeNull();
      expect(match!.wave.manifest.name).toBe('finance-advisor');
    });

    it('returns null when no waves are registered', () => {
      const match = matchWave('anything at all');
      expect(match).toBeNull();
    });

    it('matches partial words that contain trigger text', () => {
      const stockWave = createTestWave({
        name: 'stock-checker',
        triggers: ['stock'],
      });
      registerWave('stock-checker', stockWave);

      // "stocks" contains "stock" as a substring
      const match = matchWave('check my stocks');
      expect(match).not.toBeNull();
    });
  });
});
