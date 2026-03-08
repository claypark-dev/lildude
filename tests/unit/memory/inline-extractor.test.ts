import { describe, it, expect } from 'vitest';
import { extractInlineFacts } from '../../../src/memory/inline-extractor.js';

describe('inline-extractor', () => {
  describe('relationship patterns', () => {
    it('extracts "Sarah is my manager"', () => {
      const facts = extractInlineFacts('Sarah is my manager');
      expect(facts).toHaveLength(1);
      expect(facts[0].category).toBe('user_fact');
      expect(facts[0].key).toBe('relationship:sarah');
      expect(facts[0].value).toBe('manager');
      expect(facts[0].confidence).toBe(0.8);
      expect(facts[0].entities).toEqual([{ name: 'Sarah', type: 'person' }]);
    });

    it('extracts "my dentist is Dr Kim"', () => {
      const facts = extractInlineFacts('my dentist is Dr Kim');
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('relationship:dr kim');
      expect(facts[0].value).toBe('dentist');
    });

    it('extracts "Bob is my coworker"', () => {
      const facts = extractInlineFacts('Bob is my coworker');
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('relationship:bob');
      expect(facts[0].value).toBe('coworker');
    });

    it('extracts employer from "I work at Google"', () => {
      const facts = extractInlineFacts('I work at Google');
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('employer');
      expect(facts[0].value).toBe('Google');
      expect(facts[0].entities).toEqual([{ name: 'Google', type: 'organization' }]);
    });

    it('extracts employer from "I work for Anthropic"', () => {
      const facts = extractInlineFacts('I work for Anthropic');
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('employer');
      expect(facts[0].value).toBe('Anthropic');
    });
  });

  describe('personal fact patterns', () => {
    it('extracts location from "I live in Seattle"', () => {
      const facts = extractInlineFacts('I live in Seattle');
      expect(facts).toHaveLength(1);
      expect(facts[0].category).toBe('user_fact');
      expect(facts[0].key).toBe('lives_in');
      expect(facts[0].value).toBe('Seattle');
      expect(facts[0].confidence).toBe(0.8);
      expect(facts[0].entities).toEqual([{ name: 'Seattle', type: 'location' }]);
    });

    it('extracts birthday from "my birthday is March 15"', () => {
      const facts = extractInlineFacts('my birthday is March 15');
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('user_birthday');
      expect(facts[0].value).toBe('March 15');
      expect(facts[0].confidence).toBe(0.9);
    });

    it('extracts email from "my email is clay@example.com"', () => {
      const facts = extractInlineFacts('my email is clay@example.com');
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('user_email');
      expect(facts[0].value).toBe('clay@example.com');
    });

    it('extracts phone from "my phone number is 555-1234"', () => {
      const facts = extractInlineFacts('my phone number is 555-1234');
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('user_phone');
      expect(facts[0].value).toBe('555-1234');
    });

    it('extracts favorites as user_preference', () => {
      const facts = extractInlineFacts('my favorite color is blue');
      expect(facts).toHaveLength(1);
      expect(facts[0].category).toBe('user_preference');
      expect(facts[0].key).toBe('favorite_color');
      expect(facts[0].value).toBe('color: blue');
    });
  });

  describe('contact fact patterns', () => {
    it('extracts contact email from "Sarah\'s email is sarah@work.com"', () => {
      const facts = extractInlineFacts("Sarah's email is sarah@work.com");
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('sarah_email');
      expect(facts[0].value).toBe('sarah@work.com');
      expect(facts[0].entities).toEqual([{ name: 'Sarah', type: 'person' }]);
    });

    it('extracts contact phone from "Sarah\'s phone is 555-9876"', () => {
      const facts = extractInlineFacts("Sarah's phone is 555-9876");
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('sarah_phone');
      expect(facts[0].value).toBe('555-9876');
    });

    it('extracts contact birthday from "Sarah\'s birthday is June 5"', () => {
      const facts = extractInlineFacts("Sarah's birthday is June 5");
      expect(facts).toHaveLength(1);
      expect(facts[0].key).toBe('sarah_birthday');
      expect(facts[0].value).toBe('June 5');
    });
  });

  describe('correction detection', () => {
    it('detects "actually" as a correction signal', () => {
      const facts = extractInlineFacts('actually I live in Portland');
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].isCorrection).toBe(true);
    });

    it('detects "I changed" as a correction signal', () => {
      const facts = extractInlineFacts('I changed my email is new@email.com');
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].isCorrection).toBe(true);
    });

    it('does not flag normal messages as corrections', () => {
      const facts = extractInlineFacts('I live in Seattle');
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].isCorrection).toBe(false);
    });
  });

  describe('temporal update patterns', () => {
    it('extracts "I just moved to Portland"', () => {
      const facts = extractInlineFacts('I just moved to Portland');
      expect(facts.length).toBeGreaterThan(0);
      const movedFact = facts.find((f) => f.key === 'lives_in');
      expect(movedFact).toBeDefined();
      expect(movedFact!.value).toBe('Portland');
      expect(movedFact!.isCorrection).toBe(true);
    });

    it('extracts "I recently switched to part-time"', () => {
      const facts = extractInlineFacts('I recently switched to part-time');
      expect(facts.length).toBeGreaterThan(0);
      const changeFact = facts.find((f) => f.key === 'recent_change');
      expect(changeFact).toBeDefined();
      expect(changeFact!.value).toBe('part-time');
      expect(changeFact!.isCorrection).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for short messages', () => {
      expect(extractInlineFacts('hi')).toEqual([]);
      expect(extractInlineFacts('')).toEqual([]);
    });

    it('returns empty array for messages with no patterns', () => {
      expect(extractInlineFacts('What is the weather like today?')).toEqual([]);
    });

    it('extracts multiple facts from one message', () => {
      const facts = extractInlineFacts('I live in Seattle and Sarah is my manager');
      expect(facts.length).toBe(2);
    });
  });
});
