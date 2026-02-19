import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';

const SKILL_DIR = join(__dirname, '..', '..', '..', 'skills', 'bundled', 'google-flights');

/** Dynamically import the skill module to test its exported functions. */
async function loadSkillModule() {
  const modulePath = join(SKILL_DIR, 'index.js');
  // Use a cache-busting query to avoid stale module caches in vitest
  const moduleUrl = `file://${modulePath}?t=${Date.now()}`;
  return import(moduleUrl) as Promise<{
    plan: (userInput: string, context: Record<string, unknown>) => Promise<{
      steps: Array<{
        type: string;
        description: string;
        params: Record<string, unknown>;
      }>;
      estimatedCostUsd: number;
      isDeterministic: boolean;
      extractedParams: Record<string, unknown>;
    }>;
    execute: (plan: {
      steps: Array<{
        type: string;
        description: string;
        params: Record<string, unknown>;
      }>;
      estimatedCostUsd: number;
      isDeterministic: boolean;
      extractedParams: Record<string, unknown>;
    }) => Promise<{
      success: boolean;
      output: string;
      error?: string;
      metadata?: Record<string, unknown>;
    }>;
    validate: (result: {
      success: boolean;
      output: string;
      error?: string;
    }) => Promise<{ valid: boolean; feedback?: string }>;
  }>;
}

describe('google-flights skill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('skill.json manifest', () => {
    it('has valid manifest structure', async () => {
      const { readFileSync } = await import('node:fs');
      const manifestPath = join(SKILL_DIR, 'skill.json');
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as Record<string, unknown>;

      expect(manifest['name']).toBe('google-flights');
      expect(manifest['version']).toBe('1.0.0');
      expect(manifest['deterministic']).toBe(false);
      expect(manifest['minTier']).toBe('standard');
    });

    it('requires browser permission', async () => {
      const { readFileSync } = await import('node:fs');
      const manifestPath = join(SKILL_DIR, 'skill.json');
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as Record<string, unknown>;
      const permissions = manifest['permissions'] as Record<string, unknown>;

      expect(permissions['requiresBrowser']).toBe(true);
      expect(permissions['domains']).toContain('www.google.com');
    });

    it('has flight-related triggers', async () => {
      const { readFileSync } = await import('node:fs');
      const manifestPath = join(SKILL_DIR, 'skill.json');
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as Record<string, unknown>;
      const triggers = manifest['triggers'] as string[];

      expect(triggers).toContain('flight');
      expect(triggers).toContain('flights');
      expect(triggers).toContain('fly');
      expect(triggers).toContain('travel');
    });

    it('requires standard tier (8GB+ RAM for browser)', async () => {
      const { readFileSync } = await import('node:fs');
      const manifestPath = join(SKILL_DIR, 'skill.json');
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw) as Record<string, unknown>;

      expect(manifest['minTier']).toBe('standard');
    });
  });

  describe('plan()', () => {
    it('extracts flight parameters from natural language input', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.plan(
        'Find me flights from new york to los angeles on 2026-03-15',
        {},
      );

      expect(result.extractedParams['from']).toBe('new york');
      expect(result.extractedParams['to']).toBe('los angeles');
      expect(result.extractedParams['date']).toBe('2026-03-15');
    });

    it('returns a browser_action step', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.plan(
        'Find flights from seattle to miami on 2026-04-01',
        {},
      );

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].type).toBe('browser_action');
      expect(result.steps[0].description).toContain('seattle');
      expect(result.steps[0].description).toContain('miami');
    });

    it('includes Google Flights URL in step params', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.plan(
        'Flights from chicago to denver on 2026-05-20',
        {},
      );

      const stepParams = result.steps[0].params;
      const url = stepParams['url'] as string;
      expect(url).toContain('google.com/travel/flights');
      expect(url).toContain('chicago');
      expect(url).toContain('denver');
    });

    it('sets isDeterministic to false', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.plan('flights from sfo to jfk on 2026-06-01', {});

      expect(result.isDeterministic).toBe(false);
    });

    it('handles input without clear parameters', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.plan('show me cheap flights', {});

      expect(result.extractedParams['from']).toBe('unknown');
      expect(result.extractedParams['to']).toBe('unknown');
      expect(result.extractedParams['date']).toBe('unknown');
      expect(result.steps).toHaveLength(1);
    });

    it('sets allowedDomains to www.google.com', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.plan(
        'flights from boston to london on 2026-07-10',
        {},
      );

      const stepParams = result.steps[0].params;
      expect(stepParams['allowedDomains']).toEqual(['www.google.com']);
    });
  });

  describe('execute()', () => {
    it('returns error when no steps in plan', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.execute({
        steps: [],
        estimatedCostUsd: 0,
        isDeterministic: false,
        extractedParams: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No steps');
    });

    it('returns error when browser tool is unavailable', async () => {
      const skillModule = await loadSkillModule();
      const plan = await skillModule.plan(
        'flights from sfo to lax on 2026-08-01',
        {},
      );

      // The browser tool import will fail since playwright is not installed
      // and the dist/ directory may not exist in tests
      const result = await skillModule.execute(plan);

      // Should fail gracefully (browser tool not available)
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('validate()', () => {
    it('returns valid when output contains flight keywords', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.validate({
        success: true,
        output: 'Found 5 flights. Delta Airlines departs at 8:00 AM, price $350, nonstop, duration 5h 30m',
      });

      expect(result.valid).toBe(true);
    });

    it('returns invalid when output lacks flight information', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.validate({
        success: true,
        output: 'The quick brown fox jumps over the lazy dog',
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('flight information');
    });

    it('returns invalid when execution failed', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.validate({
        success: false,
        output: '',
        error: 'Browser crashed',
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('Browser crashed');
    });

    it('detects airline keyword in results', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.validate({
        success: true,
        output: 'airline United offers multiple routes',
      });

      expect(result.valid).toBe(true);
    });

    it('detects price keyword in results', async () => {
      const skillModule = await loadSkillModule();
      const result = await skillModule.validate({
        success: true,
        output: 'Best price for this route is $299',
      });

      expect(result.valid).toBe(true);
    });
  });
});
