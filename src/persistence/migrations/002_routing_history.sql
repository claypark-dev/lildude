-- 002_routing_history.sql
-- Routing history table for quality-aware model routing.
-- See S3.R.2 for details.

CREATE TABLE IF NOT EXISTS routing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  tier TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'chat',
  quality_score REAL,
  feedback TEXT,
  input_length INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_routing_history_model ON routing_history(model);
CREATE INDEX IF NOT EXISTS idx_routing_history_task_type ON routing_history(task_type);
