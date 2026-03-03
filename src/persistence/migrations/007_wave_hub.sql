-- Migration 007: Wave Hub + Plugin Architecture
-- Sprint 5: Adds wave_hub_cache for remote registry caching,
-- wave_ratings for user ratings, and mcp_servers for MCP client config.

-- ============================================================
-- 1. Wave Hub remote registry cache
-- Stores fetched registry JSON with TTL-based invalidation.
-- ============================================================
CREATE TABLE IF NOT EXISTS wave_hub_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registry_url TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  etag TEXT,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

-- ============================================================
-- 2. Wave ratings — user ratings for installed waves
-- ============================================================
CREATE TABLE IF NOT EXISTS wave_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wave_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wave_name)
);

-- ============================================================
-- 3. MCP server connections — external tool providers
-- ============================================================
CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL CHECK(transport IN ('stdio', 'sse')),
  command TEXT,
  args TEXT,
  url TEXT,
  env TEXT,
  enabled BOOLEAN NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connected', 'disconnected', 'error')),
  last_connected_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
