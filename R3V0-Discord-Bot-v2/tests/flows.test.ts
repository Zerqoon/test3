import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, type EmbedBuilder, type Message, type ButtonInteraction } from 'discord.js';
import pino from 'pino';
import { config } from '../src/core/config.js';
import type { Context } from '../src/core/types.js';
import { Store } from '../src/core/store.js';
import { snapshotMessage } from '../src/core/messages.js';
import { LogService } from '../src/services/logs.js';
import { UsernameService } from '../src/services/usernames.js';
import { HistoryService } from '../src/services/history.js';
import { GiveawayService } from '../src/services/giveaways.js';
import { ModerationService } from '../src/services/moderation.js';

const GUILD = '1550000000000000010', CHANNEL = '1550000000000000011';
const ALICE = '1550000000000000021', BOB = '1550000000000000022', BOT = '1550000000000000023';
const ROLE = '1550000000000000055';
type Payload = { embeds?: EmbedBuilder[]; content?: string; allowedMentions?: { roles?: string[]; users?: string[] }; nonce?: string };

function fixture() {
  const db = new Store(':memory:'); const records: Payload[] = []; const deleted: string[] = []; const dms: string[] = []; const forced: string[] = [];
  const messages = new Map<string, Message>(); const membership = new Map<string, { eligible: boolean; bot: boolean }>([[ALICE, { eligible: true, bot: false }], [BOB, { eligible: false, bot: false }], [BOT, { eligible: true, bot: true }]]);
  let serial = 1550000000000010000n; let sendFails = false; let memberFails = false;
  const member = (id: string) => ({ id, user: { id, bot: membership.get(id)?.bot ?? false }, roles: { cache: new Collection(membership.get(id)?.eligible ? [[ROLE, { id: ROLE }]] : []) } });
  const channel = {
    id: CHANNEL, name: 'goat-test', isTextBased: () => true, isThread: () => false, permissionsFor: () => ({ has: () => true }),
    send: async (payload: Payload) => {
      if (sendFails) throw new Error('Simulated send failure');
      records.push(payload); const id = String(++serial);
      const m = { id, createdTimestamp: Date.now(), author: { id: BOT }, embeds: (payload.embeds ?? []).map(e => e.toJSON()),
        edit: async (p: Payload) => { (m as unknown as { embeds: ReturnType<EmbedBuilder['toJSON']>[] }).embeds = (p.embeds ?? []).map(e => e.toJSON()); return m; } } as unknown as Message;
      messages.set(id, m); return m;
    },
    messages: {
      fetch: async (arg: string | { before?: string; limit?: number }) => {
        if (typeof arg === 'string') { if (!messages.has(arg)) throw Object.assign(new Error('Unknown message'), { code: 10008 }); return messages.get(arg)!; }
        const rows = [...messages.values()].filter(m => !arg.before || BigInt(m.id) < BigInt(arg.before)).sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1).slice(0, arg.limit ?? 100);
        return new Collection(rows.map(m => [m.id, m]));
      },
      delete: async (id: string) => { deleted.push(id); messages.delete(id); }
    }
  };
  const guild = { id: GUILD, name: 'GOAT Test', memberCount: 3, channels: {
    fetch: async (id?: string) => id ? channel : new Collection([[CHANNEL, channel]]), fetchActiveThreads: async () => ({ threads: new Collection() }) },
    roles: { fetch: async (id: string) => ({ id, mentionable: true }) },
    members: { cache: new Collection(), fetchMe: async () => ({ permissions: { has: () => true } }), fetch: async (arg: string | { user: string; force?: boolean }) => {
      if (memberFails) throw new Error('Simulated REST interruption');
      const id = typeof arg === 'string' ? arg : arg.user; if (typeof arg !== 'string' && arg.force) forced.push(id);
      if (!membership.has(id)) throw Object.assign(new Error('Unknown member'), { code: 10007 }); return member(id);
    } }
  };
  const ctx = { db, guild, config: structuredClone(config), client: { user: { id: BOT }, users: { fetch: async (id: string) => ({ send: async () => { dms.push(id); } }) } },
    logger: pino({ level: 'silent' }), stopping: false } as unknown as Context;
  ctx.config.channels.usernames = CHANNEL; ctx.config.history.pageDelayMs = 0;
  ctx.config.logging.batchWindowMs = 0;
  ctx.logs = new LogService(ctx); ctx.usernames = new UsernameService(ctx); ctx.history = new HistoryService(ctx);
  ctx.giveaways = new GiveawayService(ctx); ctx.moderation = new ModerationService(ctx);
  return { ctx, channel, messages, records, deleted, dms, forced, membership,
    setSendFails: (v: boolean) => { sendFails = v; }, setMemberFails: (v: boolean) => { memberFails = v; } };
}
function original(id: string, age = 1000): Message {
  return { id, guildId: GUILD, channelId: CHANNEL, webhookId: null, content: 'roblox_account', createdTimestamp: Date.now() - age, editedTimestamp: null,
    member: { displayName: 'Stormy', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
    author: { id: ALICE, bot: false, username: 'xstormy.yt', displayName: 'Stormy', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
    embeds: [], attachments: new Collection(), stickers: new Collection() } as unknown as Message;
}
function seedGiveaway(f: ReturnType<typeof fixture>, state = 'active', id = 'testgive0001') {
  const now = Date.now();
  f.ctx.db.run(`INSERT INTO giveaways(id,guild_id,channel_id,message_id,host_id,title,prize,description,role_id,winners,created_at,ends_at,duration_ms,state)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, GUILD, CHANNEL, state === 'publishing' ? null : '1550000000000000300', ALICE, 'GOAT Test Giveaway', 'Roblox Prize', 'Good luck!', ROLE, 2, now - 1000, now - 1, 1000, state);
  if (state !== 'publishing') f.messages.set('1550000000000000300', { id: '1550000000000000300', createdTimestamp: now, author: { id: BOT }, embeds: [], edit: async () => {} } as unknown as Message);
  return id;
}

test('username worker copies upper nickname and captured content, then deletes source; retries never use edited input', async () => {
  const f = fixture(); const m = original('1550000000000000101'); const snap = snapshotMessage(m);
  f.messages.set(m.id, m); f.ctx.db.recordMessage(snap, 'live'); f.ctx.usernames.prepare(snap, false);
  f.setSendFails(true); await f.ctx.usernames.tick(); assert.equal(f.deleted.length, 0);
  f.setSendFails(false); f.ctx.db.run('UPDATE username_archives SET next_attempt=0');
  // A later edit must not alter the initial immutable archive snapshot.
  f.ctx.usernames.prepare({ ...snap, content: 'changed_by_author' }, false);
  await f.ctx.usernames.tick();
  assert.equal(f.records[0].embeds?.[0].data.title, 'Stormy'); assert.equal(f.records[0].embeds?.[0].data.description, 'roblox_account');
  assert.deepEqual(f.deleted, [m.id]); assert.equal(f.ctx.db.count(GUILD, ALICE), 1);
  assert.equal(f.ctx.db.get<{ state: string }>('SELECT state FROM username_archives')?.state, 'locked');
  f.ctx.db.close();
});
test('log delivery failure retains a durable queued log and applies retry backoff', async () => {
  const f = fixture(); f.ctx.logs.enqueue({ embeds: [{ title: 'GOAT test' }] }, 'once'); f.ctx.logs.enqueue({ embeds: [{ title: 'duplicate' }] }, 'once');
  f.setSendFails(true); await f.ctx.logs.flush();
  const row = f.ctx.db.get<{ attempts: number; status: string; next_attempt: number }>('SELECT * FROM log_outbox')!;
  assert.equal(row.attempts, 1); assert.equal(row.status, 'pending'); assert.ok(row.next_attempt > Date.now()); assert.equal(f.ctx.logs.pending(), 1); f.ctx.db.close();
});
test('history import resumes pagination after failure and never double counts an already indexed page', async () => {
  const f = fixture();
  for (let n = 1; n <= 205; n++) { const m = original(String(1550000000000020000n + BigInt(n)), (206 - n) * 1000); f.messages.set(m.id, m); }
  const originalFetch = f.channel.messages.fetch; let calls = 0;
  f.channel.messages.fetch = async arg => { if (++calls === 2) throw new Error('Interrupted page'); return originalFetch(arg); };
  await f.ctx.history.run(); assert.equal(f.ctx.db.count(GUILD, ALICE), 100); assert.equal(f.ctx.history.summary().pending, 1);
  f.channel.messages.fetch = originalFetch; await f.ctx.history.run(); assert.equal(f.ctx.db.count(GUILD, ALICE), 205); assert.equal(f.ctx.history.summary().pending, 0);
  await f.ctx.history.run(); assert.equal(f.ctx.db.count(GUILD, ALICE), 205); f.ctx.db.close();
});
test('publication pings only the selected role and starts the persisted duration at message creation', async () => {
  const f = fixture(); const id = seedGiveaway(f, 'publishing');
  await f.ctx.giveaways.tick(); const g = f.ctx.giveaways.get(id);
  assert.equal(f.records[0].content, `<@&${ROLE}>`); assert.deepEqual(f.records[0].allowedMentions?.roles, [ROLE]);
  assert.equal(g.state, 'active'); assert.equal(g.ends_at, f.messages.get(g.message_id!)!.createdTimestamp + 1000);
  assert.equal(f.records.length, 1); f.ctx.db.close();
});
test('giveaway entries are unique and role eligibility is fetched fresh; removal remains possible after role loss', async () => {
  const f = fixture(); const id = seedGiveaway(f); f.ctx.db.run('UPDATE giveaways SET ends_at=?', Date.now() + 60000);
  const i = { user: { id: ALICE }, message: { id: '1550000000000000300' }, deferReply: async () => {}, editReply: async () => {} } as unknown as ButtonInteraction;
  await f.ctx.giveaways.entry(i, id, false); await f.ctx.giveaways.entry(i, id, false);
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM giveaway_entries')?.n, 1);
  f.membership.set(ALICE, { eligible: false, bot: false }); await assert.rejects(f.ctx.giveaways.entry(i, id, false));
  await f.ctx.giveaways.entry(i, id, true); assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM giveaway_entries')?.n, 0);
  assert.ok(f.forced.includes(ALICE)); f.ctx.db.close();
});
test('interrupted draw resumes its saved candidate order, rejects lost roles / bots and announces winners once', async () => {
  const f = fixture(); const id = seedGiveaway(f);
  for (const user of [ALICE, BOB, BOT]) f.ctx.db.run('INSERT INTO giveaway_entries VALUES(?,?,?)', id, user, Date.now());
  f.ctx.db.run('INSERT INTO giveaway_draws(giveaway_id,round,candidate_order,drawn_at) VALUES(?,1,?,?)', id, JSON.stringify([BOB, BOT, ALICE]), Date.now());
  f.setMemberFails(true); await f.ctx.giveaways.tick();
  assert.equal(f.ctx.giveaways.get(id).state, 'ending');
  f.setMemberFails(false); f.ctx.db.run('UPDATE giveaways SET retry_at=0');
  // A fresh service instance simulates restart without changing the persistent draw.
  f.ctx.giveaways = new GiveawayService(f.ctx); await f.ctx.giveaways.tick();
  const draw = f.ctx.db.get<{ winners_json: string; complete: number }>('SELECT * FROM giveaway_draws')!;
  assert.deepEqual(JSON.parse(draw.winners_json), [ALICE]); assert.equal(draw.complete, 1); assert.equal(f.ctx.giveaways.get(id).state, 'ended');
  assert.deepEqual(f.dms, [ALICE]); assert.equal(f.records.length, 1);
  await f.ctx.giveaways.tick(); assert.equal(f.records.length, 1); assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM giveaway_draws')?.n, 1); f.ctx.db.close();
});
test('temporary unban refuses to remove a later external ban with a different reason marker', async () => {
  const f = fixture(); let removed = 0;
  Object.assign(f.ctx.guild, { bans: { fetch: async () => ({ reason: 'New ban from another moderator' }), remove: async () => { removed++; } } });
  f.ctx.db.run("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,created_at,expires_at,status,audit_reason) VALUES(?,?,?,'ban','Reason',?,?,'active','[GOAT#1] original')", GUILD, ALICE, BOB, Date.now() - 60000, Date.now() - 1000);
  await f.ctx.moderation.tick(); assert.equal(removed, 0); assert.equal(f.ctx.db.get<{ status: string }>('SELECT status FROM moderation_cases')?.status, 'superseded'); f.ctx.db.close();
});
test('a ban applied immediately before a crash is recovered from its unique case marker', async () => {
  const f = fixture();
  Object.assign(f.ctx.guild, { bans: { fetch: async () => ({ reason: '[GOAT#1] original' }), remove: async () => { throw new Error('Not due'); } } });
  f.ctx.db.run("INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,created_at,expires_at,status,audit_reason) VALUES(?,?,?,'ban','Reason',?,?,'pending','[GOAT#1] original')", GUILD, ALICE, BOB, Date.now() - 60000, Date.now() + 60000);
  await f.ctx.moderation.tick(); assert.equal(f.ctx.db.get<{ status: string }>('SELECT status FROM moderation_cases')?.status, 'active'); f.ctx.db.close();
});
