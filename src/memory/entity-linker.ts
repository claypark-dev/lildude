/**
 * Entity-relationship linking for knowledge entries.
 * Detects named entities (people, organizations, projects, locations)
 * mentioned in knowledge facts and links them via the entities /
 * entity_knowledge_links tables.
 *
 * Enables queries like "What do I know about Sarah?"
 *
 * All logic is deterministic — no LLM calls.
 * Part of the Memory System Re-engineering (Sprint B, Gap 4).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { createModuleLogger } from '../utils/logger.js';
import type { EntityType } from './inline-extractor.js';

const log = createModuleLogger('entity-linker');

/** A persisted entity record. */
export interface Entity {
  id: number;
  name: string;
  canonicalName: string;
  entityType: EntityType;
  createdAt: string;
  updatedAt: string;
}

/** Raw DB row shape for the entities table. */
interface EntityDbRow {
  id: number;
  name: string;
  canonical_name: string;
  entity_type: string;
  created_at: string;
  updated_at: string;
}

/**
 * Find or create an entity by name and type.
 * Uses canonical_name (lowercase, trimmed) for deduplication.
 *
 * @param db - Database connection.
 * @param name - The entity's display name (e.g. "Sarah").
 * @param entityType - The entity type (person, organization, etc.).
 * @returns The entity's database ID.
 */
export function findOrCreateEntity(
  db: BetterSqlite3.Database,
  name: string,
  entityType: EntityType,
): number {
  const canonicalName = canonicalize(name);

  // Try to find existing entity
  const existing = db.prepare(
    `SELECT id FROM entities
     WHERE canonical_name = ? AND entity_type = ?`,
  ).get(canonicalName, entityType) as { id: number } | undefined;

  if (existing) {
    return existing.id;
  }

  // Create new entity
  const result = db.prepare(
    `INSERT INTO entities (name, canonical_name, entity_type)
     VALUES (?, ?, ?)`,
  ).run(name, canonicalName, entityType);

  const entityId = result.lastInsertRowid as number;
  log.debug({ entityId, name, entityType }, 'Created new entity');
  return entityId;
}

/**
 * Link a knowledge entry to an entity.
 * Skips if the link already exists.
 *
 * @param db - Database connection.
 * @param entityId - The entity's database ID.
 * @param knowledgeId - The knowledge entry's database ID.
 * @param relationship - The relationship type (default: 'related').
 */
export function linkEntityToKnowledge(
  db: BetterSqlite3.Database,
  entityId: number,
  knowledgeId: number,
  relationship = 'related',
): void {
  // Check for existing link
  const existing = db.prepare(
    `SELECT id FROM entity_knowledge_links
     WHERE entity_id = ? AND knowledge_id = ?`,
  ).get(entityId, knowledgeId) as { id: number } | undefined;

  if (existing) return;

  db.prepare(
    `INSERT INTO entity_knowledge_links (entity_id, knowledge_id, relationship)
     VALUES (?, ?, ?)`,
  ).run(entityId, knowledgeId, relationship);
}

/**
 * Process extracted entities from inline facts and link them to knowledge entries.
 * Called after upsertKnowledge when entities are detected.
 *
 * @param db - Database connection.
 * @param knowledgeId - The knowledge entry ID to link entities to.
 * @param entities - Array of detected entities with name and type.
 */
export function processEntities(
  db: BetterSqlite3.Database,
  knowledgeId: number,
  entities: Array<{ name: string; type: EntityType }>,
): void {
  for (const entity of entities) {
    try {
      const entityId = findOrCreateEntity(db, entity.name, entity.type);
      linkEntityToKnowledge(db, entityId, knowledgeId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn({ error: msg, entityName: entity.name }, 'Failed to process entity (non-fatal)');
    }
  }
}

/**
 * Get all knowledge entries linked to a specific entity.
 * Only returns active (non-superseded) entries.
 *
 * @param db - Database connection.
 * @param entityName - The entity name to search for (case-insensitive).
 * @param entityType - Optional entity type filter.
 * @returns Array of knowledge entries associated with the entity.
 */
export function getKnowledgeByEntity(
  db: BetterSqlite3.Database,
  entityName: string,
  entityType?: EntityType,
): Array<{
  knowledgeId: number;
  category: string;
  key: string;
  value: string;
  confidence: number;
  relationship: string;
}> {
  const canonicalName = canonicalize(entityName);

  let query = `
    SELECT k.id as knowledge_id, k.category, k.key, k.value, k.confidence,
           ekl.relationship
    FROM knowledge k
    JOIN entity_knowledge_links ekl ON ekl.knowledge_id = k.id
    JOIN entities e ON e.id = ekl.entity_id
    WHERE e.canonical_name = ? AND k.superseded_by IS NULL
  `;
  const params: (string | number)[] = [canonicalName];

  if (entityType) {
    query += ' AND e.entity_type = ?';
    params.push(entityType);
  }

  query += ' ORDER BY k.confidence DESC, k.created_at DESC';

  const rows = db.prepare(query).all(...params) as Array<{
    knowledge_id: number;
    category: string;
    key: string;
    value: string;
    confidence: number;
    relationship: string;
  }>;

  return rows.map((r) => ({
    knowledgeId: r.knowledge_id,
    category: r.category,
    key: r.key,
    value: r.value,
    confidence: r.confidence,
    relationship: r.relationship,
  }));
}

/**
 * Get all known entities, optionally filtered by type.
 *
 * @param db - Database connection.
 * @param entityType - Optional type filter.
 * @returns Array of entities.
 */
export function getEntities(
  db: BetterSqlite3.Database,
  entityType?: EntityType,
): Entity[] {
  let query = 'SELECT * FROM entities';
  const params: string[] = [];

  if (entityType) {
    query += ' WHERE entity_type = ?';
    params.push(entityType);
  }

  query += ' ORDER BY updated_at DESC';

  const rows = db.prepare(query).all(...params) as EntityDbRow[];
  return rows.map(mapEntityRow);
}

/**
 * Search for entities by name (fuzzy match).
 *
 * @param db - Database connection.
 * @param searchTerm - The term to search for.
 * @returns Matching entities.
 */
export function searchEntities(
  db: BetterSqlite3.Database,
  searchTerm: string,
): Entity[] {
  const pattern = `%${searchTerm.toLowerCase()}%`;
  const rows = db.prepare(
    `SELECT * FROM entities
     WHERE canonical_name LIKE ?
     ORDER BY updated_at DESC
     LIMIT 20`,
  ).all(pattern) as EntityDbRow[];

  return rows.map(mapEntityRow);
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Canonicalize an entity name for deduplication. */
function canonicalize(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Map a raw DB row to an Entity. */
function mapEntityRow(row: EntityDbRow): Entity {
  return {
    id: row.id,
    name: row.name,
    canonicalName: row.canonical_name,
    entityType: row.entity_type as EntityType,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
