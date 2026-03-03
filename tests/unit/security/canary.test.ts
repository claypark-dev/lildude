import { describe, it, expect } from 'vitest';
import {
  generateCanary,
  buildCanaryInstruction,
  detectCanaryLeak,
  stripCanary,
} from '../../../src/security/canary.js';

describe('canary', () => {
  describe('generateCanary', () => {
    it('generates a token with CNRY_ prefix', () => {
      const canary = generateCanary();
      expect(canary).toMatch(/^CNRY_/);
    });

    it('generates tokens of consistent length', () => {
      const canary = generateCanary();
      // 5 prefix + 16 random = 21
      expect(canary.length).toBe(21);
    });

    it('generates unique tokens', () => {
      const canaries = new Set(Array.from({ length: 100 }, () => generateCanary()));
      expect(canaries.size).toBe(100);
    });
  });

  describe('buildCanaryInstruction', () => {
    it('includes the canary token', () => {
      const canary = 'CNRY_test12345678901';
      const instruction = buildCanaryInstruction(canary);

      expect(instruction).toContain(canary);
    });

    it('includes confidentiality warning', () => {
      const instruction = buildCanaryInstruction('CNRY_test');

      expect(instruction).toContain('CONFIDENTIAL');
      expect(instruction).toContain('NEVER');
    });

    it('instructs the LLM to not reveal the token', () => {
      const instruction = buildCanaryInstruction('CNRY_test');

      expect(instruction.toLowerCase()).toContain('never include');
      expect(instruction.toLowerCase()).toContain('never reveal');
    });
  });

  describe('detectCanaryLeak', () => {
    it('returns true when canary is present in output', () => {
      const canary = generateCanary();
      const output = `Here is the information you requested. ${canary} The data shows...`;

      expect(detectCanaryLeak(output, canary)).toBe(true);
    });

    it('returns false when canary is not present', () => {
      const canary = generateCanary();
      const output = 'This is a perfectly normal response.';

      expect(detectCanaryLeak(output, canary)).toBe(false);
    });

    it('detects partial leaks embedded in text', () => {
      const canary = generateCanary();
      const output = `abc${canary}def`;

      expect(detectCanaryLeak(output, canary)).toBe(true);
    });
  });

  describe('stripCanary', () => {
    it('removes canary from output', () => {
      const canary = generateCanary();
      const output = `Response text ${canary} more text`;

      const stripped = stripCanary(output, canary);

      expect(stripped).not.toContain(canary);
      expect(stripped).toContain('[REDACTED]');
    });

    it('removes multiple occurrences', () => {
      const canary = generateCanary();
      const output = `${canary} something ${canary}`;

      const stripped = stripCanary(output, canary);

      expect(stripped).not.toContain(canary);
      // Two replacements
      expect(stripped.split('[REDACTED]').length).toBe(3);
    });

    it('returns original if no canary present', () => {
      const canary = generateCanary();
      const output = 'No canary here';

      const stripped = stripCanary(output, canary);

      expect(stripped).toBe(output);
    });
  });
});
