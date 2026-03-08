import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import {
  findOrCreateEntity,
  linkEntityToKnowledge,
  processEntities,
  getKnowledgeByEntity,
  getEntities,
  searchEntities,
} from '../../../src/memory/entity-linker.js';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

/** Insert a knowledge entry directly for testing. */
function insertKnowledge(
  db: ReturnType<typeof createDatabase>['db'],
  category: string,
  key: string,
  value: string,
  confidence = 0.8,
): number {
  const result = db.prepare(
    `INSERT INTO knowledge (category, key, value, confidence)
     VALUES (?, ?, ?, ?)`,
  ).run(category, key, value, confidence);
  return result.lastInsertRowid as number;
}

describe('entity-linker', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createTestDb();
  });

  afterEach(() => {
    dbManager.close();
  });

  describe('findOrCreateEntity', () => {
    it('creates a new entity and returns its ID', () => {
      const id = findOrCreateEntity(dbManager.db, 'Sarah', 'person');
      expect(id).toBeGreaterThan(0);
    });

    it('returns existing entity ID for duplicate name+type', () => {
      const id1 = findOrCreateEntity(dbManager.db, 'Sarah', 'person');
      const id2 = findOrCreateEntity(dbManager.db, 'sarah', 'person');
      expect(id1).toBe(id2);
    });

    it('creates separate entities for different types', () => {
      const id1 = findOrCreateEntity(dbManager.db, 'Portland', 'location');
      const id2 = findOrCreateEntity(dbManager.db, 'Portland', 'organization');
      expect(id1).not.toBe(id2);
    });

    it('normalizes names for deduplication', () => {
      const id1 = findOrCreateEntity(dbManager.db, '  Sarah  ', 'person');
      const id2 = findOrCreateEntity(dbManager.db, 'SARAH', 'person');
      expect(id1).toBe(id2);
    });
  });

  describe('linkEntityToKnowledge', () => {
    it('creates a link between entity and knowledge', () => {
      const entityId = findOrCreateEntity(dbManager.db, 'Sarah', 'person');
      const knowledgeId = insertKnowledge(dbManager.db, 'user_fact', 'relationship:sarah', 'manager');

      linkEntityToKnowledge(dbManager.db, entityId, knowledgeId);

      const link = dbManager.db.prepare(
        'SELECT * FROM entity_knowledge_links WHERE entity_id = ? AND knowledge_id = ?',
      ).get(entityId, knowledgeId);
      expect(link).toBeDefined();
    });

    it('does not create duplicate links', () => {
      const entityId = findOrCreateEntity(dbManager.db, 'Sarah', 'person');
      const knowledgeId = insertKnowledge(dbManager.db, 'user_fact', 'relationship:sarah', 'manager');

      linkEntityToKnowledge(dbManager.db, entityId, knowledgeId);
      linkEntityToKnowledge(dbManager.db, entityId, knowledgeId);

      const count = dbManager.db.prepare(
        'SELECT COUNT(*) as cnt FROM entity_knowledge_links WHERE entity_id = ? AND knowledge_id = ?',
      ).get(entityId, knowledgeId) as { cnt: number };
      expect(count.cnt).toBe(1);
    });

    it('supports custom relationship types', () => {
      const entityId = findOrCreateEntity(dbManager.db, 'Sarah', 'person');
      const knowledgeId = insertKnowledge(dbManager.db, 'user_fact', 'sarah_email', 'sarah@work.com');

      linkEntityToKnowledge(dbManager.db, entityId, knowledgeId, 'has_email');

      const link = dbManager.db.prepare(
        'SELECT relationship FROM entity_knowledge_links WHERE entity_id = ? AND knowledge_id = ?',
      ).get(entityId, knowledgeId) as { relationship: string };
      expect(link.relationship).toBe('has_email');
    });
  });

  describe('processEntities', () => {
    it('creates entities and links them to a knowledge entry', () => {
      const knowledgeId = insertKnowledge(dbManager.db, 'user_fact', 'relationship:sarah', 'manager');

      processEntities(dbManager.db, knowledgeId, [
        { name: 'Sarah', type: 'person' },
      ]);

      const entities = getEntities(dbManager.db);
      expect(entities).toHaveLength(1);
      expect(entities[0].canonicalName).toBe('sarah');

      const linkedKnowledge = getKnowledgeByEntity(dbManager.db, 'Sarah');
      expect(linkedKnowledge).toHaveLength(1);
      expect(linkedKnowledge[0].knowledgeId).toBe(knowledgeId);
    });

    it('handles multiple entities in a single call', () => {
      const knowledgeId = insertKnowledge(dbManager.db, 'user_fact', 'employer', 'Google');

      processEntities(dbManager.db, knowledgeId, [
        { name: 'Google', type: 'organization' },
        { name: 'San Francisco', type: 'location' },
      ]);

      const entities = getEntities(dbManager.db);
      expect(entities).toHaveLength(2);
    });
  });

  describe('getKnowledgeByEntity', () => {
    it('returns all knowledge linked to an entity', () => {
      const entityId = findOrCreateEntity(dbManager.db, 'Sarah', 'person');

      const k1 = insertKnowledge(dbManager.db, 'user_fact', 'relationship:sarah', 'manager');
      const k2 = insertKnowledge(dbManager.db, 'user_fact', 'sarah_email', 'sarah@work.com');

      linkEntityToKnowledge(dbManager.db, entityId, k1);
      linkEntityToKnowledge(dbManager.db, entityId, k2);

      const results = getKnowledgeByEntity(dbManager.db, 'sarah');
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.key)).toContain('relationship:sarah');
      expect(results.map((r) => r.key)).toContain('sarah_email');
    });

    it('excludes superseded knowledge entries', () => {
      const entityId = findOrCreateEntity(dbManager.db, 'Sarah', 'person');

      const k1 = insertKnowledge(dbManager.db, 'user_fact', 'sarah_email', 'old@work.com');
      const k2 = insertKnowledge(dbManager.db, 'user_fact', 'sarah_email', 'new@work.com');

      linkEntityToKnowledge(dbManager.db, entityId, k1);
      linkEntityToKnowledge(dbManager.db, entityId, k2);

      // Supersede k1
      dbManager.db.prepare(
        'UPDATE knowledge SET superseded_by = ?, superseded_at = CURRENT_TIMESTAMP WHERE id = ?',
      ).run(k2, k1);

      const results = getKnowledgeByEntity(dbManager.db, 'sarah');
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe('new@work.com');
    });

    it('filters by entity type when specified', () => {
      findOrCreateEntity(dbManager.db, 'Portland', 'location');
      findOrCreateEntity(dbManager.db, 'Portland', 'organization');

      const k1 = insertKnowledge(dbManager.db, 'user_fact', 'lives_in', 'Portland');
      const k2 = insertKnowledge(dbManager.db, 'user_fact', 'employer', 'Portland Inc');

      const locId = findOrCreateEntity(dbManager.db, 'Portland', 'location');
      const orgId = findOrCreateEntity(dbManager.db, 'Portland', 'organization');

      linkEntityToKnowledge(dbManager.db, locId, k1);
      linkEntityToKnowledge(dbManager.db, orgId, k2);

      const locationResults = getKnowledgeByEntity(dbManager.db, 'portland', 'location');
      expect(locationResults).toHaveLength(1);
      expect(locationResults[0].key).toBe('lives_in');
    });
  });

  describe('searchEntities', () => {
    it('finds entities by partial name match', () => {
      findOrCreateEntity(dbManager.db, 'Sarah Johnson', 'person');
      findOrCreateEntity(dbManager.db, 'Sarah Williams', 'person');
      findOrCreateEntity(dbManager.db, 'Bob', 'person');

      const results = searchEntities(dbManager.db, 'sarah');
      expect(results).toHaveLength(2);
    });

    it('returns empty array when no match', () => {
      findOrCreateEntity(dbManager.db, 'Sarah', 'person');
      const results = searchEntities(dbManager.db, 'xyz');
      expect(results).toHaveLength(0);
    });
  });

  describe('getEntities', () => {
    it('returns all entities', () => {
      findOrCreateEntity(dbManager.db, 'Sarah', 'person');
      findOrCreateEntity(dbManager.db, 'Google', 'organization');
      findOrCreateEntity(dbManager.db, 'Seattle', 'location');

      const entities = getEntities(dbManager.db);
      expect(entities).toHaveLength(3);
    });

    it('filters by entity type', () => {
      findOrCreateEntity(dbManager.db, 'Sarah', 'person');
      findOrCreateEntity(dbManager.db, 'Google', 'organization');

      const people = getEntities(dbManager.db, 'person');
      expect(people).toHaveLength(1);
      expect(people[0].name).toBe('Sarah');
    });
  });
});
