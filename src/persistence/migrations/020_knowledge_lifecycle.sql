-- Migration 020: Knowledge Lifecycle & Entity Linking
-- Adds supersession tracking, entity tables, and entity-knowledge links.
-- Part of the Memory System Re-engineering (Sprint A + B).

-- ── Supersession columns for knowledge table ────────────────────────
-- When a fact is replaced by a newer/more confident version, the old
-- entry is marked as superseded rather than deleted (audit trail).
ALTER TABLE knowledge ADD COLUMN superseded_by INTEGER REFERENCES knowledge(id);
ALTER TABLE knowledge ADD COLUMN superseded_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_knowledge_superseded ON knowledge(superseded_by);

-- ── Entity table ────────────────────────────────────────────────────
-- Tracks named entities (people, orgs, projects, locations, events)
-- mentioned in knowledge facts. Enables "What do I know about Sarah?"
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'person'
    CHECK(entity_type IN ('person','organization','project','location','event')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_canonical ON entities(canonical_name, entity_type);

-- ── Entity-Knowledge links ──────────────────────────────────────────
-- Links entities to their associated knowledge entries.
CREATE TABLE IF NOT EXISTS entity_knowledge_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  knowledge_id INTEGER NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'related',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ekl_entity ON entity_knowledge_links(entity_id);
CREATE INDEX IF NOT EXISTS idx_ekl_knowledge ON entity_knowledge_links(knowledge_id);
