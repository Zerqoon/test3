import { db } from './db.js';
import type {
  ClanHistoryRow,
  ClanRecord,
  HistoryPoint,
  PlayerHistoryRow,
  RobloxUser
} from '../types.js';

// Auto-Schema Guard: gwarancja istnienia wszystkich tabel przy starcie kontenera
function ensureSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whitelist_clans (
      clan_name TEXT PRIMARY KEY,
      added_at INTEGER NOT NULL,
      added_by TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_refresh_at INTEGER,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS clans (
      name TEXT PRIMARY KEY,
      owner_id INTEGER,
      icon TEXT,
      description TEXT,
      member_capacity INTEGER DEFAULT 0,
      officer_capacity INTEGER DEFAULT 0,
      guild_level INTEGER DEFAULT 1,
      country_code TEXT,
      deposited_diamonds INTEGER DEFAULT 0,
      bronze_medals INTEGER DEFAULT 0,
      silver_medals INTEGER DEFAULT 0,
      gold_medals INTEGER DEFAULT 0,
      battle_id TEXT,
      battle_points INTEGER DEFAULT 0,
      battle_place INTEGER,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clan_members (
      clan_name TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      permission_level INTEGER DEFAULT 0,
      join_time INTEGER,
      is_owner INTEGER DEFAULT 0,
      battle_points INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (clan_name, user_id)
    );

    CREATE TABLE IF NOT EXISTS membership_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clan_name TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      user_id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracked_players (
      user_id INTEGER PRIMARY KEY,
      clan_name TEXT,
      added_at INTEGER NOT NULL,
      added_by TEXT
    );

    CREATE TABLE IF NOT EXISTS clan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      clan_name TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      place INTEGER,
      diamonds INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS player_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      clan_name TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      battle_id TEXT DEFAULT '',
      points INTEGER NOT NULL DEFAULT 0,
      diamonds INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS clan_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clan_name TEXT NOT NULL,
      battle_id TEXT,
      battle_points INTEGER DEFAULT 0,
      battle_place INTEGER,
      member_count INTEGER DEFAULT 0,
      diamonds INTEGER DEFAULT 0,
      captured_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      clan_name TEXT NOT NULL,
      battle_id TEXT,
      battle_points INTEGER DEFAULT 0,
      captured_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clan_hist_lookup ON clan_history(clan_name, timestamp ASC);
    CREATE INDEX IF NOT EXISTS idx_player_hist_lookup ON player_history(user_id, timestamp ASC);
    CREATE INDEX IF NOT EXISTS idx_clan_members_lookup ON clan_members(clan_name, battle_points DESC);
  `);
}

// Uruchamiane jednorazowo przy imporcie modułu
ensureSchema();

export const settingsRepo = {
  get(key: string): string | null {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },
  set(key: string, value: string): void {
    db.prepare(`
      INSERT INTO settings(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(key, value);
  }
};

export const whitelistRepo = {
  list(): string[] {
    const rows = db.prepare(`
      SELECT clan_name
      FROM whitelist_clans
      WHERE enabled=1
      ORDER BY clan_name
    `).all() as Array<{ clan_name: string }>;
    return rows.map((r) => String(r.clan_name));
  },
  has(name: string): boolean {
    return Boolean(db.prepare('SELECT 1 FROM whitelist_clans WHERE clan_name=? AND enabled=1').get(name));
  },
  add(name: string, by?: string): void {
    db.prepare(`
      INSERT INTO whitelist_clans(clan_name, added_at, added_by, enabled)
      VALUES(?, ?, ?, 1)
      ON CONFLICT(clan_name) DO UPDATE SET enabled=1
    `).run(name, Date.now(), by ?? null);
  },
  remove(name: string): void {
    db.prepare('UPDATE whitelist_clans SET enabled=0 WHERE clan_name=?').run(name);
  },
  mark(name: string, ok: boolean, err?: string): void {
    db.prepare(`
      UPDATE whitelist_clans
      SET last_refresh_at=?, last_error=?
      WHERE clan_name=?
    `).run(Date.now(), ok ? null : (err ?? 'unknown'), name);
  },
  count(): number {
    const row = db.prepare('SELECT COUNT(*) AS c FROM whitelist_clans WHERE enabled=1').get() as { c: number } | undefined;
    return Number(row?.c ?? 0);
  }
};

export const clanRepo = {
  get(name: string): Record<string, unknown> | null {
    const row = db.prepare('SELECT * FROM clans WHERE name=?').get(name);
    return (row as Record<string, unknown>) ?? null;
  },

  members(name: string): Array<Record<string, unknown>> {
    return db.prepare(`
      SELECT * FROM clan_members
      WHERE clan_name=?
      ORDER BY is_owner DESC, permission_level DESC, battle_points DESC
    `).all(name) as Array<Record<string, unknown>>;
  },

  memberByUser(userId: number): Record<string, unknown> | null {
    const row = db.prepare(`
      SELECT * FROM clan_members
      WHERE user_id=?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(userId);
    return (row as Record<string, unknown>) ?? null;
  },

  upsertClan(clan: ClanRecord): void {
    // Zabezpieczenie przed błędem better-sqlite3: parametry named NIE MOGĄ być undefined
    db.prepare(`
      INSERT INTO clans(
        name, owner_id, icon, description, member_capacity, officer_capacity,
        guild_level, country_code, deposited_diamonds, bronze_medals, silver_medals,
        gold_medals, battle_id, battle_points, battle_place, fetched_at
      ) VALUES(
        @name, @ownerId, @icon, @description, @memberCapacity, @officerCapacity,
        @guildLevel, @countryCode, @depositedDiamonds, @bronzeMedals, @silverMedals,
        @goldMedals, @battleId, @battlePoints, @battlePlace, @fetchedAt
      )
      ON CONFLICT(name) DO UPDATE SET
        owner_id=excluded.owner_id,
        icon=excluded.icon,
        description=excluded.description,
        member_capacity=excluded.member_capacity,
        officer_capacity=excluded.officer_capacity,
        guild_level=excluded.guild_level,
        country_code=excluded.country_code,
        deposited_diamonds=excluded.deposited_diamonds,
        bronze_medals=excluded.bronze_medals,
        silver_medals=excluded.silver_medals,
        gold_medals=excluded.gold_medals,
        battle_id=excluded.battle_id,
        battle_points=excluded.battle_points,
        battle_place=excluded.battle_place,
        fetched_at=excluded.fetched_at
    `).run({
      name: clan.name,
      ownerId: clan.ownerId ?? null,
      icon: clan.icon ?? null,
      description: clan.description ?? null,
      memberCapacity: clan.memberCapacity ?? 0,
      officerCapacity: clan.officerCapacity ?? 0,
      guildLevel: clan.guildLevel ?? 1,
      countryCode: clan.countryCode ?? null,
      depositedDiamonds: clan.depositedDiamonds ?? 0,
      bronzeMedals: clan.bronzeMedals ?? 0,
      silverMedals: clan.silverMedals ?? 0,
      goldMedals: clan.goldMedals ?? 0,
      battleId: clan.battleId ?? null,
      battlePoints: clan.battlePoints ?? 0,
      battlePlace: clan.battlePlace ?? null,
      fetchedAt: clan.fetchedAt ?? Date.now()
    });
  },

  replaceMembers(clan: ClanRecord, recordEvents = true): void {
    const oldRows = db.prepare(`
      SELECT user_id, permission_level
      FROM clan_members
      WHERE clan_name=?
    `).all(clan.name) as Array<{ user_id: number; permission_level: number }>;

    const old = new Map<number, { user_id: number; permission_level: number }>(
      oldRows.map((row) => [Number(row.user_id), row])
    );

    const incoming = new Map(clan.members.map((member) => [member.userId, member]));

    const transaction = db.transaction(() => {
      if (recordEvents) {
        for (const [userId, row] of old) {
          if (!incoming.has(userId)) {
            db.prepare(`
              INSERT INTO membership_events(
                clan_name, user_id, event_type, old_value, new_value, created_at
              ) VALUES(?, ?, ?, ?, ?, ?)
            `).run(clan.name, userId, 'LEAVE', JSON.stringify(row), null, Date.now());
          }
        }
      }

      for (const member of clan.members) {
        const previous = old.get(member.userId);
        if (recordEvents && !previous) {
          db.prepare(`
            INSERT INTO membership_events(
              clan_name, user_id, event_type, old_value, new_value, created_at
            ) VALUES(?, ?, ?, ?, ?, ?)
          `).run(clan.name, member.userId, 'JOIN', null, JSON.stringify(member), Date.now());
        } else if (
          recordEvents &&
          previous &&
          Number(previous.permission_level) !== member.permissionLevel
        ) {
          db.prepare(`
            INSERT INTO membership_events(
              clan_name, user_id, event_type, old_value, new_value, created_at
            ) VALUES(?, ?, ?, ?, ?, ?)
          `).run(
            clan.name,
            member.userId,
            'ROLE_CHANGE',
            String(previous.permission_level),
            String(member.permissionLevel),
            Date.now()
          );
        }
      }

      db.prepare('DELETE FROM clan_members WHERE clan_name=?').run(clan.name);
      const insert = db.prepare(`
        INSERT INTO clan_members(
          clan_name, user_id, permission_level, join_time, is_owner, battle_points, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?)
      `);

      for (const member of clan.members) {
        insert.run(
          clan.name,
          member.userId,
          member.permissionLevel ?? 0,
          member.joinTime ?? null,
          member.isOwner ? 1 : 0,
          member.battlePoints ?? 0,
          clan.fetchedAt ?? Date.now()
        );
      }
    });

    transaction();
  }
};

export const playerRepo = {
  upsert(player: RobloxUser): void {
    db.prepare(`
      INSERT INTO players(user_id, username, display_name, avatar_url, last_seen_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username=excluded.username,
        display_name=excluded.display_name,
        avatar_url=excluded.avatar_url,
        last_seen_at=excluded.last_seen_at
    `).run(
      player.id,
      player.name,
      player.displayName ?? player.name,
      player.avatarUrl ?? null,
      Date.now()
    );
  },

  get(userId: number): Record<string, unknown> | null {
    const row = db.prepare('SELECT * FROM players WHERE user_id=?').get(userId);
    return (row as Record<string, unknown>) ?? null;
  },

  track(userId: number, clan: string | null, by?: string): void {
    db.prepare(`
      INSERT INTO tracked_players(user_id, clan_name, added_at, added_by)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET clan_name=excluded.clan_name
    `).run(userId, clan, Date.now(), by ?? null);
  },

  untrack(userId: number): void {
    db.prepare('DELETE FROM tracked_players WHERE user_id=?').run(userId);
  },

  tracked(): Array<Record<string, unknown>> {
    return db.prepare(`
      SELECT t.*, p.username, p.display_name
      FROM tracked_players t
      LEFT JOIN players p ON p.user_id = t.user_id
      ORDER BY t.added_at DESC
    `).all() as Array<Record<string, unknown>>;
  }
};

export interface SaveClanHistoryInput {
  timestamp: number;
  clanName: string;
  points: number;
  place: number;
  diamonds: number;
}

export interface SavePlayerHistoryInput {
  userId: number;
  battleId: string;
  points: number;
  diamonds: number;
  clanName?: string;
  timestamp?: number;
}

export const historyRepo = {
  saveClanSnapshot(data: SaveClanHistoryInput): number {
    const result = db.prepare(`
      INSERT INTO clan_history(timestamp, clan_name, points, place, diamonds)
      VALUES(@timestamp, @clanName, @points, @place, @diamonds)
    `).run({
      timestamp: data.timestamp ?? Date.now(),
      clanName: data.clanName,
      points: data.points ?? 0,
      place: data.place ?? 0,
      diamonds: data.diamonds ?? 0
    });
    return Number(result.lastInsertRowid);
  },

  savePlayerSnapshots(
    players: SavePlayerHistoryInput[],
    defaultClanName = '',
    defaultTimestamp = Date.now()
  ): number {
    if (!players.length) return 0;

    const insert = db.prepare(`
      INSERT INTO player_history(
        timestamp, clan_name, user_id, battle_id, points, diamonds
      ) VALUES(?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((rows: SavePlayerHistoryInput[]) => {
      let inserted = 0;
      for (const player of rows) {
        insert.run(
          player.timestamp ?? defaultTimestamp,
          player.clanName ?? defaultClanName,
          player.userId,
          player.battleId ?? '',
          player.points ?? 0,
          player.diamonds ?? 0
        );
        inserted++;
      }
      return inserted;
    });

    return transaction(players);
  },

  getClanHistory(clanName: string, since: number): ClanHistoryRow[] {
    const rows = db.prepare(`
      SELECT timestamp, points, place, diamonds
      FROM clan_history
      WHERE clan_name=? AND timestamp>=?
      ORDER BY timestamp ASC
    `).all(clanName, since) as Array<{ timestamp: number; points: number; place: number; diamonds: number }>;

    return rows.map((row) => ({
      timestamp: Number(row.timestamp),
      points: Number(row.points ?? 0),
      place: Number(row.place ?? 0),
      diamonds: Number(row.diamonds ?? 0)
    }));
  },

  getPlayerHistory(userId: number, since: number, battleId?: string): PlayerHistoryRow[] {
    const query = battleId
      ? db.prepare(`
          SELECT timestamp, points, diamonds, battle_id
          FROM player_history
          WHERE user_id=? AND timestamp>=? AND battle_id=?
          ORDER BY timestamp ASC
        `)
      : db.prepare(`
          SELECT timestamp, points, diamonds, battle_id
          FROM player_history
          WHERE user_id=? AND timestamp>=?
          ORDER BY timestamp ASC
        `);

    const rows = (battleId ? query.all(userId, since, battleId) : query.all(userId, since)) as Array<{
      timestamp: number;
      points: number;
      diamonds: number;
      battle_id: string;
    }>;

    return rows.map((row) => ({
      timestamp: Number(row.timestamp),
      points: Number(row.points ?? 0),
      diamonds: Number(row.diamonds ?? 0),
      battleId: String(row.battle_id ?? '')
    }));
  },

  get24hClanHistory(clanName: string): ClanHistoryRow[] {
    const rows = this.getClanHistory(clanName, Date.now() - 24 * 60 * 60 * 1000);
    // Jeśli brak wpisów z ostatnich 24h, pobierz ostatni znany snapshot, aby wykres nie był pusty
    if (!rows.length) {
      const latest = this.latestClan(clanName);
      return latest ? [latest] : [];
    }
    return rows;
  },

  get24hPlayerHistory(userId: number, battleId?: string): PlayerHistoryRow[] {
    const rows = this.getPlayerHistory(userId, Date.now() - 24 * 60 * 60 * 1000, battleId);
    if (!rows.length) {
      const latest = this.latestPlayer(userId);
      return latest ? [latest] : [];
    }
    return rows;
  },

  latestClan(clanName: string): ClanHistoryRow | null {
    const row = db.prepare(`
      SELECT timestamp, points, place, diamonds
      FROM clan_history
      WHERE clan_name=?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(clanName) as { timestamp: number; points: number; place: number; diamonds: number } | undefined;

    if (!row) return null;
    return {
      timestamp: Number(row.timestamp),
      points: Number(row.points ?? 0),
      place: Number(row.place ?? 0),
      diamonds: Number(row.diamonds ?? 0)
    };
  },

  latestPlayer(userId: number): PlayerHistoryRow | null {
    const row = db.prepare(`
      SELECT timestamp, points, diamonds, battle_id
      FROM player_history
      WHERE user_id=?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(userId) as { timestamp: number; points: number; diamonds: number; battle_id: string } | undefined;

    if (!row) return null;
    return {
      timestamp: Number(row.timestamp),
      points: Number(row.points ?? 0),
      diamonds: Number(row.diamonds ?? 0),
      battleId: String(row.battle_id ?? '')
    };
  }
};

export const snapshotRepo = {
  insertClan(clan: ClanRecord): number | null {
    const previous = db.prepare(`
      SELECT * FROM clan_snapshots
      WHERE clan_name=?
      ORDER BY captured_at DESC
      LIMIT 1
    `).get(clan.name) as Record<string, unknown> | undefined;

    const same = previous &&
      previous.battle_id === clan.battleId &&
      Number(previous.battle_points ?? 0) === clan.battlePoints &&
      previous.battle_place === clan.battlePlace &&
      Number(previous.member_count) === clan.members.length &&
      Number(previous.diamonds ?? 0) === clan.depositedDiamonds;

    if (!clan.battleId && same && clan.fetchedAt - Number(previous.captured_at) < 15 * 60_000) {
      return null;
    }

    const result = db.prepare(`
      INSERT INTO clan_snapshots(
        clan_name, battle_id, battle_points, battle_place, member_count, diamonds, captured_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?)
    `).run(
      clan.name,
      clan.battleId ?? null,
      clan.battlePoints ?? 0,
      clan.battlePlace ?? null,
      clan.members.length,
      clan.depositedDiamonds ?? 0,
      clan.fetchedAt ?? Date.now()
    );

    return Number(result.lastInsertRowid);
  },

  insertPlayers(clan: ClanRecord): number {
    const last = db.prepare(`
      SELECT battle_id, battle_points, captured_at
      FROM player_snapshots
      WHERE user_id=?
      ORDER BY captured_at DESC
      LIMIT 1
    `);
    const insert = db.prepare(`
      INSERT INTO player_snapshots(user_id, clan_name, battle_id, battle_points, captured_at)
      VALUES(?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      let inserted = 0;
      for (const member of clan.members) {
        const previous = last.get(member.userId) as Record<string, unknown> | undefined;
        const same = previous &&
          previous.battle_id === clan.battleId &&
          Number(previous.battle_points ?? 0) === member.battlePoints;

        if (!clan.battleId && same && clan.fetchedAt - Number(previous.captured_at) < 15 * 60_000) {
          continue;
        }

        insert.run(
          member.userId,
          clan.name,
          clan.battleId ?? null,
          member.battlePoints ?? 0,
          clan.fetchedAt ?? Date.now()
        );
        inserted++;
      }
      return inserted;
    });

    return transaction();
  },

  playerHistory(userId: number, since: number, battleId?: string | null): HistoryPoint[] {
    const query = battleId
      ? db.prepare(`
          SELECT captured_at AS ts, battle_points AS value
          FROM player_snapshots
          WHERE user_id=? AND captured_at>=? AND battle_id=?
          ORDER BY captured_at ASC
        `)
      : db.prepare(`
          SELECT captured_at AS ts, battle_points AS value
          FROM player_snapshots
          WHERE user_id=? AND captured_at>=?
          ORDER BY captured_at ASC
        `);

    const rows = (battleId ? query.all(userId, since, battleId) : query.all(userId, since)) as Array<{ ts: number; value: number }>;
    return rows.map((r) => ({ ts: Number(r.ts), value: Number(r.value ?? 0) }));
  },

  clanHistory(clan: string, since: number, battleId?: string | null): HistoryPoint[] {
    const query = battleId
      ? db.prepare(`
          SELECT captured_at AS ts, battle_points AS value
          FROM clan_snapshots
          WHERE clan_name=? AND captured_at>=? AND battle_id=?
          ORDER BY captured_at ASC
        `)
      : db.prepare(`
          SELECT captured_at AS ts, battle_points AS value
          FROM clan_snapshots
          WHERE clan_name=? AND captured_at>=?
          ORDER BY captured_at ASC
        `);

    const rows = (battleId ? query.all(clan, since, battleId) : query.all(clan, since)) as Array<{ ts: number; value: number }>;
    return rows.map((r) => ({ ts: Number(r.ts), value: Number(r.value ?? 0) }));
  },

  lastClanSnapshot(clan: string): Record<string, unknown> | null {
    const row = db.prepare(`
      SELECT * FROM clan_snapshots
      WHERE clan_name=?
      ORDER BY captured_at DESC
      LIMIT 1
    `).get(clan);
    return (row as Record<string, unknown>) ?? null;
  }
};

export const cacheRepo = {
  get(key: string): { value: unknown; fetchedAt: number; expiresAt: number } | null {
    const row = db.prepare(`
      SELECT body, fetched_at, expires_at
      FROM api_cache
      WHERE cache_key=?
    `).get(key) as { body: string; fetched_at: number; expires_at: number } | undefined;

    if (!row) return null;
    try {
      return {
        value: JSON.parse(row.body),
        fetchedAt: Number(row.fetched_at),
        expiresAt: Number(row.expires_at)
      };
    } catch (_err) {
      return null;
    }
  },

  set(key: string, value: unknown, ttlMs: number): void {
    const now = Date.now();
    db.prepare(`
      INSERT INTO api_cache(cache_key, body, fetched_at, expires_at)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        body=excluded.body,
        fetched_at=excluded.fetched_at,
        expires_at=excluded.expires_at
    `).run(key, JSON.stringify(value), now, now + ttlMs);
  },

  clear(): void {
    db.prepare('DELETE FROM api_cache').run();
  }
};