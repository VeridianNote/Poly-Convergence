-- Reactions table: stores like and share counts per page
CREATE TABLE IF NOT EXISTS reactions (
  slug TEXT PRIMARY KEY,
  likes INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for sorting by popularity (homepage queries)
CREATE INDEX IF NOT EXISTS idx_reactions_likes ON reactions(likes DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_shares ON reactions(shares DESC);
