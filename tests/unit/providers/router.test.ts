/**
 * Unit tests for the model router: complexity classification and model selection.
 */

import { describe, it, expect } from 'vitest';
import { classifyComplexity, selectModel } from '../../../src/providers/router.js';

describe('classifyComplexity', () => {
  describe('small tier classification', () => {
    it('"What time is it?" is classified as small', () => {
      const tier = classifyComplexity('What time is it?', false);
      expect(tier).toBe('small');
    });

    it('short statement without question mark is small', () => {
      const tier = classifyComplexity('hello', false);
      expect(tier).toBe('small');
    });

    it('short command is small', () => {
      const tier = classifyComplexity('set a timer for 5 minutes', false);
      expect(tier).toBe('small');
    });

    it('empty string is small', () => {
      const tier = classifyComplexity('', false);
      expect(tier).toBe('small');
    });
  });

  describe('large tier classification', () => {
    it('"Write a comprehensive analysis of..." is classified as large', () => {
      const tier = classifyComplexity(
        'Write a comprehensive analysis of the current economic situation',
        false,
      );
      expect(tier).toBe('large');
    });

    it('"thorough review" is classified as large', () => {
      const tier = classifyComplexity('thorough review', false);
      expect(tier).toBe('large');
    });

    it('"in-depth" keyword triggers large', () => {
      const tier = classifyComplexity('Give me an in-depth look at this', false);
      expect(tier).toBe('large');
    });

    it('"exhaustive" keyword triggers large', () => {
      const tier = classifyComplexity('exhaustive list please', false);
      expect(tier).toBe('large');
    });

    it('"detailed" keyword triggers large', () => {
      const tier = classifyComplexity('detailed breakdown of the problem', false);
      expect(tier).toBe('large');
    });

    it('"analyze" keyword triggers large', () => {
      const tier = classifyComplexity('analyze the logs from yesterday', false);
      expect(tier).toBe('large');
    });

    it('"compare" keyword triggers large', () => {
      const tier = classifyComplexity('compare these two frameworks', false);
      expect(tier).toBe('large');
    });

    it('"create a" keyword triggers large', () => {
      const tier = classifyComplexity('create a new landing page', false);
      expect(tier).toBe('large');
    });

    it('message over 100 words is classified as large', () => {
      const longMessage = Array.from({ length: 101 }, (_, i) => `word${i}`).join(' ');
      const tier = classifyComplexity(longMessage, false);
      expect(tier).toBe('large');
    });

    it('multi-step numbered list triggers large', () => {
      const tier = classifyComplexity(
        '1. First do this 2. Then do that 3. Finally wrap up',
        false,
      );
      expect(tier).toBe('large');
    });
  });

  describe('medium tier classification', () => {
    it('20-100 word message without large keywords is medium', () => {
      const mediumMessage = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
      const tier = classifyComplexity(mediumMessage, false);
      expect(tier).toBe('medium');
    });

    it('moderately complex question is medium', () => {
      const tier = classifyComplexity(
        'How does the authentication flow work in this project and what middleware is involved in the overall request processing pipeline when a user submits a form',
        false,
      );
      expect(tier).toBe('medium');
    });
  });

  describe('active skill handling', () => {
    it('simple message with active skill remains small', () => {
      const tier = classifyComplexity('yes', true);
      expect(tier).toBe('small');
    });

    it('short question with active skill is small', () => {
      const tier = classifyComplexity('What time is it?', true);
      expect(tier).toBe('small');
    });

    it('complex message with active skill is still large', () => {
      const tier = classifyComplexity(
        'Write a comprehensive analysis of the market trends',
        true,
      );
      expect(tier).toBe('large');
    });
  });
});

describe('selectModel', () => {
  describe('correct model for each tier', () => {
    it('selects claude-haiku for small tier when anthropic is enabled', () => {
      const selection = selectModel('small', ['anthropic']);
      expect(selection.model).toBe('claude-haiku-4-5-20251001');
      expect(selection.provider).toBe('anthropic');
      expect(selection.tier).toBe('small');
    });

    it('selects claude-sonnet for medium tier when anthropic is enabled', () => {
      const selection = selectModel('medium', ['anthropic']);
      expect(selection.model).toBe('claude-sonnet-4-5-20250929');
      expect(selection.provider).toBe('anthropic');
      expect(selection.tier).toBe('medium');
    });

    it('selects claude-opus for large tier when anthropic is enabled', () => {
      const selection = selectModel('large', ['anthropic']);
      expect(selection.model).toBe('claude-opus-4-6');
      expect(selection.provider).toBe('anthropic');
      expect(selection.tier).toBe('large');
    });

    it('selects gpt-4o-mini for small tier when only openai is enabled', () => {
      const selection = selectModel('small', ['openai']);
      expect(selection.model).toBe('gpt-4o-mini');
      expect(selection.provider).toBe('openai');
    });

    it('selects gpt-4o for medium tier when only openai is enabled', () => {
      const selection = selectModel('medium', ['openai']);
      expect(selection.model).toBe('gpt-4o');
      expect(selection.provider).toBe('openai');
    });

    it('selects gpt-4o for large tier when only openai is enabled', () => {
      const selection = selectModel('large', ['openai']);
      expect(selection.model).toBe('gpt-4o');
      expect(selection.provider).toBe('openai');
    });

    it('selects deepseek-chat for small tier when only deepseek is enabled', () => {
      const selection = selectModel('small', ['deepseek']);
      expect(selection.model).toBe('deepseek-chat');
      expect(selection.provider).toBe('deepseek');
    });
  });

  describe('fallback behavior', () => {
    it('falls back to openai when anthropic is unavailable for small tier', () => {
      const selection = selectModel('small', ['openai']);
      expect(selection.provider).toBe('openai');
      expect(selection.model).toBe('gpt-4o-mini');
    });

    it('falls back to openai when anthropic is unavailable for large tier', () => {
      const selection = selectModel('large', ['openai']);
      expect(selection.provider).toBe('openai');
      expect(selection.model).toBe('gpt-4o');
    });

    it('falls back to deepseek when anthropic and openai are unavailable for small tier', () => {
      const selection = selectModel('small', ['deepseek']);
      expect(selection.provider).toBe('deepseek');
      expect(selection.model).toBe('deepseek-chat');
    });

    it('throws when no providers are enabled', () => {
      expect(() => selectModel('small', [])).toThrow(
        /No model available for tier "small"/,
      );
    });

    it('throws when enabled providers have no models for the tier', () => {
      expect(() => selectModel('medium', ['deepseek'])).toThrow(
        /No model available for tier "medium"/,
      );
    });
  });

  describe('selection metadata', () => {
    it('includes estimated cost in USD', () => {
      const selection = selectModel('small', ['anthropic']);
      expect(selection.estimatedCostUsd).toBeGreaterThan(0);
      expect(typeof selection.estimatedCostUsd).toBe('number');
    });

    it('includes reasoning string', () => {
      const selection = selectModel('medium', ['anthropic', 'openai']);
      expect(selection.reasoning).toContain('claude-sonnet');
      expect(selection.reasoning.length).toBeGreaterThan(0);
    });

    it('prefers anthropic over openai when both are enabled', () => {
      const smallSelection = selectModel('small', ['anthropic', 'openai']);
      expect(smallSelection.provider).toBe('anthropic');

      const mediumSelection = selectModel('medium', ['anthropic', 'openai']);
      expect(mediumSelection.provider).toBe('anthropic');

      const largeSelection = selectModel('large', ['anthropic', 'openai']);
      expect(largeSelection.provider).toBe('anthropic');
    });
  });
});
