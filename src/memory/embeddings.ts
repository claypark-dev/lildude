/**
 * Embedding generation for semantic search.
 * Supports Ollama (nomic-embed-text, local/free) with OpenAI fallback.
 * Embeddings are stored as Float32Array blobs alongside knowledge entries.
 * See Sprint 1: Enhanced Memory & Learning.
 */

import { orchestratorLogger } from '../utils/logger.js';

/** Configuration for the embedding provider. */
export interface EmbeddingConfig {
  /** Primary provider: 'ollama' or 'openai'. Defaults to 'ollama'. */
  provider: 'ollama' | 'openai';
  /** Ollama base URL. Defaults to http://localhost:11434 */
  ollamaBaseUrl?: string;
  /** Ollama embedding model. Defaults to nomic-embed-text. */
  ollamaModel?: string;
  /** OpenAI API key for fallback. */
  openaiApiKey?: string;
  /** OpenAI embedding model. Defaults to text-embedding-3-small. */
  openaiModel?: string;
}

/** Result of an embedding generation call. */
export interface EmbeddingResult {
  /** The embedding vector as Float32Array. */
  embedding: Float32Array;
  /** The model used for generation. */
  model: string;
  /** Number of dimensions in the embedding. */
  dimensions: number;
}

/** Default Ollama embedding model (768 dimensions, zero cost). */
const DEFAULT_OLLAMA_MODEL = 'nomic-embed-text';

/** Default OpenAI embedding model (1536 dimensions). */
const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';

/** Default Ollama base URL. */
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Create an embedding generator with the given configuration.
 * Tries the primary provider first, falls back to the other if available.
 *
 * @param config - Embedding provider configuration.
 * @returns An object with generateEmbedding and generateBatch methods.
 */
export function createEmbeddingGenerator(config: EmbeddingConfig) {
  const ollamaBaseUrl = config.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = config.ollamaModel ?? DEFAULT_OLLAMA_MODEL;
  const openaiModel = config.openaiModel ?? DEFAULT_OPENAI_MODEL;

  return {
    /**
     * Generate an embedding for a single text input.
     * Falls back to the secondary provider on failure.
     *
     * @param text - The text to embed.
     * @returns The embedding result with vector, model, and dimensions.
     */
    async generateEmbedding(text: string): Promise<EmbeddingResult> {
      if (config.provider === 'ollama') {
        try {
          return await generateOllamaEmbedding(text, ollamaBaseUrl, ollamaModel);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          orchestratorLogger.warn({ error: msg }, 'Ollama embedding failed, trying OpenAI fallback');
          if (config.openaiApiKey) {
            return await generateOpenAIEmbedding(text, config.openaiApiKey, openaiModel);
          }
          throw error;
        }
      }

      // OpenAI primary
      if (!config.openaiApiKey) {
        throw new Error('OpenAI API key required for embedding generation');
      }
      try {
        return await generateOpenAIEmbedding(text, config.openaiApiKey, openaiModel);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        orchestratorLogger.warn({ error: msg }, 'OpenAI embedding failed, trying Ollama fallback');
        return await generateOllamaEmbedding(text, ollamaBaseUrl, ollamaModel);
      }
    },

    /**
     * Generate embeddings for multiple texts in batch.
     * Processes sequentially to avoid overwhelming the embedding service.
     *
     * @param texts - Array of texts to embed.
     * @returns Array of embedding results matching the input order.
     */
    async generateBatch(texts: string[]): Promise<EmbeddingResult[]> {
      const results: EmbeddingResult[] = [];
      for (const text of texts) {
        results.push(await this.generateEmbedding(text));
      }
      return results;
    },

    /** Get the configured model name for storage reference. */
    getModelName(): string {
      return config.provider === 'ollama' ? ollamaModel : openaiModel;
    },
  };
}

/**
 * Generate an embedding via Ollama's /api/embed endpoint.
 *
 * @param text - The text to embed.
 * @param baseUrl - Ollama server base URL.
 * @param model - Ollama embedding model name.
 * @returns Embedding result.
 */
async function generateOllamaEmbedding(
  text: string,
  baseUrl: string,
  model: string,
): Promise<EmbeddingResult> {
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    throw new Error(`Ollama embedding failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json() as { embeddings: number[][] };
  if (!data.embeddings?.[0]) {
    throw new Error('Ollama returned empty embeddings array');
  }

  const embedding = new Float32Array(data.embeddings[0]);

  orchestratorLogger.debug(
    { model, dimensions: embedding.length },
    'Ollama embedding generated',
  );

  return { embedding, model, dimensions: embedding.length };
}

/**
 * Generate an embedding via OpenAI's embeddings endpoint.
 *
 * @param text - The text to embed.
 * @param apiKey - OpenAI API key.
 * @param model - OpenAI embedding model name.
 * @returns Embedding result.
 */
async function generateOpenAIEmbedding(
  text: string,
  apiKey: string,
  model: string,
): Promise<EmbeddingResult> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    throw new Error(`OpenAI embedding failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[] }>;
  };
  if (!data.data?.[0]?.embedding) {
    throw new Error('OpenAI returned empty embedding data');
  }

  const embedding = new Float32Array(data.data[0].embedding);

  orchestratorLogger.debug(
    { model, dimensions: embedding.length },
    'OpenAI embedding generated',
  );

  return { embedding, model, dimensions: embedding.length };
}

/**
 * Compute cosine similarity between two embedding vectors.
 * Pure JS implementation — fast enough for thousands of entries.
 *
 * @param vectorA - First embedding vector.
 * @param vectorB - Second embedding vector.
 * @returns Similarity score between -1 and 1 (1 = identical).
 */
export function cosineSimilarity(vectorA: Float32Array, vectorB: Float32Array): number {
  if (vectorA.length !== vectorB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    normA += vectorA[i] * vectorA[i];
    normB += vectorB[i] * vectorB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Serialize a Float32Array to a Buffer for SQLite BLOB storage.
 *
 * @param embedding - The embedding vector.
 * @returns A Buffer containing the raw float32 bytes.
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/**
 * Deserialize a Buffer from SQLite BLOB storage back to Float32Array.
 *
 * @param buffer - The raw BLOB buffer from SQLite.
 * @returns The reconstructed Float32Array embedding.
 */
export function bufferToEmbedding(buffer: Buffer): Float32Array {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return new Float32Array(arrayBuffer);
}
