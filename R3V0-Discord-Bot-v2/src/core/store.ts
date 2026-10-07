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
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS log_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL, payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
        sent_at INTEGER, message_id TEXT, error TEXT
      );
      CREATE TABLE IF NOT EXISTS log_receipts (
        dedupe_key TEXT PRIMARY KEY, message_id TEXT, sent_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS member_arrivals (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at INTEGER NOT NULL,
        eligible INTEGER NOT NULL DEFAULT 0, reminder_state TEXT NOT NULL DEFAULT 'waiting',
        requested_at INTEGER, message_id TEXT, retry_at INTEGER NOT NULL DEFAULT 0, error TEXT,
        PRIMARY KEY(guild_id,user_id,joined_at)
      );
      CREATE TABLE IF NOT EXISTS autorole_jobs (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, error TEXT,
        PRIMARY KEY(guild_id,user_id,role_id)
      );
      CREATE TABLE IF NOT EXISTS temporary_messages (
        message_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, delete_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', retry_at INTEGER NOT NULL DEFAULT 0, error TEXT
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL,
        kind TEXT NOT NULL, channel_id TEXT UNIQUE, opening_message_id TEXT, state TEXT NOT NULL DEFAULT 'creating',
        claimed_by TEXT, created_at INTEGER NOT NULL, closed_at INTEGER, closed_by TEXT,
        close_reason TEXT, revision INTEGER NOT NULL DEFAULT 0, transcript_key TEXT,
        retry_at INTEGER NOT NULL DEFAULT 0, permissions_dirty INTEGER NOT NULL DEFAULT 0, error TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_ticket ON tickets(guild_id,owner_id,kind)
        WHERE state IN ('creating','open','closing','reopening');
      CREATE TABLE IF NOT EXISTS ticket_participants (
        ticket_id INTEGER NOT NULL REFERENCES tickets(id), user_id TEXT NOT NULL, added_by TEXT NOT NULL,
        PRIMARY KEY(ticket_id,user_id)
      );
    `);
    const logColumns = this.sqlite.prepare('PRAGMA table_info(log_outbox)').all() as { name: string }[];
    if (!logColumns.some(column => column.name === 'batch_id')) this.sqlite.exec('ALTER TABLE log_outbox ADD COLUMN batch_id INTEGER');
    const ticketColumns = this.sqlite.prepare('PRAGMA table_info(tickets)').all() as { name: string }[];
    if (!ticketColumns.some(column => column.name === 'permissions_dirty')) this.sqlite.exec('ALTER TABLE tickets ADD COLUMN permissions_dirty INTEGER NOT NULL DEFAULT 0');
    this.sqlite.exec("INSERT OR IGNORE INTO log_receipts(dedupe_key,message_id,sent_at) SELECT o.dedupe_key,b.message_id,o.sent_at FROM log_outbox o LEFT JOIN log_batches b ON b.id=o.batch_id WHERE o.status='sent' AND o.dedupe_key LIKE 'ticket-transcript:%'");
    if (!ticketColumns.some(column => column.name === 'embed_dirty')) this.sqlite.exec('ALTER TABLE tickets ADD COLUMN embed_dirty INTEGER NOT NULL DEFAULT 0');
    for (const name of ['roblox_username', 'owner_name']) {
      if (!ticketColumns.some(column => column.name === name)) this.sqlite.exec(`ALTER TABLE tickets ADD COLUMN ${name} TEXT`);
    }
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ticket_requests (
        id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL,
        panel_message_id TEXT NOT NULL, expires_at INTEGER NOT NULL, ticket_id INTEGER REFERENCES tickets(id)
      );
      CREATE INDEX IF NOT EXISTS ticket_owner_time ON tickets(guild_id,owner_id,created_at);
      CREATE TABLE IF NOT EXISTS ticket_reviews (
        ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id), channel_id TEXT NOT NULL, message_id TEXT,
        state TEXT NOT NULL DEFAULT 'voting', ends_at INTEGER NOT NULL, minimum_votes INTEGER NOT NULL,
        voter_roles TEXT NOT NULL DEFAULT '[]', decision TEXT, decided_by TEXT, decided_at INTEGER,
        reason TEXT, yes_count INTEGER NOT NULL DEFAULT 0, no_count INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 1, last_update INTEGER NOT NULL DEFAULT 0,
        dm_status TEXT NOT NULL DEFAULT 'pending', dm_attempts INTEGER NOT NULL DEFAULT 0,
        retry_at INTEGER NOT NULL DEFAULT 0, error TEXT
      );
      CREATE TABLE IF NOT EXISTS ticket_votes (
        ticket_id INTEGER NOT NULL REFERENCES tickets(id), user_id TEXT NOT NULL,
        choice TEXT NOT NULL CHECK(choice IN ('yes','no')), voted_at INTEGER NOT NULL,
        PRIMARY KEY(ticket_id,user_id)
      );
    `);
    this.setMeta('schema_version', '3');
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
