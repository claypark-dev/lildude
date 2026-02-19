import { describe, it, expect, beforeEach } from 'vitest';
import type { Skill, SkillManifest, SkillPlan, ToolResult } from '../../../src/types/index.js';
import {
  registerSkill,
  getSkill,
  matchSkill,
  getAllSkills,
  clearRegistry,
} from '../../../src/skills/registry.js';

/** Create a minimal test skill with specified manifest overrides. */
function createTestSkill(overrides: Partial<SkillManifest> = {}): Skill {
  const manifest: SkillManifest = {
    name: overrides.name ?? 'test-skill',
    version: '1.0.0',
    description: 'A test skill',
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
    plan: async (_userInput: string, _context: Record<string, unknown>): Promise<SkillPlan> => ({
      steps: [],
      estimatedCostUsd: 0,
      isDeterministic: true,
      extractedParams: {},
    }),
    execute: async (_plan: SkillPlan): Promise<ToolResult> => ({
      success: true,
      output: 'test output',
    }),
  };
}

describe('skill registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe('registerSkill and getSkill', () => {
    it('registers a skill and retrieves it by name', () => {
      const skill = createTestSkill({ name: 'my-skill' });

      registerSkill('my-skill', skill);

      const retrieved = getSkill('my-skill');
      expect(retrieved).toBeDefined();
      expect(retrieved!.manifest.name).toBe('my-skill');
    });

    it('returns undefined for unregistered skill name', () => {
      const retrieved = getSkill('nonexistent-skill');
      expect(retrieved).toBeUndefined();
    });

    it('overwrites an existing skill with the same name', () => {
      const skillV1 = createTestSkill({ name: 'my-skill', version: '1.0.0' });
      const skillV2 = createTestSkill({ name: 'my-skill', version: '2.0.0' });

      registerSkill('my-skill', skillV1);
      registerSkill('my-skill', skillV2);

      const retrieved = getSkill('my-skill');
      expect(retrieved!.manifest.version).toBe('2.0.0');
    });
  });

  describe('getAllSkills', () => {
    it('returns all registered skills', () => {
      registerSkill('skill-a', createTestSkill({ name: 'skill-a' }));
      registerSkill('skill-b', createTestSkill({ name: 'skill-b' }));

      const allSkills = getAllSkills();
      expect(allSkills.size).toBe(2);
      expect(allSkills.has('skill-a')).toBe(true);
      expect(allSkills.has('skill-b')).toBe(true);
    });

    it('returns an empty map when no skills are registered', () => {
      const allSkills = getAllSkills();
      expect(allSkills.size).toBe(0);
    });
  });

  describe('matchSkill', () => {
    it('"check my stocks" matches skill with trigger "stock"', () => {
      const stockSkill = createTestSkill({
        name: 'stock-checker',
        triggers: ['stock', 'stocks', 'share price', 'ticker'],
      });
      registerSkill('stock-checker', stockSkill);

      const match = matchSkill('check my stocks');
      expect(match).not.toBeNull();
      expect(match!.skill.manifest.name).toBe('stock-checker');
      expect(match!.score).toBeGreaterThan(0);
    });

    it('"tell me a joke" returns null when no triggers match', () => {
      const stockSkill = createTestSkill({
        name: 'stock-checker',
        triggers: ['stock', 'stocks', 'share price'],
      });
      registerSkill('stock-checker', stockSkill);

      const match = matchSkill('tell me a joke');
      expect(match).toBeNull();
    });

    it('performs case-insensitive matching', () => {
      const weatherSkill = createTestSkill({
        name: 'weather',
        triggers: ['weather', 'forecast', 'temperature'],
      });
      registerSkill('weather', weatherSkill);

      const matchUpper = matchSkill('What is the WEATHER today?');
      expect(matchUpper).not.toBeNull();
      expect(matchUpper!.skill.manifest.name).toBe('weather');

      const matchMixed = matchSkill('Check the Forecast please');
      expect(matchMixed).not.toBeNull();
      expect(matchMixed!.skill.manifest.name).toBe('weather');
    });

    it('returns the highest-scoring skill when multiple match', () => {
      const stockSkill = createTestSkill({
        name: 'stock-checker',
        triggers: ['stock', 'price'],
      });
      const financeSkill = createTestSkill({
        name: 'finance-advisor',
        triggers: ['stock', 'price', 'portfolio', 'market'],
      });
      registerSkill('stock-checker', stockSkill);
      registerSkill('finance-advisor', financeSkill);

      // "stock price of my portfolio in the market" should match finance-advisor better
      // because it matches more triggers (stock, price, portfolio, market)
      const match = matchSkill('stock price of my portfolio in the market');
      expect(match).not.toBeNull();
      expect(match!.skill.manifest.name).toBe('finance-advisor');
    });

    it('returns null when no skills are registered', () => {
      const match = matchSkill('anything at all');
      expect(match).toBeNull();
    });

    it('matches partial words that contain trigger text', () => {
      const stockSkill = createTestSkill({
        name: 'stock-checker',
        triggers: ['stock'],
      });
      registerSkill('stock-checker', stockSkill);

      // "stocks" contains "stock" as a substring
      const match = matchSkill('check my stocks');
      expect(match).not.toBeNull();
    });
  });
});
