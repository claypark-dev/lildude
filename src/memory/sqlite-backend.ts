/**
 * SQLite memory backend — default implementation.
 * Wraps the existing knowledge persistence and hybrid search modules
 * behind the MemoryBackend interface.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type {
  MemoryBackend,
  KnowledgeItem,
  MemorySearchResult,
  MemorySearchOptions,
} from './backend.js';
import type { EmbeddingResult } from './embeddings.js';
import { createEmbeddingGenerator, type EmbeddingConfig } from './embeddings.js';
import { hybridSearch, type HybridSearchConfig } from './hybrid-search.js';
import { createModuleLogger } from '../utils/logger.js';

const backendLogger = createModuleLogger('sqlite-memory');

/** Configuration for the SQLite memory backend. */
export interface SqliteBackendConfig {
  embedding: EmbeddingConfig;
  search?: HybridSearchConfig;
}

/**
 * Create a SQLite-backed MemoryBackend.
 *
 * @param db - The better-sqlite3 database instance.
 * @param config - Embedding and search configuration.
 * @returns A MemoryBackend implementation using SQLite.
 */
export function createSqliteMemoryBackend(
  db: BetterSqlite3.Database,
  config: SqliteBackendConfig,
): MemoryBackend {
  const embeddingGenerator = createEmbeddingGenerator(config.embedding);
  const searchConfig = config.search ?? {};

  return {
    name: 'sqlite',

    async store(
      category: string,
      key: string,
      value: string,
      confidence = 0.5,
    ): Promise<number> {
      try {
        const result = db.prepare(`
          INSERT INTO knowledge (category, key, value, confidence, access_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, datetime('now'), datetime('now'))
        `).run(category, key, value, confidence);

        const knowledgeId = Number(result.lastInsertRowid);

        // Generate and store embedding
        try {
          const embeddingResult = await embeddingGenerator.generateEmbedding(value);
          const buffer = Buffer.from(
            embeddingResult.embedding.buffer,
            embeddingResult.embedding.byteOffset,
            embeddingResult.embedding.byteLength,
          );

          db.prepare(`
            INSERT INTO knowledge_embeddings (knowledge_id, embedding, model, dimensions, created_at)
            VALUES (?, ?, ?, ?, datetime('now'))
          `).run(knowledgeId, buffer, embeddingResult.model, embeddingResult.dimensions);
        } catch (embedError: unknown) {
          const msg = embedError instanceof Error ? embedError.message : String(embedError);
          backendLogger.warn({ knowledgeId, error: msg }, 'Failed to generate embedding for knowledge item');
        }

        return knowledgeId;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        backendLogger.error({ error: message }, 'Failed to store knowledge item');
        throw error;
      }
    },

    async search(
      query: string,
      embedding?: EmbeddingResult,
      options?: MemorySearchOptions,
    ): Promise<MemorySearchResult[]> {
      try {
        const queryEmbedding = embedding ?? await embeddingGenerator.generateEmbedding(query);

        const results = hybridSearch(db, queryEmbedding, query, {
          ...searchConfig,
          maxResults: options?.maxResults,
          minScore: options?.minScore,
        });

        return results.map((result) => ({
          item: {
            id: result.knowledgeId,
            category: result.category,
            key: result.key,
            value: result.value,
            confidence: 0.5,
            accessCount: 0,
            lastAccessedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          score: result.score,
          source: 'hybrid' as const,
        }));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        backendLogger.warn({ error: message }, 'Hybrid search failed, returning empty results');
        return [];
      }
    },

    async embed(text: string): Promise<EmbeddingResult> {
      return embeddingGenerator.generateEmbedding(text);
    },

    async delete(id: number): Promise<boolean> {
      try {
        db.prepare('DELETE FROM knowledge_embeddings WHERE knowledge_id = ?').run(id);
        const result = db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
        return result.changes > 0;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        backendLogger.error({ id, error: message }, 'Failed to delete knowledge item');
        return false;
      }
    },

    async get(id: number): Promise<KnowledgeItem | null> {
      try {
        const row = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id) as {
          id: number;
          category: string;
          key: string;
          value: string;
          confidence: number;
          access_count: number;
          last_accessed_at: string | null;
          created_at: string;
          updated_at: string;
        } | undefined;

        if (!row) return null;

        return {
          id: row.id,
          category: row.category,
          key: row.key,
          value: row.value,
          confidence: row.confidence,
          accessCount: row.access_count,
          lastAccessedAt: row.last_accessed_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        backendLogger.error({ id, error: message }, 'Failed to get knowledge item');
        return null;
      }
    },

    async close(): Promise<void> {
      // SQLite backend shares the main DB connection — nothing to close here.
      backendLogger.debug('SQLite memory backend closed');
    },
  };
}
