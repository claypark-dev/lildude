import { describe, it, expect } from 'vitest';
import {
  CANONICAL_EXAMPLES,
  classifyRequest,
  getEffectiveSafetyTier,
} from '../../../src/waves/request-classifier.js';
import type { WaveSafetyTier } from '../../../src/types/index.js';
import Database from 'better-sqlite3';

/**
 * Create an in-memory DB with the request_classifications table
 * and seed it with some test data (no real embeddings needed for
 * classifyRequest tests — we store mock embeddings).
 */
function createClassifierTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_classifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      example_text TEXT NOT NULL,
      safety_tier TEXT NOT NULL,
      category TEXT NOT NULL,
      embedding BLOB,
      embedding_model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return db;
}

/** Create a mock embedding (simple float array). */
function mockEmbedding(values: number[]): Float32Array {
  return new Float32Array(values);
}

/** Convert Float32Array to Buffer for DB storage. */
function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/** Insert a classification row with a mock embedding. */
function insertClassification(
  db: InstanceType<typeof Database>,
  text: string,
  tier: string,
  category: string,
  embedding: Float32Array,
) {
  db.prepare(`
    INSERT INTO request_classifications (example_text, safety_tier, category, embedding, embedding_model)
    VALUES (?, ?, ?, ?, ?)
  `).run(text, tier, category, embeddingToBuffer(embedding), 'test-model');
}

describe('request-classifier', () => {
  describe('CANONICAL_EXAMPLES', () => {
    it('has examples for all five safety tiers', () => {
      const tiers = new Set(CANONICAL_EXAMPLES.map((e) => e.tier));
      expect(tiers).toContain('observe');
      expect(tiers).toContain('create');
      expect(tiers).toContain('modify');
      expect(tiers).toContain('destroy');
      expect(tiers).toContain('execute');
    });

    it('has at least 20 examples', () => {
      expect(CANONICAL_EXAMPLES.length).toBeGreaterThanOrEqual(20);
    });

    it('every example has text, tier, and category', () => {
      for (const example of CANONICAL_EXAMPLES) {
        expect(example.text).toBeTruthy();
        expect(example.tier).toBeTruthy();
        expect(example.category).toBeTruthy();
      }
    });
  });

  describe('classifyRequest', () => {
    it('returns observe with zero confidence when no classifications exist', () => {
      const db = createClassifierTestDb();

      const result = classifyRequest(db, {
        embedding: mockEmbedding([1, 0, 0]),
        model: 'test-model',
      });

      expect(result.inferredTier).toBe('observe');
      expect(result.confidence).toBe(0);
      expect(result.matchedExample).toBeNull();
      expect(result.category).toBeNull();

      db.close();
    });

    it('classifies request matching observe examples', () => {
      const db = createClassifierTestDb();

      // Insert observe examples with embeddings similar to [1, 0, 0]
      insertClassification(db, 'check email', 'observe', 'email', mockEmbedding([0.9, 0.1, 0]));
      insertClassification(db, 'read tasks', 'observe', 'tasks', mockEmbedding([0.8, 0.2, 0]));
      // Insert a distant destroy example
      insertClassification(db, 'delete files', 'destroy', 'file', mockEmbedding([0, 0, 1]));

      const result = classifyRequest(db, {
        embedding: mockEmbedding([1, 0, 0]),
        model: 'test-model',
      });

      expect(result.inferredTier).toBe('observe');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.matchedExample).toBeDefined();

      db.close();
    });

    it('classifies request matching destroy examples', () => {
      const db = createClassifierTestDb();

      insertClassification(db, 'check email', 'observe', 'email', mockEmbedding([1, 0, 0]));
      insertClassification(db, 'delete files', 'destroy', 'file', mockEmbedding([0, 0, 0.9]));
      insertClassification(db, 'remove records', 'destroy', 'data', mockEmbedding([0, 0.1, 0.95]));

      const result = classifyRequest(db, {
        embedding: mockEmbedding([0, 0, 1]),
        model: 'test-model',
      });

      expect(result.inferredTier).toBe('destroy');
      expect(result.confidence).toBeGreaterThan(0);

      db.close();
    });

    it('uses weighted voting from top K matches', () => {
      const db = createClassifierTestDb();

      // Two create examples close to query, one observe close
      insertClassification(db, 'send email', 'create', 'email', mockEmbedding([0.9, 0.1, 0]));
      insertClassification(db, 'add event', 'create', 'calendar', mockEmbedding([0.85, 0.15, 0]));
      insertClassification(db, 'check email', 'observe', 'email', mockEmbedding([0.7, 0.3, 0]));

      const result = classifyRequest(db, {
        embedding: mockEmbedding([1, 0, 0]),
        model: 'test-model',
      }, 3);

      // Create should win because 2 create examples are closer
      expect(result.inferredTier).toBe('create');

      db.close();
    });

    it('returns observe as fallback on error', () => {
      // Create a DB without the table to trigger an error
      const db = new Database(':memory:');

      const result = classifyRequest(db, {
        embedding: mockEmbedding([1, 0, 0]),
        model: 'test-model',
      });

      expect(result.inferredTier).toBe('observe');
      expect(result.confidence).toBe(0);

      db.close();
    });
  });

  describe('getEffectiveSafetyTier', () => {
    it('returns manifest tier when both are the same', () => {
      expect(getEffectiveSafetyTier('observe', 'observe')).toBe('observe');
      expect(getEffectiveSafetyTier('create', 'create')).toBe('create');
      expect(getEffectiveSafetyTier('execute', 'execute')).toBe('execute');
    });

    it('returns inferred tier when more restrictive', () => {
      expect(getEffectiveSafetyTier('observe', 'modify')).toBe('modify');
      expect(getEffectiveSafetyTier('observe', 'destroy')).toBe('destroy');
      expect(getEffectiveSafetyTier('create', 'execute')).toBe('execute');
    });

    it('returns manifest tier when more restrictive', () => {
      expect(getEffectiveSafetyTier('destroy', 'observe')).toBe('destroy');
      expect(getEffectiveSafetyTier('execute', 'create')).toBe('execute');
      expect(getEffectiveSafetyTier('modify', 'observe')).toBe('modify');
    });

    it('handles all tier combinations correctly', () => {
      const tiers: WaveSafetyTier[] = ['observe', 'create', 'modify', 'destroy', 'execute'];
      const priority: Record<WaveSafetyTier, number> = {
        observe: 0,
        create: 1,
        modify: 2,
        destroy: 3,
        execute: 4,
      };

      for (const manifest of tiers) {
        for (const inferred of tiers) {
          const result = getEffectiveSafetyTier(manifest, inferred);
          const expectedPriority = Math.max(priority[manifest], priority[inferred]);
          const expectedTier = tiers.find((t) => priority[t] === expectedPriority)!;
          expect(result).toBe(expectedTier);
        }
      }
    });
  });
});
