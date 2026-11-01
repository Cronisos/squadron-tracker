-- Le jeton n'est jamais stocké : seulement son empreinte SHA-256.
CREATE TABLE IF NOT EXISTS members (
  cmdr TEXT PRIMARY KEY COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merits (
  id TEXT PRIMARY KEY,
  cmdr TEXT NOT NULL,
  system TEXT NOT NULL,
  merits INTEGER NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS merits_at ON merits (at);

CREATE TABLE IF NOT EXISTS rate (
  token_hash TEXT NOT NULL,
  minute INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (token_hash, minute)
);

CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
