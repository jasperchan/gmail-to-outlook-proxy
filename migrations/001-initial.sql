-- Up
-- Tokens table. IF NOT EXISTS so it also applies to a database that already has it.
CREATE TABLE IF NOT EXISTS Tokens (
  email TEXT NOT NULL PRIMARY KEY,
  token TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT (datetime('now')),
  updated_at TIMESTAMP DEFAULT (datetime('now')),
  smtp_password TEXT NOT NULL,
  app_id TEXT
);

-- Down
-- Intentionally empty: never drop user data from a migration rollback.
