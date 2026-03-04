-- Migration 017: Wave executions tracking
-- Tracks ALL wave executions (bundled + generated) for analytics and the Skills Hub.
-- The existing generated_waves table only tracks generated wave effectiveness;
-- this table provides comprehensive execution history across all wave sources.

CREATE TABLE IF NOT EXISTS wave_executions (
  id TEXT PRIMARY KEY,
  wave_name TEXT NOT NULL,
  wave_source TEXT NOT NULL DEFAULT 'bundled',  -- 'bundled' | 'installed' | 'generated'
  wave_category TEXT,                            -- Skills Hub category
  contact_id TEXT,                               -- NULL for owner-initiated
  success INTEGER NOT NULL DEFAULT 1,            -- 0 = failure, 1 = success
  execution_time_ms INTEGER,                     -- Duration in milliseconds
  error_message TEXT,                            -- Error details if failed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_wave_executions_name
  ON wave_executions (wave_name, created_at);

CREATE INDEX IF NOT EXISTS idx_wave_executions_source
  ON wave_executions (wave_source, created_at);

CREATE INDEX IF NOT EXISTS idx_wave_executions_created
  ON wave_executions (created_at);
