import { describe, it, expect } from 'vitest';
import {
  buildGapDetectionPrompt,
  buildTemplateCompositionPrompt,
  buildFreeFormGenerationPrompt,
} from '../../../src/waves/shorebreak-prompts.js';
import type { ShorebreakTemplate } from '../../../src/waves/shorebreak-templates/index.js';

describe('shorebreak prompts', () => {
  describe('buildGapDetectionPrompt', () => {
    it('returns a non-empty prompt', () => {
      const prompt = buildGapDetectionPrompt();
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('requests JSON-only output', () => {
      const prompt = buildGapDetectionPrompt();
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('isGap');
    });

    it('includes anti-thinking instruction', () => {
      const prompt = buildGapDetectionPrompt();
      expect(prompt.toLowerCase()).toContain('think');
      expect(prompt.toLowerCase()).toContain('immediately');
    });

    it('describes the gap detection criteria', () => {
      const prompt = buildGapDetectionPrompt();
      expect(prompt).toContain("can't");
      expect(prompt).toContain('suggestedWaveName');
    });
  });

  describe('buildTemplateCompositionPrompt', () => {
    it('includes the template builder prompt and user request', () => {
      const template: ShorebreakTemplate = {
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        triggers: ['test'],
        builderPrompt: 'Build a test wave',
        codeSkeleton: 'var execute = async function(params) { return "{{RESULT}}"; }',
        allowedDomains: ['api.test.com'],
        safetyTier: 'observe',
      };

      const prompt = buildTemplateCompositionPrompt(template, 'test request', { domain: 'api.test.com' });
      expect(prompt).toContain('Build a test wave');
      expect(prompt).toContain('test request');
      expect(prompt).toContain('{{RESULT}}');
    });
  });

  describe('buildFreeFormGenerationPrompt', () => {
    it('includes safety rules and wave info', () => {
      const prompt = buildFreeFormGenerationPrompt(
        'look up weather',
        'weather-lookup',
        'Look up weather conditions',
        ['api.weather.com'],
      );
      expect(prompt).toContain('STRICT SAFETY RULES');
      expect(prompt).toContain('weather-lookup');
      expect(prompt).toContain('api.weather.com');
    });

    it('handles empty domains', () => {
      const prompt = buildFreeFormGenerationPrompt(
        'calculate something',
        'calculator',
        'Simple calculator',
        [],
      );
      expect(prompt).toContain('No external domains needed');
    });
  });
});
