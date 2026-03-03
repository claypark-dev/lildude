-- ============================================================
-- Migration 005: OAuth2 Token Storage
-- ============================================================
-- Stores encrypted OAuth2 tokens for external service integrations.
-- Tokens are encrypted at rest using AES-256-GCM with a per-installation key.

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,                    -- e.g. 'google', 'microsoft', 'github'
  account_label TEXT NOT NULL DEFAULT 'default', -- user-friendly label for the account
  access_token_encrypted TEXT NOT NULL,      -- AES-256-GCM encrypted access token
  refresh_token_encrypted TEXT,              -- AES-256-GCM encrypted refresh token (nullable for some flows)
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  scope TEXT,                                -- space-separated OAuth scopes
  expires_at DATETIME,                       -- when the access token expires
  iv TEXT NOT NULL,                           -- initialization vector for decryption
  auth_tag TEXT NOT NULL,                     -- GCM authentication tag
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, account_label)
);

CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_tokens(provider);
CREATE INDEX IF NOT EXISTS idx_oauth_expires ON oauth_tokens(expires_at);

-- OAuth state table for CSRF protection during auth flow
CREATE TABLE IF NOT EXISTS oauth_state (
  state TEXT PRIMARY KEY,                    -- random state parameter
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,               -- PKCE code verifier
  redirect_uri TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL               -- short-lived (10 minutes)
);
