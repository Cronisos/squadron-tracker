-- Le jeton n'est jamais stocké : seulement son empreinte SHA-256.
CREATE TABLE IF NOT EXISTS members (
  cmdr TEXT PRIMARY KEY COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- Jetons en plus de celui de members : un par installation (app, plugin, PC réinstallé), obtenus avec le code de
-- l'escadron. Seule leur empreinte est gardée ; au plus 10 par commandant.
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  cmdr TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_cmdr ON tokens (cmdr);

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

-- Partage entre membres (rôles, installations à confirmer, partages adressés) : voir api/src/index.js.
-- Une installation de plus sous un nom déjà inscrit : à confirmer avant tout accès aux partages.
CREATE TABLE IF NOT EXISTS pending (
  token_hash TEXT PRIMARY KEY,
  cmdr TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL
);

-- Rôles créés par le chef ; rank : plus grand = plus haut dans la hiérarchie.
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member_roles (
  cmdr TEXT PRIMARY KEY COLLATE NOCASE,
  role TEXT NOT NULL
);

-- audience : 'all' (tout l'escadron), 'role' (ce rôle et au-dessus) ou 'cmdrs' (les commandants de share_targets)
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  cmdr TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  audience TEXT NOT NULL,
  role TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_cmdr ON shares (cmdr);

-- Clé publique de chaque installation (X25519, 32 octets en base64) : sert aux autres membres à chiffrer un partage
-- pour elle. Le serveur ne détient aucune clé privée et ne peut pas lire un partage chiffré.
CREATE TABLE IF NOT EXISTS install_keys (
  token_hash TEXT PRIMARY KEY,
  cmdr TEXT NOT NULL COLLATE NOCASE,
  public_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS install_keys_cmdr ON install_keys (cmdr);

CREATE TABLE IF NOT EXISTS share_targets (
  share_id TEXT NOT NULL,
  cmdr TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (share_id, cmdr)
);
