/**
 * Memory backend plugin interface.
 * Defines the abstract interface for memory storage, retrieval,
 * and embedding. SQLite is the default implementation, but this
 * interface allows swapping in Redis, Postgres, or any other backend.
 */

import type { EmbeddingResult } from './embeddings.js';

/** A knowledge item stored in the memory backend. */
export interface KnowledgeItem {
  id: number;
  category: string;
  key: string;
  value: string;
  confidence: number;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Search result from the memory backend. */
export interface MemorySearchResult {
  item: KnowledgeItem;
  score: number;
  source: 'vector' | 'keyword' | 'hybrid';
}

/** Configuration for a search query. */
export interface MemorySearchOptions {
  maxResults?: number;
  minScore?: number;
  category?: string;
  enableVector?: boolean;
  enableKeyword?: boolean;
}

/**
 * Abstract memory backend interface.
 * All memory operations go through this interface, enabling
 * pluggable storage backends.
 */
export interface MemoryBackend {
  /** Backend identifier (e.g., 'sqlite', 'redis', 'postgres'). */
  readonly name: string;

  /**
   * Store a knowledge item.
   *
   * @param category - The knowledge category.
   * @param key - The knowledge key/label.
   * @param value - The knowledge value/content.
   * @param confidence - Confidence score (0-1).
   * @returns The stored item ID.
   */
  store(category: string, key: string, value: string, confidence?: number): Promise<number>;

  /**
   * Search for knowledge items using hybrid search.
   *
   * @param query - The search query text.
   * @param embedding - Optional pre-computed embedding for vector search.
   * @param options - Search configuration.
   * @returns Matching results with scores.
   */
  search(
    query: string,
    embedding?: EmbeddingResult,
    options?: MemorySearchOptions,
  ): Promise<MemorySearchResult[]>;

  /**
   * Generate an embedding for the given text.
   *
   * @param text - The text to embed.
   * @returns The embedding result.
   */
  embed(text: string): Promise<EmbeddingResult>;

  /**
   * Delete a knowledge item by ID.
   *
   * @param id - The knowledge item ID.
   * @returns Whether the item was deleted.
   */
  delete(id: number): Promise<boolean>;

  /**
   * Get a knowledge item by ID.
   *
   * @param id - The knowledge item ID.
   * @returns The item or null.
   */
  get(id: number): Promise<KnowledgeItem | null>;

  /**
   * Close the backend and release resources.
   */
  close(): Promise<void>;
}
