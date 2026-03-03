import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding,
} from '../../../src/memory/embeddings.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const vectorA = new Float32Array([1, 2, 3]);
    const vectorB = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(vectorA, vectorB)).toBeCloseTo(1.0, 5);
  });

  it('returns -1.0 for opposite vectors', () => {
    const vectorA = new Float32Array([1, 0, 0]);
    const vectorB = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(vectorA, vectorB)).toBeCloseTo(-1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const vectorA = new Float32Array([1, 0, 0]);
    const vectorB = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(vectorA, vectorB)).toBeCloseTo(0.0, 5);
  });

  it('returns 0 for vectors with different lengths', () => {
    const vectorA = new Float32Array([1, 2, 3]);
    const vectorB = new Float32Array([1, 2]);
    expect(cosineSimilarity(vectorA, vectorB)).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    const vectorA = new Float32Array([0, 0, 0]);
    const vectorB = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(vectorA, vectorB)).toBe(0);
  });

  it('returns 0 for two zero vectors', () => {
    const vectorA = new Float32Array([0, 0, 0]);
    const vectorB = new Float32Array([0, 0, 0]);
    expect(cosineSimilarity(vectorA, vectorB)).toBe(0);
  });

  it('handles scaled vectors as identical direction', () => {
    const vectorA = new Float32Array([1, 2, 3]);
    const vectorB = new Float32Array([2, 4, 6]);
    expect(cosineSimilarity(vectorA, vectorB)).toBeCloseTo(1.0, 5);
  });

  it('handles high-dimensional vectors', () => {
    const dimensions = 768;
    const vectorA = new Float32Array(dimensions);
    const vectorB = new Float32Array(dimensions);
    for (let i = 0; i < dimensions; i++) {
      vectorA[i] = Math.random() - 0.5;
      vectorB[i] = vectorA[i]; // identical
    }
    expect(cosineSimilarity(vectorA, vectorB)).toBeCloseTo(1.0, 4);
  });

  it('returns a value between -1 and 1 for arbitrary vectors', () => {
    const vectorA = new Float32Array([0.3, -0.7, 0.5, 0.1]);
    const vectorB = new Float32Array([0.1, 0.4, -0.2, 0.9]);
    const similarity = cosineSimilarity(vectorA, vectorB);
    expect(similarity).toBeGreaterThanOrEqual(-1);
    expect(similarity).toBeLessThanOrEqual(1);
  });

  it('handles empty vectors', () => {
    const vectorA = new Float32Array([]);
    const vectorB = new Float32Array([]);
    expect(cosineSimilarity(vectorA, vectorB)).toBe(0);
  });
});

describe('embeddingToBuffer / bufferToEmbedding', () => {
  it('round-trips a simple embedding', () => {
    const original = new Float32Array([1.0, 2.5, -3.7, 0.0]);
    const buffer = embeddingToBuffer(original);
    const restored = bufferToEmbedding(buffer);

    expect(restored).toBeInstanceOf(Float32Array);
    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('round-trips an empty embedding', () => {
    const original = new Float32Array([]);
    const buffer = embeddingToBuffer(original);
    const restored = bufferToEmbedding(buffer);
    expect(restored.length).toBe(0);
  });

  it('round-trips a high-dimensional embedding', () => {
    const dimensions = 768;
    const original = new Float32Array(dimensions);
    for (let i = 0; i < dimensions; i++) {
      original[i] = Math.random() * 2 - 1;
    }

    const buffer = embeddingToBuffer(original);
    const restored = bufferToEmbedding(buffer);

    expect(restored.length).toBe(dimensions);
    for (let i = 0; i < dimensions; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('produces a buffer with the correct byte length', () => {
    const embedding = new Float32Array([1.0, 2.0, 3.0]);
    const buffer = embeddingToBuffer(embedding);
    // Float32 = 4 bytes per element
    expect(buffer.byteLength).toBe(3 * 4);
  });

  it('preserves special float values', () => {
    const original = new Float32Array([0, -0, Number.EPSILON]);
    const buffer = embeddingToBuffer(original);
    const restored = bufferToEmbedding(buffer);
    expect(restored[0]).toBe(0);
    expect(restored[2]).toBeCloseTo(Number.EPSILON, 10);
  });
});
