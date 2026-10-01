import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomInt } from "node:crypto";
import { config, shop } from "../config.js";
import { assert } from "../utils/errors.js";
import { dayKey, duration } from "../utils/format.js";
import {
  isMeaningful,
  levelForXp,
  messageHash,
  normalizeMessage,
  xpForLevel,
} from "./levels.js";

export interface Profile {
  guild_id: string;
  user_id: string;
  name: string;
  active: number;
  xp: number;
  messages: number;
  balance: number;
  last_xp: number;
  xp_day: string;
  day_xp: number;
  recent_hashes: string;
  last_work: number;
  last_daily: number;
  streak: number;
  title: string;
  boost_until: number;
  text_xp: number;
  voice_xp: number;
  voice_seconds: number;
  day_base_xp: number;
  xp_fraction: number;
  xp_boost_multiplier: number;
  xp_boost_until: number;
}
export interface MessageSnapshot {
  id: string;
  guild_id: string;
  channel_id: string;
  user_id: string;
  name: string;
  avatar: string;
  content: string;
  attachments: string;
  timestamp: number;
}
export interface ModCase {
  id: number;
  guild_id: string;
  user_id: string;
  moderator_id: string;
  type: string;
  reason: string;
  created_at: number;
  active: number;
  points: number;
  expires_at: number;
  revoked_reason: string;
}
export interface Quarantine {
  guild_id: string;
  user_id: string;
  started_at: number;
  until_at: number;
  released_at: number;
  previous_roles: string;
}
export interface RobloxLink {
  guild_id: string;
  user_id: string;
  roblox_id: string;
  roblox_name: string;
  discord_name: string;
  nickname: string;
  verified_at: number;
}
export interface VerificationChallenge {
  guild_id: string;
  user_id: string;
  roblox_id: string;
  roblox_name: string;
  code: string;
  discord_name: string;
  expires_at: number;
  last_check: number;
}
export interface TempVoice {
  channel_id: string;
  guild_id: string;
  owner_id: string;
  created_at: number;
  panel_id: string;
  locked: number;
  hidden: number;
}
export interface LedgerEntry {
  id: number;
  delta: number;
  balance: number;
  reason: string;
  created_at: number;
}

export class Store {
  readonly db: Database.Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    const version = Number(this.db.pragma("user_version", { simple: true }));
    assert(
      version <= 2,
      "Baza pochodzi z nowszej wersji bota. Nie wolno jej obniżać.",
    );
    if (version === 1 && path !== ":memory:") {
      const folder = join(dirname(path), "backups");
      mkdirSync(folder, { recursive: true });
      this.db
        .prepare("VACUUM INTO ?")
        .run(join(folder, `before-v2-${Date.now()}.sqlite`));
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'Użytkownik', active INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0 CHECK(xp >= 0), messages INTEGER NOT NULL DEFAULT 0,
        balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0), last_xp INTEGER NOT NULL DEFAULT 0,
        xp_day TEXT NOT NULL DEFAULT '', day_xp INTEGER NOT NULL DEFAULT 0, recent_hashes TEXT NOT NULL DEFAULT '[]',
        last_work INTEGER NOT NULL DEFAULT 0, last_daily INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '', boost_until INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild_id, user_id));
      CREATE INDEX IF NOT EXISTS profile_xp ON profiles(guild_id, active, xp DESC);
      CREATE INDEX IF NOT EXISTS profile_balance ON profiles(guild_id, active, balance DESC);
      CREATE TABLE IF NOT EXISTS inventory (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, item_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity >= 0), PRIMARY KEY(guild_id,user_id,item_id));
      CREATE TABLE IF NOT EXISTS receipts (operation_id TEXT PRIMARY KEY, result TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, delta INTEGER NOT NULL, balance INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS ledger_user ON ledger(guild_id,user_id,id DESC);
      CREATE TABLE IF NOT EXISTS mod_cases (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL, type TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX IF NOT EXISTS cases_user ON mod_cases(guild_id,user_id,id DESC);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL, content TEXT NOT NULL, attachments TEXT NOT NULL, timestamp INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_time ON messages(timestamp);
      CREATE TABLE IF NOT EXISTS log_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rule_acceptances (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, version TEXT NOT NULL, accepted_at INTEGER NOT NULL, PRIMARY KEY(guild_id,user_id,version));
    `);
    this.db.transaction(() => {
      const add = (table: string, column: string, definition: string) => {
        const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as {
          name: string;
        }[];
        if (!cols.some((c) => c.name === column))
          this.db.exec(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
          );
      };
      for (const col of [
        "text_xp",
        "voice_xp",
        "voice_seconds",
        "day_base_xp",
        "xp_boost_until",
      ])
        add("profiles", col, "INTEGER NOT NULL DEFAULT 0");
      add("profiles", "xp_boost_multiplier", "REAL NOT NULL DEFAULT 1");
      add("profiles", "xp_fraction", "REAL NOT NULL DEFAULT 0");
      add("mod_cases", "points", "INTEGER NOT NULL DEFAULT 1");
      add("mod_cases", "expires_at", "INTEGER NOT NULL DEFAULT 0");
      add("mod_cases", "revoked_reason", "TEXT NOT NULL DEFAULT ''");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS quarantines (guild_id TEXT NOT NULL,user_id TEXT NOT NULL,started_at INTEGER NOT NULL,until_at INTEGER NOT NULL,released_at INTEGER NOT NULL DEFAULT 0,previous_roles TEXT NOT NULL DEFAULT '[]',PRIMARY KEY(guild_id,user_id));
        CREATE TABLE IF NOT EXISTS roblox_links (guild_id TEXT NOT NULL,user_id TEXT NOT NULL,roblox_id TEXT NOT NULL,roblox_name TEXT NOT NULL,discord_name TEXT NOT NULL,nickname TEXT NOT NULL,verified_at INTEGER NOT NULL,PRIMARY KEY(guild_id,user_id),UNIQUE(guild_id,roblox_id));
        CREATE TABLE IF NOT EXISTS verification_challenges (guild_id TEXT NOT NULL,user_id TEXT NOT NULL,roblox_id TEXT NOT NULL,roblox_name TEXT NOT NULL,code TEXT NOT NULL,discord_name TEXT NOT NULL,expires_at INTEGER NOT NULL,last_check INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild_id,user_id));
        CREATE TABLE IF NOT EXISTS temp_voice (channel_id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,owner_id TEXT NOT NULL,created_at INTEGER NOT NULL,panel_id TEXT NOT NULL DEFAULT '',locked INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,UNIQUE(guild_id,owner_id));
        CREATE TABLE IF NOT EXISTS voice_blocks (channel_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(channel_id,user_id));
        CREATE TABLE IF NOT EXISTS gif_approvals (url TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS curated_gifs (provider TEXT NOT NULL,id TEXT NOT NULL,label TEXT NOT NULL,url TEXT NOT NULL,moderator_id TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(provider,id));
        CREATE TABLE IF NOT EXISTS gif_denials (reference TEXT PRIMARY KEY,moderator_id TEXT NOT NULL,reason TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS quarantine_due ON quarantines(released_at,until_at);
      `);
      if (version < 2) {
        this.db.exec("UPDATE profiles SET text_xp=xp,day_base_xp=day_xp");
        this.db
          .prepare(
            "UPDATE mod_cases SET expires_at=created_at+? WHERE type='warn' AND expires_at=0",
          )
          .run(config.moderation.warnings.expiryDays * 86400000);
        // Refund the retired v1 shop exactly once, preserving XP, wallet and moderation history.
        for (const [item, price] of [
          ["odkrywca", 2500],
          ["kolekcjoner", 10000],
          ["legenda", 50000],
          ["wydajnosc", 1500],
        ] as const) {
          const rows = this.db
            .prepare("SELECT * FROM inventory WHERE item_id=? AND quantity>0")
            .all(item) as {
            guild_id: string;
            user_id: string;
            quantity: number;
          }[];
          for (const r of rows) {
            this.move(
              r.guild_id,
              r.user_id,
              price * r.quantity,
              `Zwrot za wycofany produkt: ${item}`,
              Date.now(),
            );
          }
          this.db.prepare("DELETE FROM inventory WHERE item_id=?").run(item);
        }
        this.db.exec("UPDATE profiles SET title='',boost_until=0");
      }
      this.db.pragma("user_version = 2");
    })();
  }
  profile(guild: string, user: string, name?: string): Profile {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO profiles(guild_id,user_id,name) VALUES (?,?,?)",
      )
      .run(guild, user, name ?? "Użytkownik");
    if (name)
      this.db
        .prepare("UPDATE profiles SET name=? WHERE guild_id=? AND user_id=?")
        .run(name, guild, user);
    return this.db
      .prepare("SELECT * FROM profiles WHERE guild_id=? AND user_id=?")
      .get(guild, user) as Profile;
  }
  member(guild: string, user: string, active: boolean, name?: string) {
    this.profile(guild, user, name);
    this.db
      .prepare("UPDATE profiles SET active=? WHERE guild_id=? AND user_id=?")
      .run(active ? 1 : 0, guild, user);
  }
  rank(guild: string, user: string, kind: "xp" | "balance" = "xp") {
    const p = this.profile(guild, user);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM profiles WHERE guild_id=? AND active=1 AND (${kind}>? OR (${kind}=? AND user_id<?))`,
      )
      .get(guild, p[kind], p[kind], user) as { n: number };
    return row.n + 1;
  }
  top(guild: string, kind: "xp" | "balance", limit = 10) {
    return this.db
      .prepare(
        `SELECT * FROM profiles WHERE guild_id=? AND active=1 ORDER BY ${kind} DESC,user_id ASC LIMIT ?`,
      )
      .all(guild, limit) as Profile[];
  }
  awardXp(
    guild: string,
    user: string,
    content: string,
    messageId: string,
    now: number,
    amount: number,
    roleMultiplier = 1,
  ) {
    if (!config.leveling.enabled || !isMeaningful(content)) return null;
    assert(
      Number.isSafeInteger(amount) && amount > 0,
      "Nieprawidłowa ilość XP.",
    );
    return this.db.transaction(() => {
      if (
        this.db
          .prepare("SELECT 1 FROM receipts WHERE operation_id=?")
          .get(`xp:${messageId}`)
      )
        return null;
      const p = this.profile(guild, user);
      if (this.isQuarantined(guild, user, now)) return null;
      if (
        now - p.last_xp < config.leveling.cooldownSeconds * 1000 ||
        levelForXp(p.xp) >= config.leveling.maxLevel
      )
        return null;
      const hash = messageHash(normalizeMessage(content));
      const recent = (
        JSON.parse(p.recent_hashes) as { hash: string; at: number }[]
      ).filter(
        (r) => now - r.at < config.leveling.duplicateWindowSeconds * 1000,
      );
      if (recent.some((r) => r.hash === hash)) return null;
      const result = this.gainXp(
        guild,
        user,
        amount,
        roleMultiplier,
        "text",
        now,
      );
      if (!result) return null;
      recent.push({ hash, at: now });
      this.db
        .prepare(
          "UPDATE profiles SET messages=messages+1,last_xp=?,recent_hashes=? WHERE guild_id=? AND user_id=?",
        )
        .run(now, JSON.stringify(recent.slice(-40)), guild, user);
      this.db
        .prepare("INSERT INTO receipts VALUES (?,?,?)")
        .run(`xp:${messageId}`, "{}", now);
      return result;
    })();
  }
  xpMultiplier(
    guild: string,
    user: string,
    roleMultiplier = 1,
    now = Date.now(),
  ) {
    const p = this.profile(guild, user);
    assert(
      roleMultiplier >= 1 && roleMultiplier <= 5,
      "Nieprawidłowy mnożnik roli.",
    );
    return (
      roleMultiplier * (p.xp_boost_until > now ? p.xp_boost_multiplier : 1)
    );
  }
  private gainXp(
    guild: string,
    user: string,
    amount: number,
    roleMultiplier: number,
    source: "text" | "voice",
    now: number,
  ) {
    const p = this.profile(guild, user);
    const day = dayKey(now);
    const baseUsed = p.xp_day === day ? p.day_base_xp : 0;
    const base = Math.min(amount, config.leveling.dailyCap - baseUsed);
    if (
      base <= 0 ||
      levelForXp(p.xp) >= config.leveling.maxLevel ||
      this.isQuarantined(guild, user, now)
    )
      return null;
    const multiplier = this.xpMultiplier(guild, user, roleMultiplier, now);
    const exact = base * multiplier + p.xp_fraction;
    const gain = Math.min(
      Math.floor(exact),
      xpForLevel(config.leveling.maxLevel) - p.xp,
    );
    const dayXp = p.xp_day === day ? p.day_xp : 0;
    const xp = p.xp + gain;
    this.db
      .prepare(
        `UPDATE profiles SET xp=?,${source}_xp=${source}_xp+?,xp_fraction=?,xp_day=?,day_xp=?,day_base_xp=? WHERE guild_id=? AND user_id=?`,
      )
      .run(
        xp,
        gain,
        exact - Math.floor(exact),
        day,
        dayXp + gain,
        baseUsed + base,
        guild,
        user,
      );
    return {
      oldLevel: levelForXp(p.xp),
      newLevel: levelForXp(xp),
      gained: gain,
      base,
      multiplier,
      xp,
    };
  }
  awardVoiceXp(
    guild: string,
    user: string,
    intervalId: string,
    now: number,
    amount: number,
    roleMultiplier = 1,
    seconds = config.leveling.voice.intervalSeconds,
  ) {
    assert(
      Number.isSafeInteger(amount) &&
        amount > 0 &&
        Number.isSafeInteger(seconds) &&
        seconds > 0 &&
        seconds <= 300,
      "Nieprawidłowa nagroda voice.",
    );
    if (
      !config.leveling.enabled ||
      !config.leveling.voice.enabled ||
      this.isQuarantined(guild, user, now)
    )
      return null;
    return this.db.transaction(() => {
      const id = `voice:${guild}:${user}:${intervalId}`;
      if (
        this.db.prepare("SELECT 1 FROM receipts WHERE operation_id=?").get(id)
      )
        return null;
      this.profile(guild, user);
      this.db
        .prepare(
          "UPDATE profiles SET voice_seconds=voice_seconds+? WHERE guild_id=? AND user_id=?",
        )
        .run(seconds, guild, user);
      const result = this.gainXp(
        guild,
        user,
        amount,
        roleMultiplier,
        "voice",
        now,
      );
      this.db.prepare("INSERT INTO receipts VALUES (?,?,?)").run(id, "{}", now);
      return result;
    })();
  }
  private operation<T>(id: string, now: number, fn: () => T): T {
    return this.db.transaction(() => {
      const old = this.db
        .prepare("SELECT result FROM receipts WHERE operation_id=?")
        .get(id) as { result: string } | undefined;
      if (old) return JSON.parse(old.result) as T;
      const result = fn();
      this.db
        .prepare("INSERT INTO receipts VALUES (?,?,?)")
        .run(id, JSON.stringify(result), now);
      return result;
    })();
  }
  private move(
    guild: string,
    user: string,
    delta: number,
    reason: string,
    now: number,
  ) {
    const p = this.profile(guild, user);
    const balance = p.balance + delta;
    assert(
      Number.isSafeInteger(delta) &&
        Number.isSafeInteger(balance) &&
        balance >= 0,
      "Nie masz wystarczającej ilości waluty.",
    );
    assert(
      balance <= config.economy.maxBalance,
      "Przekroczono maksymalne saldo konta.",
    );
    this.db
      .prepare("UPDATE profiles SET balance=? WHERE guild_id=? AND user_id=?")
      .run(balance, guild, user);
    this.db
      .prepare(
        "INSERT INTO ledger(guild_id,user_id,delta,balance,reason,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(guild, user, delta, balance, reason, now);
    return balance;
  }
  work(
    guild: string,
    user: string,
    id: string,
    now = Date.now(),
    reward = randomInt(config.economy.workMin, config.economy.workMax + 1),
  ) {
    return this.operation(id, now, () => {
      const p = this.profile(guild, user);
      const wait =
        config.economy.workCooldownMinutes * 60000 - (now - p.last_work);
      assert(
        p.last_work === 0 || wait <= 0,
        `Następna praca za ${duration(wait)}.`,
      );
      const gain = reward;
      const balance = this.move(guild, user, gain, "Wypłata za pracę", now);
      this.db
        .prepare(
          "UPDATE profiles SET last_work=? WHERE guild_id=? AND user_id=?",
        )
        .run(now, guild, user);
      return {
        gain,
        balance,
        next: now + config.economy.workCooldownMinutes * 60000,
      };
    });
  }
  daily(guild: string, user: string, id: string, now = Date.now()) {
    return this.operation(id, now, () => {
      const p = this.profile(guild, user);
      const age = now - p.last_daily;
      assert(
        p.last_daily === 0 || age >= 86400000,
        `Nagroda dzienna za ${duration(86400000 - age)}.`,
      );
      const streak =
        p.last_daily > 0 && age <= 172800000
          ? Math.min(config.economy.dailyMaxStreak, p.streak + 1)
          : 1;
      const gain =
        config.economy.dailyBase +
        (streak - 1) * config.economy.dailyStreakBonus;
      const balance = this.move(guild, user, gain, "Nagroda dzienna", now);
      this.db
        .prepare(
          "UPDATE profiles SET last_daily=?,streak=? WHERE guild_id=? AND user_id=?",
        )
        .run(now, streak, guild, user);
      return { gain, balance, streak, next: now + 86400000 };
    });
  }
  transfer(
    guild: string,
    from: string,
    to: string,
    amount: number,
    id: string,
    now = Date.now(),
  ) {
    assert(from !== to, "Nie możesz wysłać waluty do siebie.");
    assert(
      Number.isSafeInteger(amount) && amount >= 1 && amount <= 1e8,
      "Kwota: 1–100 000 000.",
    );
    return this.operation(id, now, () => {
      const fee = Math.ceil((amount * config.economy.transferTaxPercent) / 100);
      const balance = this.move(
        guild,
        from,
        -amount - fee,
        `Przelew do ${to}; opłata ${fee}`,
        now,
      );
      this.move(guild, to, amount, `Przelew od ${from}`, now);
      return { amount, fee, balance };
    });
  }
  inventory(guild: string, user: string) {
    return this.db
      .prepare(
        "SELECT item_id,quantity FROM inventory WHERE guild_id=? AND user_id=? AND quantity>0",
      )
      .all(guild, user) as { item_id: string; quantity: number }[];
  }
  buy(
    guild: string,
    user: string,
    itemId: string,
    id: string,
    now = Date.now(),
  ) {
    const item = shop.find((i) => i.id === itemId);
    assert(item, "Nie ma takiego produktu.");
    return this.operation(id, now, () => {
      const current =
        this.inventory(guild, user).find((i) => i.item_id === itemId)
          ?.quantity ?? 0;
      assert(
        item.kind === "xp_boost",
        "Sklep sprzedaje wyłącznie boostery XP.",
      );
      assert(current < 999, "Masz już 999 sztuk tego produktu.");
      const balance = this.move(
        guild,
        user,
        -item.price,
        `Zakup: ${item.name}`,
        now,
      );
      this.db
        .prepare(
          "INSERT INTO inventory VALUES (?,?,?,1) ON CONFLICT(guild_id,user_id,item_id) DO UPDATE SET quantity=quantity+1",
        )
        .run(guild, user, itemId);
      return { itemId, balance };
    });
  }
  use(
    guild: string,
    user: string,
    itemId: string,
    id: string,
    now = Date.now(),
  ) {
    const item = shop.find((i) => i.id === itemId);
    assert(item, "Nie ma takiego produktu.");
    return this.operation(id, now, () => {
      assert(
        this.inventory(guild, user).some(
          (i) => i.item_id === itemId && i.quantity > 0,
        ),
        "Nie posiadasz tego produktu.",
      );
      assert(item.kind === "xp_boost", "Ten produkt został wycofany.");
      const p = this.profile(guild, user);
      assert(
        p.xp_boost_until <= now,
        "Booster już działa. Poczekaj na jego koniec; nie tracisz drugiego produktu.",
      );
      this.db
        .prepare(
          "UPDATE inventory SET quantity=quantity-1 WHERE guild_id=? AND user_id=? AND item_id=?",
        )
        .run(guild, user, itemId);
      this.db
        .prepare(
          "UPDATE profiles SET xp_boost_until=?,xp_boost_multiplier=? WHERE guild_id=? AND user_id=?",
        )
        .run(now + item.minutes * 60000, item.multiplier, guild, user);
      return {
        description: `Booster **×${item.multiplier} XP** za pisanie i voice przez **${duration(item.minutes * 60000)}**. Łączy się z mnożnikiem ×1.5 roli Booster.`,
        until: now + item.minutes * 60000,
        multiplier: item.multiplier,
      };
    });
  }
  adjustMoney(
    guild: string,
    user: string,
    amount: number,
    id: string,
    reason: string,
    now = Date.now(),
  ) {
    assert(
      Number.isSafeInteger(amount) && Math.abs(amount) <= 1e8,
      "Zmiana salda musi być liczbą całkowitą w zakresie ±100 000 000.",
    );
    return this.operation(id, now, () => ({
      balance: this.move(guild, user, amount, reason, now),
    }));
  }
  setLevel(guild: string, user: string, level: number) {
    assert(
      Number.isInteger(level) &&
        level >= 0 &&
        level <= config.leveling.maxLevel,
      "Nieprawidłowy poziom.",
    );
    this.profile(guild, user);
    this.db
      .prepare("UPDATE profiles SET xp=? WHERE guild_id=? AND user_id=?")
      .run(xpForLevel(level), guild, user);
  }
  history(guild: string, user: string) {
    return this.db
      .prepare(
        "SELECT * FROM ledger WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 10",
      )
      .all(guild, user) as LedgerEntry[];
  }
  addCase(
    guild: string,
    user: string,
    moderator: string,
    type: string,
    reason: string,
  ) {
    const info = this.db
      .prepare(
        "INSERT INTO mod_cases(guild_id,user_id,moderator_id,type,reason,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(guild, user, moderator, type, reason, Date.now());
    return Number(info.lastInsertRowid);
  }
  cases(guild: string, user: string) {
    return this.db
      .prepare(
        "SELECT * FROM mod_cases WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 20",
      )
      .all(guild, user) as ModCase[];
  }
  revokeWarn(guild: string, caseId: number) {
    return (
      this.db
        .prepare(
          "UPDATE mod_cases SET active=0 WHERE guild_id=? AND id=? AND type='warn' AND active=1",
        )
        .run(guild, caseId).changes === 1
    );
  }
  warning(
    guild: string,
    user: string,
    moderator: string,
    reason: string,
    points: number,
    id: string,
    now = Date.now(),
  ) {
    assert(
      Number.isInteger(points) && points >= 1 && points <= 5,
      "Punkty ostrzeżenia: 1–5.",
    );
    return this.operation(`warn:${id}`, now, () => {
      const expires = now + config.moderation.warnings.expiryDays * 86400000;
      const r = this.db
        .prepare(
          "INSERT INTO mod_cases(guild_id,user_id,moderator_id,type,reason,created_at,points,expires_at) VALUES (?,?,?,'warn',?,?,?,?)",
        )
        .run(guild, user, moderator, reason, now, points, expires);
      return {
        id: Number(r.lastInsertRowid),
        points: this.warningPoints(guild, user, now),
        expires,
      };
    });
  }
  warningPoints(guild: string, user: string, now = Date.now()) {
    return (
      this.db
        .prepare(
          "SELECT COALESCE(SUM(points),0) AS n FROM mod_cases WHERE guild_id=? AND user_id=? AND type='warn' AND active=1 AND expires_at>?",
        )
        .get(guild, user, now) as { n: number }
    ).n;
  }
  quarantine(guild: string, user: string) {
    return this.db
      .prepare("SELECT * FROM quarantines WHERE guild_id=? AND user_id=?")
      .get(guild, user) as Quarantine | undefined;
  }
  isQuarantined(guild: string, user: string, now = Date.now()) {
    const q = this.quarantine(guild, user);
    return !!q && !q.released_at;
  }
  startQuarantine(
    guild: string,
    user: string,
    previousRoles: string[],
    now = Date.now(),
  ) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO quarantines(guild_id,user_id,started_at,until_at,previous_roles) VALUES (?,?,?,?,?)",
      )
      .run(
        guild,
        user,
        now,
        now + config.protection.quarantineHours * 3600000,
        JSON.stringify(previousRoles),
      );
    return this.quarantine(guild, user)!;
  }
  link(guild: string, user: string) {
    return this.db
      .prepare("SELECT * FROM roblox_links WHERE guild_id=? AND user_id=?")
      .get(guild, user) as RobloxLink | undefined;
  }
  challenge(guild: string, user: string) {
    return this.db
      .prepare(
        "SELECT * FROM verification_challenges WHERE guild_id=? AND user_id=?",
      )
      .get(guild, user) as VerificationChallenge | undefined;
  }
  completeVerification(
    challenge: VerificationChallenge,
    robloxName: string,
    nickname: string,
    now = Date.now(),
  ) {
    return this.db.transaction(() => {
      const current = this.challenge(challenge.guild_id, challenge.user_id);
      assert(
        current && current.code === challenge.code && current.expires_at > now,
        "Kod weryfikacji wygasł lub został zastąpiony.",
      );
      const existing = this.db
        .prepare(
          "SELECT user_id FROM roblox_links WHERE guild_id=? AND roblox_id=?",
        )
        .get(challenge.guild_id, challenge.roblox_id) as
        { user_id: string } | undefined;
      assert(
        !existing || existing.user_id === challenge.user_id,
        "To konto Roblox jest już przypisane do innej osoby na serwerze.",
      );
      this.db
        .prepare(
          "INSERT INTO roblox_links VALUES (?,?,?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET roblox_id=excluded.roblox_id,roblox_name=excluded.roblox_name,discord_name=excluded.discord_name,nickname=excluded.nickname,verified_at=excluded.verified_at",
        )
        .run(
          challenge.guild_id,
          challenge.user_id,
          challenge.roblox_id,
          robloxName,
          challenge.discord_name,
          nickname,
          now,
        );
      this.db
        .prepare(
          "DELETE FROM verification_challenges WHERE guild_id=? AND user_id=?",
        )
        .run(challenge.guild_id, challenge.user_id);
      return this.link(challenge.guild_id, challenge.user_id)!;
    })();
  }
  temporary(channel: string) {
    return this.db
      .prepare("SELECT * FROM temp_voice WHERE channel_id=?")
      .get(channel) as TempVoice | undefined;
  }
  cacheMessage(m: MessageSnapshot) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO messages VALUES (@id,@guild_id,@channel_id,@user_id,@name,@avatar,@content,@attachments,@timestamp)",
      )
      .run(m);
  }
  message(id: string) {
    return this.db.prepare("SELECT * FROM messages WHERE id=?").get(id) as
      MessageSnapshot | undefined;
  }
  deleteMessage(id: string) {
    this.db.prepare("DELETE FROM messages WHERE id=?").run(id);
  }
  enqueueLog(channelId: string, payload: unknown) {
    this.db
      .prepare(
        "INSERT INTO log_outbox(channel_id,payload,created_at) VALUES (?,?,?)",
      )
      .run(channelId, JSON.stringify(payload), Date.now());
  }
  setting(key: string) {
    return (
      this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as
        { value: string } | undefined
    )?.value;
  }
  setSetting(key: string, value: string) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES (?,?)")
      .run(key, value);
  }
  acceptRules(guild: string, user: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO rule_acceptances VALUES (?,?,?,?)")
      .run(guild, user, config.panels.rulesVersion, Date.now());
  }
  cleanup(now = Date.now()) {
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM messages WHERE timestamp<?")
        .run(now - config.retention.messageDays * 86400000);
      this.db
        .prepare(
          "DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY timestamp DESC LIMIT -1 OFFSET ?)",
        )
        .run(config.retention.maxMessages);
      this.db
        .prepare("DELETE FROM receipts WHERE created_at<?")
        .run(now - config.retention.logDays * 86400000);
      this.db
        .prepare("DELETE FROM ledger WHERE created_at<?")
        .run(now - config.retention.logDays * 86400000);
      this.db.prepare("DELETE FROM gif_approvals WHERE expires_at<?").run(now);
      this.db.prepare("DELETE FROM curated_gifs WHERE expires_at<?").run(now);
      this.db
        .prepare("DELETE FROM verification_challenges WHERE expires_at<?")
        .run(now);
    })();
  }
  close() {
    this.db.close();
  }
}
