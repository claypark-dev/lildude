-- Migration 011: External User Waves
-- Tables for message relay and auto-responder features.

-- Relayed messages from external users to owner
CREATE TABLE IF NOT EXISTS relayed_messages (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'normal'
    CHECK(urgency IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'unread'
    CHECK(status IN ('unread', 'read', 'archived', 'replied')),
  channel_type TEXT,
  channel_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  replied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_relayed_messages_contact_id ON relayed_messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_relayed_messages_status ON relayed_messages(status);
CREATE INDEX IF NOT EXISTS idx_relayed_messages_urgency ON relayed_messages(urgency);
CREATE INDEX IF NOT EXISTS idx_relayed_messages_created_at ON relayed_messages(created_at);

-- Auto-responder configuration
CREATE TABLE IF NOT EXISTS auto_responder_config (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK(status IN ('available', 'busy', 'away', 'dnd', 'vacation', 'offline')),
  custom_message TEXT,
  return_date TEXT,
  alternate_contact TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default config row (singleton)
INSERT OR IGNORE INTO auto_responder_config (id, enabled, status) VALUES (1, 0, 'available');

-- Meeting requests pending owner approval
CREATE TABLE IF NOT EXISTS meeting_requests (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  proposed_time TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  subject TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'declined', 'expired')),
  owner_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_meeting_requests_contact_id ON meeting_requests(contact_id);
CREATE INDEX IF NOT EXISTS idx_meeting_requests_status ON meeting_requests(status);
CREATE INDEX IF NOT EXISTS idx_meeting_requests_created_at ON meeting_requests(created_at);
