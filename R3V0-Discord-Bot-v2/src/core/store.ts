import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MessageSnapshot } from './types.js';

export class Store {
  readonly sqlite: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path, { timeout: 5000 });
    this.sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, author_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, edited_at INTEGER NOT NULL, counted INTEGER NOT NULL,
        snapshot TEXT, deleted_at INTEGER, origin TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_author_time ON messages(guild_id,author_id,created_at) WHERE counted=1;
      CREATE INDEX IF NOT EXISTS messages_time ON messages(guild_id,created_at,author_id) WHERE counted=1;
      CREATE TABLE IF NOT EXISTS history_channels (
        channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, complete INTEGER NOT NULL DEFAULT 0,
        before_id TEXT, scan_head_id TEXT, checkpoint_id TEXT, imported INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0, error TEXT
      );
      CREATE TABLE IF NOT EXISTS username_archives (
        source_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, author_id TEXT NOT NULL, snapshot TEXT NOT NULL,
        published_id TEXT, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT, historical INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nickname_state (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, original_nickname TEXT, base_name TEXT NOT NULL,
        decorated_name TEXT NOT NULL, PRIMARY KEY(guild_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS log_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, dedupe_key TEXT UNIQUE, payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, sent_at INTEGER, error TEXT
      );
      CREATE INDEX IF NOT EXISTS log_pending ON log_outbox(status,next_attempt,id);
      CREATE TABLE IF NOT EXISTS audit_seen (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS giveaway_drafts (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
        winners INTEGER NOT NULL, min_messages INTEGER NOT NULL DEFAULT 0, period TEXT NOT NULL DEFAULT 'all',
        values_json TEXT, status TEXT NOT NULL DEFAULT 'draft', giveaway_id TEXT, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS giveaways (
        id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
        host_id TEXT NOT NULL, title TEXT NOT NULL, prize TEXT NOT NULL, description TEXT NOT NULL,
        role_id TEXT, winners INTEGER NOT NULL, min_messages INTEGER NOT NULL DEFAULT 0,
        period TEXT NOT NULL DEFAULT 'all', created_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'publishing', dirty INTEGER NOT NULL DEFAULT 0,
        last_update INTEGER NOT NULL DEFAULT 0, error TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
        ended_by TEXT, cancel_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS giveaway_entries (
        giveaway_id TEXT NOT NULL REFERENCES giveaways(id), user_id TEXT NOT NULL, joined_at INTEGER NOT NULL,
        PRIMARY KEY(giveaway_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS giveaway_draws (
        giveaway_id TEXT NOT NULL REFERENCES giveaways(id), round INTEGER NOT NULL,
        candidate_order TEXT NOT NULL, candidate_index INTEGER NOT NULL DEFAULT 0,
        winners_json TEXT NOT NULL DEFAULT '[]', complete INTEGER NOT NULL DEFAULT 0,
        announced_id TEXT, dm_done INTEGER NOT NULL DEFAULT 0, drawn_at INTEGER NOT NULL,
        PRIMARY KEY(giveaway_id,round)
      );
      CREATE TABLE IF NOT EXISTS moderation_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER, status TEXT NOT NULL DEFAULT 'pending',
        dm_status TEXT NOT NULL DEFAULT 'not_sent', audit_reason TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS giveaway_dms (
        giveaway_id TEXT NOT NULL, round INTEGER NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL,
        PRIMARY KEY(giveaway_id,round,user_id)
      );
    `);
    this.setMeta('schema_version', '1');
  }
  private statement(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) { s = this.sqlite.prepare(sql); this.statements.set(sql, s); }
    return s;
  }
  run(sql: string, ...args: SQLInputValue[]): ReturnType<StatementSync['run']> { return this.statement(sql).run(...args); }
  get<T>(sql: string, ...args: SQLInputValue[]): T | undefined { return this.statement(sql).get(...args) as T | undefined; }
  all<T>(sql: string, ...args: SQLInputValue[]): T[] { return this.statement(sql).all(...args) as T[]; }
  transaction<T>(fn: () => T): T {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.sqlite.exec('COMMIT'); return result; }
    catch (err) { this.sqlite.exec('ROLLBACK'); throw err; }
  }
  setMeta(key: string, value: string): void { this.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value); }
  meta(key: string): string | undefined { return this.get<{ value: string }>('SELECT value FROM meta WHERE key=?', key)?.value; }
  recordMessage(s: MessageSnapshot, origin: 'live' | 'history'): boolean {
    const inserted = this.run(`INSERT OR IGNORE INTO messages(id,guild_id,channel_id,author_id,created_at,edited_at,counted,snapshot,origin)
      VALUES(?,?,?,?,?,?,?,?,?)`, s.id, s.guildId, s.channelId, s.authorId, s.createdAt, s.editedAt, s.bot ? 0 : 1, JSON.stringify(s), origin).changes;
    if (!inserted) this.run(`UPDATE messages SET snapshot=?,edited_at=? WHERE id=? AND edited_at<? AND deleted_at IS NULL`, JSON.stringify(s), s.editedAt, s.id, s.editedAt);
    return !!inserted;
  }
  snapshot(id: string): MessageSnapshot | undefined {
    const row = this.get<{ snapshot: string | null }>('SELECT snapshot FROM messages WHERE id=?', id);
    return row?.snapshot ? JSON.parse(row.snapshot) as MessageSnapshot : undefined;
  }
  markDeleted(id: string): void { this.run('UPDATE messages SET deleted_at=COALESCE(deleted_at,?) WHERE id=?', Date.now(), id); }
  count(guildId: string, userId: string, start = 0, end = Date.now() + 1): number {
    return this.get<{ n: number }>('SELECT COUNT(*) n FROM messages WHERE guild_id=? AND author_id=? AND counted=1 AND created_at>=? AND created_at<?', guildId, userId, start, end)!.n;
  }
  leaderboard(guildId: string, start: number, offset = 0, limit = 10): { author_id: string; n: number }[] {
    return this.all('SELECT author_id,COUNT(*) n FROM messages WHERE guild_id=? AND counted=1 AND created_at>=? AND created_at<=? GROUP BY author_id ORDER BY n DESC,author_id LIMIT ? OFFSET ?', guildId, start, Date.now(), limit, offset);
  }
  close(): void { this.sqlite.close(); }
}
