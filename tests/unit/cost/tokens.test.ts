import { describe, it, expect } from 'vitest';
import { countTokens, estimateMessageTokens } from '../../../src/cost/tokens.js';
import type { Message, ContentBlock } from '../../../src/types/index.js';

describe('countTokens', () => {
  it('returns a positive number for non-empty text', () => {
    const tokens = countTokens('Hello, world! This is a test message.');
    expect(tokens).toBeGreaterThan(0);
  });

  it('returns 0 for empty string', () => {
    const tokens = countTokens('');
    expect(tokens).toBe(0);
  });

  it('returns more tokens for longer text', () => {
    const shortTokens = countTokens('Hello');
    const longTokens = countTokens('Hello, this is a much longer sentence with more words and content.');
    expect(longTokens).toBeGreaterThan(shortTokens);
  });

  it('handles special characters', () => {
    const tokens = countTokens('Special chars: !@#$%^&*()');
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('estimateMessageTokens', () => {
  it('handles string content messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'What is the weather today?' },
    ];
    const tokens = estimateMessageTokens(messages);
    // Should include content tokens + per-message overhead (4) + reply priming (2)
    expect(tokens).toBeGreaterThan(6); // At least overhead + priming + some content
  });

  it('handles ContentBlock[] content', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Here is some text' },
      { type: 'tool_use', name: 'search', input: { query: 'weather' } },
    ];
    const messages: Message[] = [
      { role: 'assistant', content: blocks },
    ];
    const tokens = estimateMessageTokens(messages);
    expect(tokens).toBeGreaterThan(6);
  });

  it('adds per-message overhead for each message', () => {
    const singleMessage: Message[] = [
      { role: 'user', content: 'Hi' },
    ];
    const twoMessages: Message[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ];
    const singleTokens = estimateMessageTokens(singleMessage);
    const twoTokens = estimateMessageTokens(twoMessages);
    // The second set should have at least 4 more tokens (per-message overhead)
    // plus the content tokens of 'Hello'
    expect(twoTokens).toBeGreaterThan(singleTokens);
    // Difference should be at least 4 (overhead) + 1 (at minimum 1 token for 'Hello')
    expect(twoTokens - singleTokens).toBeGreaterThanOrEqual(5);
  });

  it('adds reply priming tokens at the end', () => {
    const emptyMessages: Message[] = [];
    const tokens = estimateMessageTokens(emptyMessages);
    // Even with no messages, reply priming should add 2 tokens
    expect(tokens).toBe(2);
  });

  it('handles tool_result content blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_result', toolUseId: 'tool_1', content: 'Result data here' },
    ];
    const messages: Message[] = [
      { role: 'user', content: blocks },
    ];
    const tokens = estimateMessageTokens(messages);
    expect(tokens).toBeGreaterThan(6);
  });

  it('handles mixed content blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Some text' },
      { type: 'image' }, // Image blocks with no text contribute 0
    ];
    const messages: Message[] = [
      { role: 'assistant', content: blocks },
    ];
    const tokens = estimateMessageTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });
});
