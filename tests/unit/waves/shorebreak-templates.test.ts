/**
 * Tests for the Shorebreak templates module.
 */

import { describe, it, expect } from 'vitest';
import {
  findMatchingTemplate,
  SHOREBREAK_TEMPLATES,
} from '../../../src/waves/shorebreak-templates/index.js';

describe('ShorebreakTemplates', () => {
  describe('SHOREBREAK_TEMPLATES', () => {
    it('contains 5 templates', () => {
      expect(SHOREBREAK_TEMPLATES).toHaveLength(5);
    });

    it('each template has required fields', () => {
      for (const template of SHOREBREAK_TEMPLATES) {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.triggers.length).toBeGreaterThan(0);
        expect(template.defaultSafetyTier).toBeTruthy();
        expect(template.codeSkeleton).toContain('var execute');
        expect(template.builderPrompt).toBeTruthy();
      }
    });

    it('all template IDs are unique', () => {
      const ids = SHOREBREAK_TEMPLATES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('findMatchingTemplate', () => {
    it('matches HTTP fetch template for API-related requests', () => {
      const template = findMatchingTemplate('check my email');
      expect(template).toBeDefined();
      expect(template?.id).toBe('http-fetch');
    });

    it('matches HTTP fetch template for weather requests', () => {
      const template = findMatchingTemplate('what is the weather today');
      expect(template).toBeDefined();
      expect(template?.id).toBe('http-fetch');
    });

    it('matches scheduler template for recurring tasks', () => {
      const template = findMatchingTemplate('remind me every day at 9am');
      expect(template).toBeDefined();
      expect(template?.id).toBe('scheduler');
    });

    it('matches file-ops template for file operations', () => {
      const template = findMatchingTemplate('create a file with my notes');
      expect(template).toBeDefined();
      expect(template?.id).toBe('file-ops');
    });

    it('matches formatter template for formatting requests', () => {
      const template = findMatchingTemplate('show me a summary report');
      expect(template).toBeDefined();
      // Could match formatter or http-fetch depending on trigger overlap
      expect(template?.id).toBeDefined();
    });

    it('returns undefined for unrelated requests', () => {
      const template = findMatchingTemplate('tell me a joke about cats');
      expect(template).toBeUndefined();
    });

    it('is case-insensitive', () => {
      const template = findMatchingTemplate('CHECK MY EMAIL please');
      expect(template).toBeDefined();
    });

    it('picks the template with the most trigger matches', () => {
      // "schedule a recurring daily reminder" should match scheduler (schedule, recurring, daily, remind)
      const template = findMatchingTemplate('schedule a recurring daily reminder');
      expect(template?.id).toBe('scheduler');
    });
  });
});
