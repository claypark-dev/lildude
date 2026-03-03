-- 004_fts5_knowledge.sql
-- Add FTS5 full-text search on knowledge table for BM25 keyword search.
-- Part of Sprint 1: Enhanced Memory & Learning.

-- ============================================================
-- 1. Create FTS5 virtual table mirroring knowledge key+value
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  key,
  value,
  category,
  content='knowledge',
  content_rowid='id'
);

-- ============================================================
-- 2. Populate FTS index from existing knowledge rows
-- ============================================================
INSERT INTO knowledge_fts(rowid, key, value, category)
  SELECT id, key, value, category FROM knowledge;

-- ============================================================
-- 3. Triggers to keep FTS index in sync with knowledge table
-- ============================================================

-- After INSERT: add new entry to FTS
CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
  INSERT INTO knowledge_fts(rowid, key, value, category)
    VALUES (new.id, new.key, new.value, new.category);
END;

-- After DELETE: remove entry from FTS
CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, key, value, category)
    VALUES ('delete', old.id, old.key, old.value, old.category);
END;

-- After UPDATE: re-index entry in FTS
CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, key, value, category)
    VALUES ('delete', old.id, old.key, old.value, old.category);
  INSERT INTO knowledge_fts(rowid, key, value, category)
    VALUES (new.id, new.key, new.value, new.category);
END;
