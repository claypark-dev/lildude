-- Gateway authentication: API keys table for multi-key support.
-- Initially one key is auto-generated; future sprints add per-contact keys.

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT 'default',
  key_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,
  revoked_at DATETIME,
  UNIQUE(label)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
