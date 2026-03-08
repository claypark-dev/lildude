import { describe, it, expect } from 'vitest';
import { stripThinkTags, antiThinkingInstruction, prependNoThink } from '../../../src/utils/think-strip.js';

describe('think-strip utilities', () => {
  describe('stripThinkTags', () => {
    it('strips a single <think> block and returns remaining text', () => {
      const input = '<think>\nLet me think about this...\n</think>\n{"symbol": "CRM"}';
      expect(stripThinkTags(input)).toBe('{"symbol": "CRM"}');
    });

    it('strips multiple <think> blocks', () => {
      const input = '<think>first thought</think> hello <think>second thought</think> world';
      expect(stripThinkTags(input)).toBe('hello  world');
    });

    it('handles multiline thinking blocks', () => {
      const input = '<think>\nLine 1\nLine 2\nLine 3\n</think>\n{"score": 0.9}';
      expect(stripThinkTags(input)).toBe('{"score": 0.9}');
    });

    it('returns empty string when entire response is a think block', () => {
      const input = '<think>\nSpent all tokens on reasoning...\n</think>';
      expect(stripThinkTags(input)).toBe('');
    });

    it('passes through text with no think tags unchanged', () => {
      const input = '{"score": 0.9, "feedback": "looks good"}';
      expect(stripThinkTags(input)).toBe('{"score": 0.9, "feedback": "looks good"}');
    });

    it('handles empty string', () => {
      expect(stripThinkTags('')).toBe('');
    });

    it('handles nested angle brackets inside think tags', () => {
      const input = '<think>The user wants <stock> data for CRM</think>\n{"symbol": "CRM"}';
      expect(stripThinkTags(input)).toBe('{"symbol": "CRM"}');
    });

    it('strips tags and trims whitespace', () => {
      const input = '  <think>reasoning</think>  \n  result  \n  ';
      expect(stripThinkTags(input)).toBe('result');
    });

    it('strips unclosed think tags (model ran out of tokens mid-reasoning)', () => {
      const input = '<think>unclosed tag {"result": true}';
      // Unclosed <think> blocks are stripped — the model likely ran out of tokens
      // while reasoning, and we don't want raw thinking leaked to the user.
      expect(stripThinkTags(input)).toBe('');
    });

    it('preserves text before an unclosed think tag', () => {
      const input = 'Some answer text <think>unclosed reasoning...';
      expect(stripThinkTags(input)).toBe('Some answer text');
    });
  });

  describe('antiThinkingInstruction', () => {
    it('returns a non-empty instruction string', () => {
      const instruction = antiThinkingInstruction();
      expect(instruction.length).toBeGreaterThan(0);
    });

    it('mentions think tags', () => {
      const instruction = antiThinkingInstruction();
      expect(instruction.toLowerCase()).toContain('think');
    });

    it('instructs to output immediately', () => {
      const instruction = antiThinkingInstruction();
      expect(instruction.toLowerCase()).toContain('immediately');
    });
  });

  describe('prependNoThink', () => {
    it('prepends /no_think to user message', () => {
      const result = prependNoThink('stock price for CRM');
      expect(result).toBe('/no_think\nstock price for CRM');
    });

    it('handles empty message', () => {
      const result = prependNoThink('');
      expect(result).toBe('/no_think\n');
    });

    it('handles multiline message', () => {
      const result = prependNoThink('line 1\nline 2');
      expect(result).toBe('/no_think\nline 1\nline 2');
    });
  });
});
