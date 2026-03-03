/**
 * Hybrid search combining vector similarity and BM25 keyword search.
 * Merges results from both sources with configurable weights,
 * applies temporal decay, and uses MMR to remove near-duplicates.
 * See Sprint 1: Enhanced Memory & Learning.
 */

import type BetterSqlite3 from 'better-sqlite3';
import {
  cosineSimilarity,
  bufferToEmbedding,
  type EmbeddingResult,
} from './embeddings.js';
import { applyTemporalDecay } from './temporal-decay.js';
import { applyMMR } from './mmr.js';
import { orchestratorLogger } from '../utils/logger.js';

/** Weights for merging vector and BM25 scores. */
const DEFAULT_VECTOR_WEIGHT = 0.6;
const DEFAULT_BM25_WEIGHT = 0.4;

/** Maximum number of results to return from hybrid search. */
const DEFAULT_MAX_RESULTS = 20;

/** Minimum score threshold to include a result. */
const DEFAULT_MIN_SCORE = 0.1;

/** Configuration for hybrid search. */
export interface HybridSearchConfig {
  vectorWeight?: number;
  bm25Weight?: number;
  maxResults?: number;
  minScore?: number;
  /** Enable temporal decay scoring. Defaults to true. */
  enableDecay?: boolean;
  /** Enable MMR diversity filtering. Defaults to true. */
  enableMMR?: boolean;
  /** MMR lambda parameter (0 = max diversity, 1 = max relevance). */
  mmrLambda?: number;
}

/** A search result with combined scores. */
export interface HybridSearchResult {
  knowledgeId: number;
  category: string;
  key: string;
  value: string;
  /** Combined score after weighting and decay. */
  score: number;
  /** Individual component scores for debugging. */
  vectorScore: number;
  bm25Score: number;
  decayFactor: number;
}

/** Raw row shape from the knowledge_embeddings join. */
interface EmbeddingDbRow {
  knowledge_id: number;
  embedding: Buffer;
  dimensions: number;
}

/** Raw row shape from FTS5 BM25 search. */
interface FtsMatchRow {
  rowid: number;
  rank: number;
  key: string;
  value: string;
  category: string;
}

/** Knowledge row shape from the DB with access tracking. */
interface KnowledgeAccessRow {
  id: number;
  category: string;
  key: string;
  value: string;
  confidence: number;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Perform a hybrid search over the knowledge base.
 * Combines vector similarity search with BM25 keyword search,
 * applies temporal decay, and filters with MMR for diversity.
 *
 * @param db - Database connection.
 * @param queryEmbedding - The embedding of the user's query (null to skip vector search).
 * @param queryText - The user's query text for BM25 search.
 * @param config - Optional search configuration.
 * @returns Ranked array of hybrid search results.
 */
export function hybridSearch(
  db: BetterSqlite3.Database,
  queryEmbedding: EmbeddingResult | null,
  queryText: string,
  config?: HybridSearchConfig,
): HybridSearchResult[] {
  const vectorWeight = config?.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
  const bm25Weight = config?.bm25Weight ?? DEFAULT_BM25_WEIGHT;
  const maxResults = config?.maxResults ?? DEFAULT_MAX_RESULTS;
  const minScore = config?.minScore ?? DEFAULT_MIN_SCORE;
  const enableDecay = config?.enableDecay ?? true;
  const enableMMR = config?.enableMMR ?? true;
  const mmrLambda = config?.mmrLambda ?? 0.7;

  // Step 1: Vector similarity search
  const vectorScores = new Map<number, number>();
  if (queryEmbedding) {
    const embeddingRows = db.prepare(
      `SELECT ke.knowledge_id, ke.embedding, ke.dimensions
       FROM knowledge_embeddings ke
       JOIN knowledge k ON k.id = ke.knowledge_id`,
    ).all() as EmbeddingDbRow[];

    for (const row of embeddingRows) {
      const storedEmbedding = bufferToEmbedding(row.embedding);
      if (storedEmbedding.length === queryEmbedding.dimensions) {
        const similarity = cosineSimilarity(queryEmbedding.embedding, storedEmbedding);
        if (similarity > 0) {
          vectorScores.set(row.knowledge_id, similarity);
        }
      }
    }
  }

  // Step 2: BM25 keyword search via FTS5
  const bm25Scores = new Map<number, number>();
  if (queryText.trim().length > 0) {
    try {
      // Escape FTS5 special characters and build query
      const ftsQuery = buildFtsQuery(queryText);
      if (ftsQuery.length > 0) {
        const ftsRows = db.prepare(
          `SELECT rowid, rank, key, value, category
           FROM knowledge_fts
           WHERE knowledge_fts MATCH ?
           ORDER BY rank
           LIMIT 50`,
        ).all(ftsQuery) as FtsMatchRow[];

        // Normalize BM25 scores to 0-1 range
        // FTS5 rank is negative (more negative = better match)
        if (ftsRows.length > 0) {
          const minRank = ftsRows[ftsRows.length - 1].rank;
          const maxRank = ftsRows[0].rank;
          const range = minRank - maxRank;

          for (const row of ftsRows) {
            const normalized = range !== 0
              ? (row.rank - maxRank) / range
              : 1;
            bm25Scores.set(row.rowid, 1 - normalized); // Invert so higher = better
          }
        }
      }
    } catch (error: unknown) {
      // FTS5 table may not exist yet or query may be invalid
      const msg = error instanceof Error ? error.message : String(error);
      orchestratorLogger.debug({ error: msg }, 'FTS5 search failed, using vector-only');
    }
  }

  // Step 3: Merge scores from both sources
  const allIds = new Set([...vectorScores.keys(), ...bm25Scores.keys()]);
  const mergedResults: HybridSearchResult[] = [];

  // Load knowledge rows for all candidate IDs
  const knowledgeMap = new Map<number, KnowledgeAccessRow>();
  if (allIds.size > 0) {
    const placeholders = [...allIds].map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, category, key, value, confidence, access_count, last_accessed_at, created_at, updated_at
       FROM knowledge WHERE id IN (${placeholders})`,
    ).all([...allIds]) as KnowledgeAccessRow[];

    for (const row of rows) {
      knowledgeMap.set(row.id, row);
    }
  }

  for (const knowledgeId of allIds) {
    const row = knowledgeMap.get(knowledgeId);
    if (!row) continue;

    const vScore = vectorScores.get(knowledgeId) ?? 0;
    const bScore = bm25Scores.get(knowledgeId) ?? 0;

    // Weighted combination
    let combinedScore = (vScore * vectorWeight) + (bScore * bm25Weight);

    // Confidence boost: entries with higher confidence get a small bonus
    combinedScore *= (0.8 + 0.2 * row.confidence);

    // Step 4: Apply temporal decay
    let decayFactor = 1;
    if (enableDecay) {
      const lastAccessed = row.last_accessed_at
        ? new Date(row.last_accessed_at)
        : new Date(row.updated_at);
      decayFactor = applyTemporalDecay(lastAccessed);
      combinedScore *= decayFactor;
    }

    // Knowledge promotion: entries recalled 5+ times get a boost
    if (row.access_count >= 5) {
      combinedScore *= 1.1;
    }

    if (combinedScore >= minScore) {
      mergedResults.push({
        knowledgeId,
        category: row.category,
        key: row.key,
        value: row.value,
        score: combinedScore,
        vectorScore: vScore,
        bm25Score: bScore,
        decayFactor,
      });
    }
  }

  // Step 5: Sort by combined score
  mergedResults.sort((a, b) => b.score - a.score);

  // Step 6: Apply MMR diversity filtering
  let finalResults = mergedResults;
  if (enableMMR && queryEmbedding) {
    finalResults = applyMMR(mergedResults, mmrLambda, maxResults);
  } else {
    finalResults = mergedResults.slice(0, maxResults);
  }

  orchestratorLogger.debug(
    {
      vectorCandidates: vectorScores.size,
      bm25Candidates: bm25Scores.size,
      mergedCandidates: mergedResults.length,
      finalCount: finalResults.length,
    },
    'Hybrid search completed',
  );

  return finalResults;
}

/**
 * Record an access to a knowledge entry (for temporal decay boosting).
 * Increments access_count and updates last_accessed_at.
 *
 * @param db - Database connection.
 * @param knowledgeId - The knowledge entry ID.
 */
export function recordKnowledgeAccess(
  db: BetterSqlite3.Database,
  knowledgeId: number,
): void {
  db.prepare(
    `UPDATE knowledge
     SET access_count = access_count + 1,
         last_accessed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(knowledgeId);
}

/**
 * Build an FTS5 query from user text.
 * Splits into words, removes short words, and joins with OR for broad matching.
 *
 * @param text - Raw user query text.
 * @returns FTS5-compatible query string.
 */
function buildFtsQuery(text: string): string {
  const words = text
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 10);

  if (words.length === 0) return '';

  // Use OR matching so partial hits are included
  return words.map((w) => `"${w}"`).join(' OR ');
}
