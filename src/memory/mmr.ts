/**
 * Maximal Marginal Relevance (MMR) for diversity filtering.
 * Removes near-duplicate results to maximize information density
 * in the context window. Uses text-based similarity when embeddings
 * are unavailable for individual results.
 * See Sprint 1: Enhanced Memory & Learning.
 */

import type { HybridSearchResult } from './hybrid-search.js';

/**
 * Apply MMR re-ranking to search results.
 * Iteratively selects results that balance relevance with diversity.
 *
 * lambda = 1.0: pure relevance ranking (no diversity)
 * lambda = 0.0: pure diversity (ignore relevance)
 * Recommended: 0.7 (favor relevance with some diversity)
 *
 * @param results - Pre-sorted search results (highest score first).
 * @param lambda - Balance between relevance and diversity (0-1).
 * @param maxResults - Maximum number of results to return.
 * @returns Re-ranked results with near-duplicates removed.
 */
export function applyMMR(
  results: HybridSearchResult[],
  lambda: number,
  maxResults: number,
): HybridSearchResult[] {
  if (results.length <= 1) {
    return results.slice(0, maxResults);
  }

  const selected: HybridSearchResult[] = [];
  const remaining = new Set(results.map((_, idx) => idx));

  // Always pick the top-scored result first
  selected.push(results[0]);
  remaining.delete(0);

  while (selected.length < maxResults && remaining.size > 0) {
    let bestIdx = -1;
    let bestMMRScore = -Infinity;

    for (const idx of remaining) {
      const candidate = results[idx];

      // Relevance component: the candidate's original score
      const relevance = candidate.score;

      // Diversity component: max similarity to any already-selected result
      let maxSimilarity = 0;
      for (const sel of selected) {
        const similarity = textSimilarity(
          `${candidate.key} ${candidate.value}`,
          `${sel.key} ${sel.value}`,
        );
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
        }
      }

      // MMR formula: lambda * relevance - (1 - lambda) * maxSimilarity
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;

      if (mmrScore > bestMMRScore) {
        bestMMRScore = mmrScore;
        bestIdx = idx;
      }
    }

    if (bestIdx === -1) break;
    selected.push(results[bestIdx]);
    remaining.delete(bestIdx);
  }

  return selected;
}

/**
 * Simple text similarity based on word overlap (Jaccard index).
 * Fast approximation for duplicate detection without requiring embeddings.
 *
 * @param textA - First text.
 * @param textB - Second text.
 * @returns Similarity score between 0 and 1.
 */
function textSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      intersection++;
    }
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}
