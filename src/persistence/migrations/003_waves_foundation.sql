-- 003_waves_foundation.sql
-- Rename skill references to waves + add Sprint 0 foundation tables.
-- Part of the skills → waves rename and foundation hardening.

-- ============================================================
-- 1. Rename skills_registry → waves_registry
-- ============================================================
ALTER TABLE skills_registry RENAME TO waves_registry;

-- ============================================================
-- 2. Rename skill_id → wave_id in cron_jobs
-- ============================================================
ALTER TABLE cron_jobs RENAME COLUMN skill_id TO wave_id;

-- ============================================================
-- 3. Update tasks.type CHECK constraint to use 'wave' instead of 'skill'.
--    SQLite doesn't support ALTER CHECK, so we recreate the table.
-- ============================================================
CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','killed','awaiting_approval')),
  type TEXT NOT NULL CHECK(type IN ('chat','automation','wave','cron','system')),
  description TEXT,
  channel_type TEXT,
  channel_id TEXT,
  user_id TEXT,
  token_budget_usd REAL,
  tokens_spent_usd REAL DEFAULT 0,
  model_used TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

INSERT INTO tasks_new SELECT * FROM tasks;

-- Update any existing rows that have type='skill' to 'wave'
UPDATE tasks_new SET type = 'wave' WHERE type = 'skill';

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

-- Recreate foreign key references from token_usage and conversations
-- (SQLite doesn't lose these on table rename since they reference by name,
--  but we need to ensure the indexes are intact)

-- ============================================================
-- 4. User profile table — stores learned preferences and patterns
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'inferred' CHECK(source IN ('inferred','explicit','system')),
  confidence REAL NOT NULL DEFAULT 0.5,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_profile_key ON user_profile(key);

-- ============================================================
-- 5. Knowledge embeddings table — vector storage for hybrid search
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_id INTEGER NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_kid ON knowledge_embeddings(knowledge_id);

-- ============================================================
-- 6. User feedback table — thumbs up/down for quality routing
-- ============================================================
CREATE TABLE IF NOT EXISTS user_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  conversation_id TEXT,
  rating INTEGER NOT NULL CHECK(rating IN (-1, 1)),
  comment TEXT,
  model TEXT,
  provider TEXT,
  wave_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_task ON user_feedback(task_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_model ON user_feedback(model);

-- ============================================================
-- 7. Generated waves table — tracks Shorebreak-created waves
-- ============================================================
CREATE TABLE IF NOT EXISTS generated_waves (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  safety_tier TEXT NOT NULL DEFAULT 'observe' CHECK(safety_tier IN ('observe','create','modify','destroy','execute')),
  source_template TEXT,
  source_code TEXT NOT NULL,
  manifest TEXT NOT NULL,
  scan_result TEXT,
  scan_passed BOOLEAN NOT NULL DEFAULT 0,
  user_approved BOOLEAN NOT NULL DEFAULT 0,
  test_passed BOOLEAN NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 8. Failure patterns table — tracks recurring failures for learning
-- ============================================================
CREATE TABLE IF NOT EXISTS failure_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent TEXT NOT NULL,
  tool_name TEXT,
  wave_name TEXT,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  resolution TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_failure_patterns_intent ON failure_patterns(intent);
CREATE INDEX IF NOT EXISTS idx_failure_patterns_tool ON failure_patterns(tool_name);

-- ============================================================
-- 9. Add safety_tier column to waves_registry
-- ============================================================
ALTER TABLE waves_registry ADD COLUMN safety_tier TEXT DEFAULT 'observe'
  CHECK(safety_tier IN ('observe','create','modify','destroy','execute'));

-- ============================================================
-- 10. Add access tracking columns to knowledge table for temporal decay
-- ============================================================
ALTER TABLE knowledge ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge ADD COLUMN last_accessed_at DATETIME;
