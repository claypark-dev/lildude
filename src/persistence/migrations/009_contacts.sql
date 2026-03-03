-- Migration 009: Contact Management + Trust Levels
-- Sprint 8: Contacts with trust-based access control for external users.

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  trust_level TEXT NOT NULL DEFAULT 'unknown'
    CHECK(trust_level IN ('owner', 'trusted', 'known', 'unknown')),
  is_favorite INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  permitted_waves TEXT NOT NULL DEFAULT '[]',  -- JSON array of wave names
  channel_ids TEXT NOT NULL DEFAULT '{}',       -- JSON map: channelType -> userId
  rate_limit_per_hour INTEGER NOT NULL DEFAULT 10,
  budget_cap_usd REAL NOT NULL DEFAULT 0.0,
  tags TEXT NOT NULL DEFAULT '[]',             -- JSON array of strings
  last_contacted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_trust_level ON contacts(trust_level);
CREATE INDEX IF NOT EXISTS idx_contacts_is_favorite ON contacts(is_favorite);

-- Trigger to auto-update updated_at
CREATE TRIGGER IF NOT EXISTS contacts_updated_at
  AFTER UPDATE ON contacts
  FOR EACH ROW
BEGIN
  UPDATE contacts SET updated_at = datetime('now') WHERE id = NEW.id;
END;
