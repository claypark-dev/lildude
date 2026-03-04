-- Migration 016: Performance indexes
-- Adds missing indexes identified during the Sprint 18C performance audit.
-- These indexes improve JOIN and WHERE performance on commonly queried columns.

-- Approval queue lookups by task_id are frequent during wave execution
CREATE INDEX IF NOT EXISTS idx_approval_queue_task_id
  ON approval_queue (task_id);

-- Routing history lookups by task_id for task tracing
CREATE INDEX IF NOT EXISTS idx_routing_history_task_id
  ON routing_history (task_id);

-- Conversations lookups by task_id for task context
CREATE INDEX IF NOT EXISTS idx_conversations_task_id
  ON conversations (task_id);

-- Contact profiles lookups by contact_id for profile building
CREATE INDEX IF NOT EXISTS idx_contact_profiles_contact_key
  ON contact_profiles (contact_id, key);

-- Note: idx_knowledge_visibility already created by migration 015

-- Party wave knowledge access audit log lookups
CREATE INDEX IF NOT EXISTS idx_party_wave_knowledge_access_wave
  ON party_wave_knowledge_access (wave_name, created_at);
