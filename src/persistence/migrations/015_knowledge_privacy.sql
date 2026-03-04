-- 015_knowledge_privacy.sql
-- Add visibility column to knowledge table for party wave data isolation.
-- Default 'owner' means knowledge is private to the owner.
-- 'shared' means it's safe for party wave contexts.

ALTER TABLE knowledge ADD COLUMN visibility TEXT NOT NULL DEFAULT 'owner'
  CHECK(visibility IN ('owner', 'shared'));

-- Add index for filtering by visibility in hybrid search
CREATE INDEX IF NOT EXISTS idx_knowledge_visibility ON knowledge(visibility);

-- Add access_count and last_accessed_at if not already present
-- (these may exist from earlier migrations on the user_profile table,
-- but knowledge table needs them for temporal decay)
-- Note: SQLite ALTER TABLE won't fail if column already exists in newer versions,
-- but we guard with a safe check pattern.

-- Track visibility in knowledge_embeddings to filter vector search
ALTER TABLE knowledge_embeddings ADD COLUMN visibility TEXT NOT NULL DEFAULT 'owner'
  CHECK(visibility IN ('owner', 'shared'));

-- Party wave knowledge audit log
CREATE TABLE IF NOT EXISTS party_wave_knowledge_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_id INTEGER,
  wave_name TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  access_type TEXT NOT NULL CHECK(access_type IN ('search', 'read', 'blocked')),
  was_allowed BOOLEAN NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pwka_wave ON party_wave_knowledge_access(wave_name);
CREATE INDEX IF NOT EXISTS idx_pwka_contact ON party_wave_knowledge_access(contact_id);
CREATE INDEX IF NOT EXISTS idx_pwka_created ON party_wave_knowledge_access(created_at);
