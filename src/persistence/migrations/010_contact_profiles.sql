-- Migration 010: Contact Profiles & External Conversations
-- Adds per-contact learned knowledge, conversation tagging, and external interaction audit.

-- Per-contact learned facts (what Lil Dude knows about each contact)
CREATE TABLE IF NOT EXISTS contact_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'inferred'
    CHECK(source IN ('inferred', 'explicit', 'system')),
  confidence REAL NOT NULL DEFAULT 0.5
    CHECK(confidence >= 0.0 AND confidence <= 1.0),
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(contact_id, key)
);

CREATE INDEX IF NOT EXISTS idx_contact_profiles_contact_id ON contact_profiles(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_profiles_key ON contact_profiles(key);

-- Add contact_id to conversations for external user tracking
ALTER TABLE conversations ADD COLUMN contact_id TEXT REFERENCES contacts(id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations(contact_id);

-- External interaction audit log
CREATE TABLE IF NOT EXISTS external_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  event_type TEXT NOT NULL
    CHECK(event_type IN (
      'message_received', 'wave_triggered', 'wave_blocked',
      'rate_limited', 'budget_exceeded', 'trust_change'
    )),
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_external_audit_contact_id ON external_audit(contact_id);
CREATE INDEX IF NOT EXISTS idx_external_audit_event_type ON external_audit(event_type);
CREATE INDEX IF NOT EXISTS idx_external_audit_created_at ON external_audit(created_at);
