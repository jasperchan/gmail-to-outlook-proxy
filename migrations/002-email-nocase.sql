-- Up
-- Emails are matched case-insensitively (SMTP usernames are typed by hand).
CREATE INDEX IF NOT EXISTS Tokens_email_nocase ON Tokens (email COLLATE NOCASE);

-- Down
DROP INDEX IF EXISTS Tokens_email_nocase;
