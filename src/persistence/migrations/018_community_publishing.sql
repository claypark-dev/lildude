-- Migration 018: Community publishing support
-- Adds tables for community wave hub (Shorebreak community features)

-- Community author profiles (linked to GitHub identity)
CREATE TABLE IF NOT EXISTS wave_authors (
  github_username TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  published_count INTEGER NOT NULL DEFAULT 0,
  total_installs INTEGER NOT NULL DEFAULT 0,
  average_rating REAL NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Community trust scores (cached, recomputed periodically)
CREATE TABLE IF NOT EXISTS wave_community_trust (
  wave_name TEXT PRIMARY KEY,
  trust_score INTEGER NOT NULL DEFAULT 0,
  trust_tier TEXT NOT NULL DEFAULT 'unreviewed',
  scan_passed INTEGER NOT NULL DEFAULT 0,
  sandbox_passed INTEGER NOT NULL DEFAULT 0,
  high_findings INTEGER NOT NULL DEFAULT 0,
  critical_findings INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Publish history (tracks submissions from this instance)
CREATE TABLE IF NOT EXISTS wave_publish_history (
  id TEXT PRIMARY KEY,
  wave_name TEXT NOT NULL,
  version TEXT NOT NULL,
  pr_url TEXT,
  pr_number INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_publish_history_wave
  ON wave_publish_history(wave_name);

-- Package verification (hash validation for installed community waves)
CREATE TABLE IF NOT EXISTS wave_package_hashes (
  wave_name TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  verified_at TEXT NOT NULL DEFAULT (datetime('now'))
);
