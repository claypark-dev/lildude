-- Migration 014: Enhanced Waves Hub
-- Adds install counts, categories, featured waves, and review tracking
-- for the enhanced Waves Hub marketplace.

-- Wave install counts (local tracking)
CREATE TABLE IF NOT EXISTS wave_install_counts (
  wave_name TEXT PRIMARY KEY,
  install_count INTEGER NOT NULL DEFAULT 0,
  first_installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_installed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wave categories for browsing/filtering
CREATE TABLE IF NOT EXISTS wave_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Seed default categories
INSERT OR IGNORE INTO wave_categories (id, name, display_name, description, icon, sort_order) VALUES
  ('cat_productivity', 'productivity', 'Productivity', 'Tools to get things done', '⚡', 1),
  ('cat_communication', 'communication', 'Communication', 'Email, messaging, and notifications', '💬', 2),
  ('cat_finance', 'finance', 'Finance', 'Budgeting, stocks, and financial tracking', '💰', 3),
  ('cat_utilities', 'utilities', 'Utilities', 'General-purpose helper tools', '🔧', 4),
  ('cat_social', 'social', 'Social', 'Social media and networking', '👥', 5),
  ('cat_party', 'party', 'Party Waves', 'External-facing waves for contacts', '🌊', 6),
  ('cat_developer', 'developer', 'Developer', 'Code review, CI/CD, and dev tools', '🛠️', 7),
  ('cat_health', 'health', 'Health', 'Fitness, wellness, and health tracking', '❤️', 8),
  ('cat_entertainment', 'entertainment', 'Entertainment', 'Music, media, and fun', '🎮', 9);

-- Featured waves (curated by owner or registry)
CREATE TABLE IF NOT EXISTS featured_waves (
  wave_name TEXT PRIMARY KEY,
  featured_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT
);

-- Wave reviews (multi-review per wave, replaces single-rating system)
CREATE TABLE IF NOT EXISTS wave_reviews (
  id TEXT PRIMARY KEY,
  wave_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT,
  reviewer TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wave_reviews_wave_name ON wave_reviews(wave_name);
CREATE INDEX IF NOT EXISTS idx_wave_reviews_rating ON wave_reviews(rating);
