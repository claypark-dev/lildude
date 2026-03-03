import { describe, it, expect } from 'vitest';
import type { MemoryBackend, MemorySearchResult, KnowledgeItem } from '../../../src/memory/backend.js';

/**
 * Test the MemoryBackend interface contract with a mock implementation.
 * The real SQLite backend requires embedding services; this validates
 * that the interface shape is correct and can be implemented.
 */
function createMockBackend(): MemoryBackend {
  const store = new Map<number, KnowledgeItem>();
  let nextId = 1;

  return {
    name: 'mock',

    async store(category: string, key: string, value: string, confidence = 0.5): Promise<number> {
      const id = nextId++;
      store.set(id, {
        id,
        category,
        key,
        value,
        confidence,
        accessCount: 0,
        lastAccessedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return id;
    },

    async search(query: string): Promise<MemorySearchResult[]> {
      const results: MemorySearchResult[] = [];
      for (const item of store.values()) {
        if (item.value.toLowerCase().includes(query.toLowerCase())) {
          results.push({ item, score: 0.8, source: 'hybrid' });
        }
      }
      return results;
    },

    async embed(text: string) {
      return {
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        model: 'mock-model',
        dimensions: 3,
      };
    },

    async delete(id: number): Promise<boolean> {
      return store.delete(id);
    },

    async get(id: number): Promise<KnowledgeItem | null> {
      return store.get(id) ?? null;
    },

    async close(): Promise<void> {
      store.clear();
    },
  };
}

describe('MemoryBackend interface', () => {
  it('store returns an incrementing ID', async () => {
    const backend = createMockBackend();
    const id1 = await backend.store('test', 'key1', 'value1');
    const id2 = await backend.store('test', 'key2', 'value2');
    expect(id2).toBeGreaterThan(id1);
  });

  it('get retrieves stored item', async () => {
    const backend = createMockBackend();
    const id = await backend.store('notes', 'meeting', 'Discuss Q4 roadmap');

    const item = await backend.get(id);
    expect(item).not.toBeNull();
    expect(item!.category).toBe('notes');
    expect(item!.key).toBe('meeting');
    expect(item!.value).toBe('Discuss Q4 roadmap');
  });

  it('get returns null for missing ID', async () => {
    const backend = createMockBackend();
    const item = await backend.get(999);
    expect(item).toBeNull();
  });

  it('search returns matching items', async () => {
    const backend = createMockBackend();
    await backend.store('notes', 'k1', 'TypeScript is great');
    await backend.store('notes', 'k2', 'Python is flexible');

    const results = await backend.search('typescript');
    expect(results).toHaveLength(1);
    expect(results[0].item.value).toContain('TypeScript');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('delete removes item', async () => {
    const backend = createMockBackend();
    const id = await backend.store('test', 'k', 'v');

    const deleted = await backend.delete(id);
    expect(deleted).toBe(true);

    const item = await backend.get(id);
    expect(item).toBeNull();
  });

  it('delete returns false for missing item', async () => {
    const backend = createMockBackend();
    const deleted = await backend.delete(999);
    expect(deleted).toBe(false);
  });

  it('embed returns an embedding result', async () => {
    const backend = createMockBackend();
    const result = await backend.embed('hello world');
    expect(result.embedding).toBeInstanceOf(Float32Array);
    expect(result.model).toBeDefined();
    expect(result.dimensions).toBeGreaterThan(0);
  });

  it('close can be called without error', async () => {
    const backend = createMockBackend();
    await expect(backend.close()).resolves.toBeUndefined();
  });

  it('backend has a name', () => {
    const backend = createMockBackend();
    expect(backend.name).toBe('mock');
  });
});
