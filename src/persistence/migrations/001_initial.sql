-- 001_initial.sql
-- Full schema for Lil Dude persistence layer.
-- See HLD Section 10 for details.

CREATE TABLE IF NOT EXISTS config_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','killed','awaiting_approval')),
  type TEXT NOT NULL CHECK(type IN ('chat','automation','skill','cron','system')),
  description TEXT,
  channel_type TEXT,
  channel_id TEXT,
  user_id TEXT,
  token_budget_usd REAL,
  tokens_spent_usd REAL DEFAULT 0,
  model_used TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cached_tokens INTEGER DEFAULT 0,
  cost_usd REAL NOT NULL,
  round_trip_number INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_token_usage_task ON token_usage(task_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage(created_at);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  channel_type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  summary TEXT,
  key_facts TEXT,
  message_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool_call','tool_result')),
  content TEXT NOT NULL,
  token_count INTEGER,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conv_logs_conv ON conversation_logs(conversation_id);

CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source_conversation_id TEXT,
  source_task_id TEXT,
  confidence REAL DEFAULT 1.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_cat_key ON knowledge(category, key);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);

CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY,
  schedule TEXT NOT NULL,
  task_description TEXT NOT NULL,
  skill_id TEXT,
  uses_ai BOOLEAN DEFAULT 0,
  estimated_cost_per_run REAL DEFAULT 0,
  last_run_at DATETIME,
  last_run_status TEXT,
  next_run_at DATETIME,
  enabled BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS security_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  action_detail TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  security_level INTEGER NOT NULL,
  reason TEXT,
  task_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_log_created ON security_log(created_at);

CREATE TABLE IF NOT EXISTS approval_queue (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_detail TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','expired')),
  channel_type TEXT,
  channel_id TEXT,
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME,
  expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS skills_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('bundled','installed','generated')),
  manifest TEXT NOT NULL,
  is_deterministic BOOLEAN DEFAULT 0,
  enabled BOOLEAN DEFAULT 1,
  installed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
