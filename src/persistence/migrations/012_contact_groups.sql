-- 012_contact_groups.sql
-- Contact groups for organizing contacts and notification preferences

CREATE TABLE IF NOT EXISTS contact_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  contact_ids TEXT NOT NULL DEFAULT '[]',
  color TEXT DEFAULT '#6366f1',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_groups_name ON contact_groups(name);

-- Per-contact notification preferences
CREATE TABLE IF NOT EXISTS contact_notifications (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  mute_until TEXT DEFAULT NULL,
  notify_channel TEXT DEFAULT NULL,
  digest_frequency TEXT CHECK(digest_frequency IN ('realtime', 'hourly', 'daily', 'weekly', 'off')) DEFAULT 'realtime',
  notify_on_message INTEGER DEFAULT 1,
  notify_on_wave INTEGER DEFAULT 1,
  notify_on_meeting INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
