CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS whitelist_clans (
  clan_name TEXT PRIMARY KEY COLLATE NOCASE,
  added_at INTEGER NOT NULL,
  added_by TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_refresh_at INTEGER,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS clans (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  owner_id INTEGER,
  icon TEXT,
  description TEXT,
  member_capacity INTEGER,
  officer_capacity INTEGER,
  guild_level INTEGER,
  country_code TEXT,
  deposited_diamonds INTEGER,
  bronze_medals INTEGER,
  silver_medals INTEGER,
  gold_medals INTEGER,
  battle_id TEXT,
  battle_points INTEGER,
  battle_place INTEGER,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  user_id INTEGER PRIMARY KEY,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clan_members (
  clan_name TEXT NOT NULL COLLATE NOCASE,
  user_id INTEGER NOT NULL,
  permission_level INTEGER,
  join_time INTEGER,
  is_owner INTEGER NOT NULL DEFAULT 0,
  battle_points INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (clan_name, user_id)
);
CREATE INDEX IF NOT EXISTS idx_clan_members_user ON clan_members(user_id);
CREATE INDEX IF NOT EXISTS idx_clan_members_clan ON clan_members(clan_name);

CREATE TABLE IF NOT EXISTS tracked_players (
  user_id INTEGER PRIMARY KEY,
  clan_name TEXT COLLATE NOCASE,
  added_at INTEGER NOT NULL,
  added_by TEXT
);
CREATE TABLE IF NOT EXISTS clan_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clan_name TEXT NOT NULL COLLATE NOCASE,
  battle_id TEXT,
  battle_points INTEGER,
  battle_place INTEGER,
  member_count INTEGER NOT NULL,
  diamonds INTEGER,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clan_snapshots_clan_time ON clan_snapshots(clan_name, captured_at);
CREATE INDEX IF NOT EXISTS idx_clan_snapshots_battle ON clan_snapshots(battle_id, captured_at);

CREATE TABLE IF NOT EXISTS player_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  clan_name TEXT COLLATE NOCASE,
  battle_id TEXT,
  battle_points INTEGER,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_player_snapshots_user_time ON player_snapshots(user_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_player_snapshots_battle ON player_snapshots(battle_id, captured_at);

CREATE TABLE IF NOT EXISTS membership_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clan_name TEXT NOT NULL COLLATE NOCASE,
  user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_membership_events_clan_time ON membership_events(clan_name, created_at);

CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
