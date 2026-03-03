-- Migration 013: Party Waves
-- Tables for party wave features: task delegation, FAQ, event RSVP, document requests.
-- Also adds wave_category column to waves_registry.

-- Add wave_category to existing waves_registry table
ALTER TABLE waves_registry ADD COLUMN wave_category TEXT NOT NULL DEFAULT 'personal'
  CHECK(wave_category IN ('personal', 'party'));

-- Task delegations from trusted contacts for owner review
CREATE TABLE IF NOT EXISTS task_delegations (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'accepted', 'declined', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_delegations_contact_id ON task_delegations(contact_id);
CREATE INDEX IF NOT EXISTS idx_task_delegations_status ON task_delegations(status);
CREATE INDEX IF NOT EXISTS idx_task_delegations_priority ON task_delegations(priority);
CREATE INDEX IF NOT EXISTS idx_task_delegations_created_at ON task_delegations(created_at);

-- FAQ entries configured by owner for external user questions
CREATE TABLE IF NOT EXISTS faq_entries (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  enabled INTEGER NOT NULL DEFAULT 1,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_faq_entries_category ON faq_entries(category);
CREATE INDEX IF NOT EXISTS idx_faq_entries_enabled ON faq_entries(enabled);

-- Event RSVP responses from external users
CREATE TABLE IF NOT EXISTS event_rsvps (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_date TEXT,
  rsvp_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(rsvp_status IN ('pending', 'attending', 'declined', 'maybe')),
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_contact_id ON event_rsvps(contact_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event_name ON event_rsvps(event_name);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_rsvp_status ON event_rsvps(rsvp_status);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_created_at ON event_rsvps(created_at);

-- Document requests pending owner approval
CREATE TABLE IF NOT EXISTS document_requests (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'declined')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_requests_contact_id ON document_requests(contact_id);
CREATE INDEX IF NOT EXISTS idx_document_requests_status ON document_requests(status);
CREATE INDEX IF NOT EXISTS idx_document_requests_created_at ON document_requests(created_at);

-- Party wave settings (per-wave enable/disable + per-contact config)
CREATE TABLE IF NOT EXISTS party_wave_settings (
  wave_name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  per_contact_config TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed default party wave settings for existing party waves
INSERT OR IGNORE INTO party_wave_settings (wave_name, enabled) VALUES ('auto-responder', 1);
INSERT OR IGNORE INTO party_wave_settings (wave_name, enabled) VALUES ('availability-check', 1);
INSERT OR IGNORE INTO party_wave_settings (wave_name, enabled) VALUES ('contact-share', 1);
INSERT OR IGNORE INTO party_wave_settings (wave_name, enabled) VALUES ('message-relay', 1);
INSERT OR IGNORE INTO party_wave_settings (wave_name, enabled) VALUES ('meeting-request', 1);
INSERT OR IGNORE INTO party_wave_settings (wave_name, enabled) VALUES ('task-delegation', 1);
INSERT OR IGNORE INTO party_wave_settings (wave_name, enabled) VALUES ('faq-responder', 1);
INSERT OR IGNORE INTO party_wave_settings (wave_name, enabled) VALUES ('event-rsvp', 1);
INSERT OR IGNORE INTO party_wave_settings (wave_name, enabled) VALUES ('document-request', 1);
