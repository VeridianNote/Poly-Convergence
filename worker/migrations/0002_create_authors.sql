-- Author profiles for community contributors
-- Stores display preferences; keyed by GitHub username from OAuth
CREATE TABLE IF NOT EXISTS authors (
  github_username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Community Contributor',
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
