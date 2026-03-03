-- ============================================================
-- Migration 006: Self-Improvement Loop
-- ============================================================
-- Adds learning journal table for daily aggregation summaries,
-- and request classifications table for vector-based safety tier matching.

-- ── Learning Journal ──────────────────────────────────────────
-- Daily deterministic aggregation of task volume, success rates,
-- common request types, and cost trends. No LLM calls needed.
CREATE TABLE IF NOT EXISTS learning_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,                 -- YYYY-MM-DD
  total_tasks INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  failed_tasks INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  avg_quality_score REAL,                    -- NULL if no ratings that day
  top_waves TEXT,                            -- JSON array of {name, count} top 5
  top_failure_types TEXT,                    -- JSON array of {type, count} top 5
  positive_feedback_count INTEGER NOT NULL DEFAULT 0,
  negative_feedback_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,                              -- Optional LLM-generated summary
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_learning_journal_date ON learning_journal(date);

-- ── Request Classifications ───────────────────────────────────
-- Canonical examples of user requests mapped to safety tiers.
-- Used by the vector request classifier to cross-reference with
-- wave manifests for the more restrictive tier.
CREATE TABLE IF NOT EXISTS request_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  example_text TEXT NOT NULL,                -- Canonical request example
  safety_tier TEXT NOT NULL CHECK(safety_tier IN ('observe','create','modify','destroy','execute')),
  category TEXT NOT NULL,                    -- e.g. 'email', 'calendar', 'file', 'shell'
  embedding BLOB,                            -- Pre-computed embedding vector
  embedding_model TEXT,                      -- Model used for embedding
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_request_class_tier ON request_classifications(safety_tier);
CREATE INDEX IF NOT EXISTS idx_request_class_category ON request_classifications(category);
