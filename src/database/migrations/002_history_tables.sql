CREATE TABLE IF NOT EXISTS clan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  clan_name TEXT NOT NULL COLLATE NOCASE,
  points INTEGER NOT NULL DEFAULT 0,
  place INTEGER NOT NULL DEFAULT 0,
  diamonds INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_clan_history_clan_time
  ON clan_history(clan_name, timestamp);

CREATE TABLE IF NOT EXISTS player_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  clan_name TEXT NOT NULL COLLATE NOCASE,
  user_id INTEGER NOT NULL,
  battle_id TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 0,
  diamonds INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_player_history_user_time
  ON player_history(user_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_player_history_clan_time
  ON player_history(clan_name, timestamp);

CREATE INDEX IF NOT EXISTS idx_player_history_user_battle_time
  ON player_history(user_id, battle_id, timestamp);
