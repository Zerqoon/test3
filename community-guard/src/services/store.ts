import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
      PRAGMA user_version = 1;
    `);
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
      const day = dayKey(now);
      const dayXp = p.xp_day === day ? p.day_xp : 0;
      const gain = Math.min(
        amount,
        config.leveling.dailyCap - dayXp,
        xpForLevel(config.leveling.maxLevel) - p.xp,
      );
      if (gain <= 0) return null;
      const xp = p.xp + gain;
      recent.push({ hash, at: now });
      this.db
        .prepare(
          "UPDATE profiles SET xp=?,messages=messages+1,last_xp=?,xp_day=?,day_xp=?,recent_hashes=? WHERE guild_id=? AND user_id=?",
        )
        .run(
          xp,
          now,
          day,
          dayXp + gain,
          JSON.stringify(recent.slice(-40)),
          guild,
          user,
        );
      this.db
        .prepare("INSERT INTO receipts VALUES (?,?,?)")
        .run(`xp:${messageId}`, "{}", now);
      return {
        oldLevel: levelForXp(p.xp),
        newLevel: levelForXp(xp),
        gained: gain,
        xp,
      };
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
      const gain = Math.floor(reward * (p.boost_until > now ? 1.3 : 1));
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
        item.kind !== "title" || current === 0,
        "Ten tytuł już posiadasz.",
      );
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
      if (item.kind === "title") {
        this.db
          .prepare("UPDATE profiles SET title=? WHERE guild_id=? AND user_id=?")
          .run(itemId, guild, user);
        return { description: `Ustawiono tytuł ${item.label}.` };
      }
      const p = this.profile(guild, user);
      assert(
        p.boost_until <= now,
        "Eliksir już działa. Poczekaj na jego koniec.",
      );
      this.db
        .prepare(
          "UPDATE inventory SET quantity=quantity-1 WHERE guild_id=? AND user_id=? AND item_id=?",
        )
        .run(guild, user, itemId);
      this.db
        .prepare(
          "UPDATE profiles SET boost_until=? WHERE guild_id=? AND user_id=?",
        )
        .run(now + item.hours * 3600000, guild, user);
      return {
        description: `Eliksir aktywny przez ${item.hours} godz. Wypłaty +30%.`,
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
    })();
  }
  close() {
    this.db.close();
  }
}
