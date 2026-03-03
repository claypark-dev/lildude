import { describe, it, expect } from 'vitest';
import { applyMMR } from '../../../src/memory/mmr.js';
import type { HybridSearchResult } from '../../../src/memory/hybrid-search.js';

/** Helper: create a mock HybridSearchResult with sensible defaults. */
function mockResult(overrides: Partial<HybridSearchResult> & Pick<HybridSearchResult, 'knowledgeId' | 'key' | 'value' | 'score'>): HybridSearchResult {
  return {
    category: 'general',
    vectorScore: 0,
    bm25Score: 0,
    decayFactor: 1.0,
    ...overrides,
  };
}

describe('applyMMR', () => {
  it('returns empty array for empty input', () => {
    const result = applyMMR([], 0.7, 5);
    expect(result).toEqual([]);
  });

  it('returns the single result when only one is provided', () => {
    const results = [
      mockResult({ knowledgeId: 1, key: 'name', value: 'Alice', score: 0.9 }),
    ];
    const selected = applyMMR(results, 0.7, 5);
    expect(selected).toHaveLength(1);
    expect(selected[0].knowledgeId).toBe(1);
  });

  it('always selects the highest-scored result first', () => {
    const results = [
      mockResult({ knowledgeId: 1, key: 'name', value: 'Alice', score: 0.95 }),
      mockResult({ knowledgeId: 2, key: 'city', value: 'New York', score: 0.80 }),
      mockResult({ knowledgeId: 3, key: 'hobby', value: 'painting', score: 0.70 }),
    ];
    const selected = applyMMR(results, 0.7, 3);
    expect(selected[0].knowledgeId).toBe(1);
  });

  it('de-duplicates near-identical entries', () => {
    const results = [
      mockResult({ knowledgeId: 1, key: 'favorite food', value: 'pizza with extra cheese', score: 0.95 }),
      mockResult({ knowledgeId: 2, key: 'favorite food', value: 'pizza with extra cheese', score: 0.90 }),
      mockResult({ knowledgeId: 3, key: 'favorite food', value: 'pizza with extra cheese', score: 0.85 }),
      mockResult({ knowledgeId: 4, key: 'hobby', value: 'mountain biking trail rides', score: 0.60 }),
    ];

    // With diversity weighting, the diverse entry should be promoted
    const selected = applyMMR(results, 0.5, 3);

    // The diverse entry (hobby) should appear in the top 3, despite having lower score
    const selectedIds = selected.map((r) => r.knowledgeId);
    expect(selectedIds).toContain(4);
  });

  it('preserves variety across diverse entries', () => {
    const results = [
      mockResult({ knowledgeId: 1, key: 'name', value: 'Alice Johnson', score: 0.90 }),
      mockResult({ knowledgeId: 2, key: 'city', value: 'San Francisco', score: 0.85 }),
      mockResult({ knowledgeId: 3, key: 'hobby', value: 'rock climbing outdoors', score: 0.80 }),
      mockResult({ knowledgeId: 4, key: 'job', value: 'software engineer developer', score: 0.75 }),
    ];

    const selected = applyMMR(results, 0.7, 4);

    // All four results are diverse, so all should be selected
    expect(selected).toHaveLength(4);
    const selectedIds = selected.map((r) => r.knowledgeId);
    expect(selectedIds).toContain(1);
    expect(selectedIds).toContain(2);
    expect(selectedIds).toContain(3);
    expect(selectedIds).toContain(4);
  });

  it('limits output to maxResults', () => {
    const results = [
      mockResult({ knowledgeId: 1, key: 'a', value: 'alpha', score: 0.9 }),
      mockResult({ knowledgeId: 2, key: 'b', value: 'bravo', score: 0.8 }),
      mockResult({ knowledgeId: 3, key: 'c', value: 'charlie', score: 0.7 }),
      mockResult({ knowledgeId: 4, key: 'd', value: 'delta', score: 0.6 }),
      mockResult({ knowledgeId: 5, key: 'e', value: 'echo', score: 0.5 }),
    ];

    const selected = applyMMR(results, 0.7, 2);
    expect(selected).toHaveLength(2);
  });

  it('returns at most the number of available results if maxResults exceeds input', () => {
    const results = [
      mockResult({ knowledgeId: 1, key: 'a', value: 'alpha', score: 0.9 }),
      mockResult({ knowledgeId: 2, key: 'b', value: 'bravo', score: 0.8 }),
    ];

    const selected = applyMMR(results, 0.7, 10);
    expect(selected).toHaveLength(2);
  });

  it('with lambda=1.0 (pure relevance), returns results in original score order', () => {
    const results = [
      mockResult({ knowledgeId: 1, key: 'favorite food', value: 'pizza with cheese', score: 0.95 }),
      mockResult({ knowledgeId: 2, key: 'favorite food', value: 'pizza with cheese', score: 0.90 }),
      mockResult({ knowledgeId: 3, key: 'favorite food', value: 'pizza with cheese', score: 0.85 }),
    ];

    const selected = applyMMR(results, 1.0, 3);
    // Pure relevance means duplicates don't get penalized
    expect(selected[0].knowledgeId).toBe(1);
    expect(selected[1].knowledgeId).toBe(2);
    expect(selected[2].knowledgeId).toBe(3);
  });

  it('with lambda=0.0 (pure diversity), penalizes duplicates heavily', () => {
    const results = [
      mockResult({ knowledgeId: 1, key: 'food', value: 'pizza with extra cheese', score: 0.95 }),
      mockResult({ knowledgeId: 2, key: 'food', value: 'pizza with extra cheese', score: 0.90 }),
      mockResult({ knowledgeId: 3, key: 'hobby', value: 'mountain biking trails', score: 0.50 }),
    ];

    const selected = applyMMR(results, 0.0, 3);
    // First is always selected; then the diverse result should come second
    expect(selected[0].knowledgeId).toBe(1);
    expect(selected[1].knowledgeId).toBe(3);
  });

  it('handles maxResults of 0', () => {
    const results = [
      mockResult({ knowledgeId: 1, key: 'a', value: 'alpha', score: 0.9 }),
    ];
    const selected = applyMMR(results, 0.7, 0);
    expect(selected).toHaveLength(0);
  });

  it('returns correct results when input has exactly 2 items', () => {
    const results = [
      mockResult({ knowledgeId: 1, key: 'name', value: 'Alice', score: 0.9 }),
      mockResult({ knowledgeId: 2, key: 'name', value: 'Bob', score: 0.8 }),
    ];

    const selected = applyMMR(results, 0.7, 2);
    expect(selected).toHaveLength(2);
    expect(selected[0].knowledgeId).toBe(1);
  });
});
