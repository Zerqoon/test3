import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { AuditLogEvent, ChannelType, Collection, PermissionsBitField, PermissionFlagsBits,
  type APIEmbed, type ButtonInteraction, type GuildAuditLogsEntry, type GuildMember, type Message,
  type MessageCreateOptions, type OverwriteData } from 'discord.js';
import { config } from '../src/core/config.js';
import { Store } from '../src/core/store.js';
import type { Context, MessageSnapshot } from '../src/core/types.js';
import { snapshotMessage } from '../src/core/messages.js';
import { LogService, embedCharacters } from '../src/services/logs.js';
import { AuditService } from '../src/services/audit.js';
import { formatAuditChanges } from '../src/services/audit-format.js';
import { MemberService, usernameReminderText } from '../src/services/members.js';
import { TicketService, ticketOverwrites, ticketPanel, applicationRequirements } from '../src/services/tickets.js';
import { captureTranscript, transcriptDocument } from '../src/services/transcripts.js';
import { GiveawayService, giveawayButtons } from '../src/services/giveaways.js';
import { maintain } from '../src/services/maintenance.js';

const GUILD = '1550000000000000100', ALICE = '1550000000000000101', BOB = '1550000000000000102',
  BOT = '1550000000000000103', STAFF = '1550000000000000104';
const avatar = () => 'https://cdn.discordapp.com/embed/avatars/0.png';
const json = <T>(value: T): T => (value && typeof value === 'object' && 'toJSON' in value ?
  (value as { toJSON(): T }).toJSON() : value);

function fixture() {
  const db = new Store(':memory:'); const settings = structuredClone(config); settings.logging.batchWindowMs = 0;
  const ctx = { db, config: settings, logger: pino({ level: 'silent' }), stopping: false,
    client: { user: { id: BOT }, users: { fetch: async () => ({ send: async () => {} }) } } } as unknown as Context;
  const members = new Collection<string, GuildMember>(); const channels = new Collection<string, ReturnType<typeof makeChannel>>();
  const sent: { channelId: string; payload: MessageCreateOptions }[] = [], roleAdds: string[] = [], deletes: string[] = [];
  let serial = 1550000000000100000n, failSend = false, failHistory = false, rolePosition = 1, failPermissions = false;
  function addMember(id: string, roles: string[] = [], bot = false, joined = Date.now() - 86400000) {
    const cache = new Collection(roles.map(role => [role, { id: role }]));
    const member = { id, joinedTimestamp: joined, displayName: id === ALICE ? 'Stormy' : 'GOAT Member', displayAvatarURL: avatar,
      user: { id, bot, username: `user_${id}`, displayName: 'GOAT Member', displayAvatarURL: avatar },
      roles: { cache, add: async (role: string) => { roleAdds.push(id); cache.set(role, { id: role }); return member; } }
    } as unknown as GuildMember;
    members.set(id, member); return member;
  }
  function makeChannel(id: string, name = 'test', type = ChannelType.GuildText, topic: string | null = null) {
    const messages = new Collection<string, Message>();
    const channel = { id, name, type, topic, overwrites: [] as OverwriteData[],
      isTextBased: () => type !== ChannelType.GuildCategory, isThread: () => false,
      permissionsFor: () => ({ has: () => true }),
      permissionOverwrites: { set: async (rows: OverwriteData[]) => {
        if (failPermissions) throw new Error('Permission update interrupted'); channel.overwrites = rows; return channel;
      } },
      setName: async (value: string) => { channel.name = value; return channel; },
      delete: async () => { deletes.push(id); channels.delete(id); return channel; },
      send: async (payload: MessageCreateOptions) => {
        if (failSend) throw new Error('Simulated REST interruption');
        sent.push({ channelId: id, payload }); const messageId = String(++serial);
        const rowComponents = (payload.components ?? []).map(row => {
          const value = json(row) as { components?: { custom_id?: string }[] };
          return { components: (value.components ?? []).map(component => ({ customId: component.custom_id })) };
        });
        const message = { id: messageId, guildId: GUILD, channelId: id, webhookId: null,
          createdTimestamp: Date.now(), editedTimestamp: null, content: payload.content ?? '',
          author: members.get(BOT)!.user, member: members.get(BOT), attachments: new Collection(), stickers: new Collection(),
          embeds: (payload.embeds ?? []).map(embed => ({ ...json(embed), toJSON: () => json(embed) })), components: rowComponents,
          edit: async (edited: MessageCreateOptions) => {
            if (edited.embeds) message.embeds = edited.embeds.map(embed => ({ ...json(embed), toJSON: () => json(embed) })) as unknown as Message['embeds'];
            if (edited.components) message.components = edited.components.map(row => {
              const value = json(row) as { components?: { custom_id?: string }[] };
              return { components: (value.components ?? []).map(component => ({ customId: component.custom_id })) };
            }) as unknown as Message['components'];
            return message;
          }
        } as unknown as Message;
        messages.set(messageId, message); return message;
      },
      messages: { fetch: async (arg: string | { before?: string; limit?: number }) => {
        if (typeof arg === 'string') {
          if (!messages.has(arg)) throw Object.assign(new Error('Unknown message'), { code: 10008 }); return messages.get(arg)!;
        }
        if (failHistory && name.startsWith('clan-')) throw new Error('History unavailable');
        const rows = [...messages.values()].filter(m => !arg.before || BigInt(m.id) < BigInt(arg.before))
          .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1).slice(0, arg.limit ?? 100);
        return new Collection(rows.map(m => [m.id, m]));
      }, delete: async (messageId: string) => { deletes.push(messageId); messages.delete(messageId); } },
      messageCache: messages
    };
    channels.set(id, channel); return channel;
  }
  const guild = { id: GUILD, name: 'GOAT Tests', channels: {
    fetch: async (id?: string) => {
      if (!id) return channels;
      if (!channels.has(id)) throw Object.assign(new Error('Unknown channel'), { code: 10003 }); return channels.get(id)!;
    },
    create: async (options: { name: string; type: ChannelType; topic?: string; permissionOverwrites: OverwriteData[] }) => {
      const channel = makeChannel(String(++serial), options.name, options.type, options.topic ?? null);
      channel.overwrites = options.permissionOverwrites; return channel;
    }
  }, roles: { fetch: async (id: string) => ({ id, managed: false }) }, members: {
    cache: members, fetchMe: async () => ({ permissions: { has: () => true }, roles: { highest: { comparePositionTo: () => rolePosition } } }),
    fetch: async (arg?: string | { user: string; force?: boolean }) => {
      if (!arg) return members;
      const id = typeof arg === 'string' ? arg : arg.user;
      if (!members.has(id)) throw Object.assign(new Error('Unknown member'), { code: 10007 }); return members.get(id)!;
    }
  } };
  ctx.guild = guild as unknown as Context['guild'];
  addMember(ALICE); addMember(BOB); addMember(BOT, [], true); addMember(STAFF, [settings.access.staffRoleIds[0]]);
  addMember(settings.access.ownerUserIds[0]);
  for (const id of [settings.channels.logs, settings.channels.usernames, settings.tickets.logChannelId, settings.tickets.panelChannelId]) makeChannel(id);
  ctx.logs = new LogService(ctx); ctx.members = new MemberService(ctx); ctx.tickets = new TicketService(ctx);
  ctx.audit = new AuditService(ctx); ctx.giveaways = new GiveawayService(ctx);
  function interaction(userId = ALICE, channelId = settings.tickets.panelChannelId, messageId = db.meta('ticket_panel_message_id')) {
    const replies: unknown[] = [];
    return { user: { id: userId }, guild: ctx.guild, channelId, message: { id: messageId }, replies,
      deferReply: async () => {}, editReply: async (payload: unknown) => { replies.push(payload); },
      reply: async (payload: unknown) => { replies.push(payload); }, showModal: async (payload: unknown) => { replies.push(payload); }
    } as unknown as ButtonInteraction;
  }
  function original(channelId: string, index: number, content = `Human message ${index}`) {
    return { id: String(1550000000001000000n + BigInt(index)), guildId: GUILD, channelId, webhookId: null,
      createdTimestamp: Date.now() - (1000 - index) * 1000, editedTimestamp: null, content,
      author: members.get(ALICE)!.user, member: members.get(ALICE), embeds: [], attachments: new Collection(), stickers: new Collection(), components: []
    } as unknown as Message;
  }
  return { ctx, members, channels, sent, deletes, roleAdds, interaction, original, addMember,
    setSendFailure: (value: boolean) => { failSend = value; }, setHistoryFailure: (value: boolean) => { failHistory = value; },
    setRolePosition: (value: number) => { rolePosition = value; }, setPermissionFailure: (value: boolean) => { failPermissions = value; } };
}

test('audit creation logs use names and permission labels, omitting default noise and JSON', () => {
  const result = formatAuditChanges(AuditLogEvent.ChannelCreate, [
    { key: 'name', new: 'apply' }, { key: 'type', new: ChannelType.GuildText },
    { key: 'permission_overwrites', new: [{ id: GUILD, type: 0, allow: '0', deny: String(PermissionFlagsBits.ViewChannel) },
      { id: ALICE, type: 1, allow: String(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages), deny: '0' }] },
    { key: 'nsfw', new: false }, { key: 'flags', new: 0 }, { key: 'rate_limit_per_user', new: 0 }
  ]);
  assert.deepEqual(result.fields.map(row => row.name), ['Name', 'Channel Type', 'Channel Access']);
  assert.equal(result.fields[1].value, 'Text channel'); assert.match(result.fields[2].value, /View Channel/);
  assert.match(result.fields[2].value, /Send Messages/); assert.doesNotMatch(result.details, /"allow"|"type"|"deny"|\[\{/);
});

test('large audit permission changes retain complete readable details in a bounded embed', () => {
  const result = formatAuditChanges(AuditLogEvent.ChannelCreate, [{ key: 'permission_overwrites', new:
    Array.from({ length: 40 }, (_, index) => ({ id: String(BigInt(ALICE) + BigInt(index)), type: 1,
      allow: String(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages), deny: '0' })) }]);
  assert.equal(result.overflow, true); assert.match(result.fields[0].value, /40 access rules/);
  assert.match(result.details, new RegExp(String(BigInt(ALICE) + 39n))); assert.ok(result.fields[0].value.length < 1024);
});

test('native audit logs supersede pending fallback logs and suppress routine bot role writes', () => {
  const f = fixture(); const now = Date.now();
  f.ctx.logs.enqueue({ embeds: [{ title: 'Fallback' }], correlation: { types: [AuditLogEvent.MemberRoleUpdate], targetId: ALICE, observedAt: now } });
  const entry = { id: '1550000000001234567', action: AuditLogEvent.MemberRoleUpdate, targetId: ALICE,
    executorId: BOT, createdTimestamp: now, reason: 'GOAT • Autorole', changes: [{ key: '$add', new: [{ id: f.ctx.config.autorole.roleId }] }],
    target: null, extra: null } as unknown as GuildAuditLogsEntry;
  f.ctx.audit.ingest(entry); assert.equal(f.ctx.logs.pending(), 0);
  f.ctx.audit.ingest({ ...entry, id: '1550000000001234568', executorId: STAFF, reason: 'Approved' } as GuildAuditLogsEntry);
  assert.equal(f.ctx.logs.pending(), 1); f.ctx.db.close();
});

test('log batches respect character limits and keep general and ticket destinations separate', async () => {
  const f = fixture();
  for (let index = 0; index < 5; index++) f.ctx.logs.enqueue({ embeds: [{ title: `Event ${index}`, description: 'x'.repeat(1800) }] });
  f.ctx.logs.enqueue({ channelId: f.ctx.config.tickets.logChannelId, embeds: [{ title: 'Ticket only' }] });
  for (let index = 0; index < 5; index++) await f.ctx.logs.flush(Date.now() + 10000);
  assert.equal(f.ctx.logs.pending(), 0); assert.equal(f.sent.length, 3);
  for (const record of f.sent) assert.ok(embedCharacters((record.payload.embeds ?? []).map(embed => json(embed) as APIEmbed)) <= 5800);
  assert.equal(f.sent.at(-1)!.channelId, f.ctx.config.tickets.logChannelId); f.ctx.db.close();
});

test('failed log batches retain identical payload and nonce after a service restart', async () => {
  const f = fixture(); f.ctx.logs.enqueue({ embeds: [{ title: 'First' }] }, 'first');
  f.setSendFailure(true); await f.ctx.logs.flush();
  const frozen = f.ctx.db.get<{ payload: string; id: number }>('SELECT * FROM log_batches')!;
  f.ctx.logs.enqueue({ embeds: [{ title: 'Later' }] }, 'later'); f.setSendFailure(false);
  f.ctx.logs = new LogService(f.ctx); await f.ctx.logs.flush(Date.now() + 10000);
  assert.equal(f.ctx.db.get<{ payload: string }>('SELECT * FROM log_batches WHERE id=?', frozen.id)!.payload, frozen.payload);
  assert.equal(f.sent[0].payload.nonce, `goat-log-${frozen.id}`); assert.equal(f.sent[0].payload.embeds?.length, 1);
  assert.equal(f.ctx.logs.pending(), 1); await f.ctx.logs.flush(Date.now() + 10000); assert.equal(f.ctx.logs.pending(), 0); f.ctx.db.close();
});

test('GIF preview enrichment updates the queued event instead of adding another log', () => {
  const f = fixture(); f.ctx.logs.enqueueLatest({ embeds: [{ title: 'GIF' }] }, 'gif:message');
  f.ctx.logs.enqueueLatest({ embeds: [{ title: 'GIF', image: { url: 'https://example.com/a.gif' } }] }, 'gif:message');
  assert.equal(f.ctx.logs.pending(), 1); assert.match(f.ctx.db.get<{ payload: string }>('SELECT payload FROM log_outbox')!.payload, /a.gif/); f.ctx.db.close();
});

test('autorole backfill includes all humans, skips bots, and does not ping existing clan members', async () => {
  const f = fixture(); f.members.get(ALICE)!.roles.cache.set(f.ctx.config.usernameReminder.roleId, { id: f.ctx.config.usernameReminder.roleId } as never);
  const count = f.ctx.members.initialize(f.members.values()); assert.equal(count, 4);
  for (let index = 0; index < 5; index++) await f.ctx.members.tick();
  assert.equal(f.roleAdds.length, 4); assert.ok(!f.roleAdds.includes(BOT)); assert.equal(f.sent.length, 0);
  assert.equal(f.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM log_outbox")!.n, 1);
  assert.equal(f.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM member_arrivals WHERE eligible=1")!.n, 0); f.ctx.db.close();
});

test('autorole hierarchy errors remain queued and succeed when the role position is fixed', async () => {
  const f = fixture(); f.ctx.config.usernameReminder.enabled = false; f.ctx.members.onJoin(f.members.get(ALICE)!);
  f.setRolePosition(0); await f.ctx.members.tick(); assert.equal(f.roleAdds.length, 0);
  assert.equal(f.ctx.db.get<{ attempts: number }>('SELECT attempts FROM autorole_jobs')!.attempts, 1);
  f.setRolePosition(1); await f.ctx.members.tick(Date.now() + 10000); assert.equal(f.roleAdds.length, 1); f.ctx.db.close();
});

test('only a new clan member is pinged once and its deletion survives a service restart', async () => {
  const f = fixture(); f.ctx.config.autorole.enabled = false; f.ctx.members.initialize(f.members.values());
  const member = f.addMember(BOB, [], false, Date.now() + 1); f.ctx.members.onJoin(member); await f.ctx.members.tick();
  assert.equal(f.sent.length, 0); member.roles.cache.set(f.ctx.config.usernameReminder.roleId, { id: f.ctx.config.usernameReminder.roleId } as never);
  f.ctx.members.observe(member); await f.ctx.members.tick(); assert.equal(f.sent.length, 1);
  const payload = f.sent[0].payload; assert.equal(payload.content, usernameReminderText(BOB)); assert.deepEqual(payload.allowedMentions?.users, [BOB]);
  assert.deepEqual(payload.allowedMentions?.parse, []); assert.ok(String(payload.nonce).length <= 25);
  const pending = f.ctx.db.get<{ message_id: string; delete_at: number }>('SELECT * FROM temporary_messages')!;
  f.ctx.members = new MemberService(f.ctx); f.ctx.members.initialize(f.members.values()); f.ctx.members.observe(member);
  await f.ctx.members.tick(pending.delete_at - 1); assert.equal(f.deletes.length, 0);
  await f.ctx.members.tick(pending.delete_at); assert.deepEqual(f.deletes, [pending.message_id]); assert.equal(f.sent.length, 1); f.ctx.db.close();
});

test('lost clan roles postpone reminders until role eligibility returns', async () => {
  const f = fixture(); f.ctx.config.autorole.enabled = false;
  const member = f.addMember(BOB, [f.ctx.config.usernameReminder.roleId], false, Date.now() + 1); f.ctx.members.onJoin(member);
  member.roles.cache.clear(); await f.ctx.members.tick(); assert.equal(f.sent.length, 0);
  member.roles.cache.set(f.ctx.config.usernameReminder.roleId, { id: f.ctx.config.usernameReminder.roleId } as never);
  f.ctx.members.observe(member); await f.ctx.members.tick(); assert.equal(f.sent.length, 1); f.ctx.db.close();
});

test('ticket overwrites deny outsiders and grant only opener, invited members, staff and owner fallback', () => {
  const rows = ticketOverwrites(config, GUILD, BOT, ALICE, [BOB]);
  assert.ok(new PermissionsBitField(rows.find(row => row.id === GUILD)!.deny).has(PermissionFlagsBits.ViewChannel));
  assert.deepEqual(rows.map(row => String(row.id)).sort(), [GUILD, BOT, ALICE, BOB, ...config.access.staffRoleIds, ...config.access.ownerUserIds].sort());
  for (const id of [ALICE, BOB, ...config.access.ownerUserIds]) {
    const row = rows.find(value => value.id === id)!;
    assert.ok(new PermissionsBitField(row.allow).has(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages));
  }
  const closed = ticketOverwrites(config, GUILD, BOT, ALICE, [BOB], false);
  assert.ok(new PermissionsBitField(closed.find(row => row.id === ALICE)!.deny).has(PermissionFlagsBits.SendMessages));
});

test('ticket panel and application checklist include the supplied branding and four screenshots', () => {
  const panel = ticketPanel(); assert.deepEqual(panel.components[0].toJSON().components.map(component => 'label' in component ? component.label : ''), ['Clan Application', 'Support']);
  assert.equal(panel.embeds[0].toJSON().image?.url, 'attachment://goat-banner.png');
  const requirements = applicationRequirements().toJSON(); assert.equal(requirements.image?.url, 'attachment://application-mastery-example.png');
  for (const phrase of ['Mastery screenshot', 'Gamepasses screenshot', 'Inventory screenshot', 'Stats screenshot', '@username']) assert.ok(requirements.description?.includes(phrase));
  for (const id of [...config.access.staffRoleIds, ...config.access.ownerUserIds]) assert.ok(!JSON.stringify(panel).includes(id));
});

test('double ticket clicks create one private channel, retain the supplied image, and panel restart creates no duplicate', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel();
  await Promise.all([f.ctx.tickets.open(f.interaction(), 'application'), f.ctx.tickets.open(f.interaction(), 'application')]);
  const ticket = f.ctx.db.get<{ id: number; channel_id: string }>('SELECT * FROM tickets')!;
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM tickets')!.n, 1);
  const intro = f.sent.find(record => record.channelId === ticket.channel_id)!; assert.equal(intro.payload.embeds?.length, 2); assert.equal(intro.payload.files?.length, 2);
  assert.deepEqual(intro.payload.allowedMentions?.users, [ALICE]); const sends = f.sent.length;
  f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.ensurePanel(); assert.equal(f.sent.length, sends);
  assert.ok(f.channels.get(ticket.channel_id)!.overwrites.some(row => row.id === GUILD && row.deny === PermissionFlagsBits.ViewChannel)); f.ctx.db.close();
});

test('fresh staff checks reject role loss, retain owner fallback, and restrict invited users from claiming tickets', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.ctx.tickets.open(f.interaction(), 'support');
  const ticket = f.ctx.tickets.get(1); assert.equal(f.sent.find(record => record.channelId === ticket.channel_id)?.payload.embeds?.length, 1);
  await assert.rejects(f.ctx.tickets.button(f.interaction(BOB, ticket.channel_id!), 'claim', '1'), /restricted/);
  f.members.get(STAFF)!.roles.cache.clear(); await assert.rejects(f.ctx.tickets.button(f.interaction(STAFF, ticket.channel_id!), 'claim', '1'), /restricted/);
  await f.ctx.tickets.button(f.interaction(f.ctx.config.access.ownerUserIds[0], ticket.channel_id!), 'claim', '1');
  assert.equal(f.ctx.tickets.get(1).claimed_by, f.ctx.config.access.ownerUserIds[0]);
  await f.ctx.tickets.button(f.interaction(ALICE, ticket.channel_id!), 'close', '1'); f.ctx.db.close();
});

test('failed participant permission updates are repaired from durable desired state', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.ctx.tickets.open(f.interaction(), 'support'); const ticket = f.ctx.tickets.get(1);
  f.setPermissionFailure(true); await assert.rejects(f.ctx.tickets.participant(ticket.channel_id!, BOB, STAFF, false));
  assert.equal(f.ctx.tickets.get(1).permissions_dirty, 1); f.setPermissionFailure(false);
  await f.ctx.tickets.tick(); assert.equal(f.ctx.tickets.get(1).permissions_dirty, 0);
  assert.ok(f.channels.get(ticket.channel_id!)!.overwrites.some(row => row.id === BOB));
  await f.ctx.tickets.participant(ticket.channel_id!, BOB, STAFF, true); assert.ok(!f.channels.get(ticket.channel_id!)!.overwrites.some(row => row.id === BOB)); f.ctx.db.close();
});

test('transcripts paginate all messages, retain observed deletions, and escape untrusted HTML', async () => {
  const f = fixture(); const channel = f.channels.get(f.ctx.config.channels.usernames)!;
  for (let index = 1; index <= 205; index++) { const message = f.original(channel.id, index); channel.messageCache.set(message.id, message); }
  const removed = snapshotMessage(f.original(channel.id, 206, '<script>alert(1)</script>'));
  f.ctx.db.recordMessage(removed, 'live'); f.ctx.db.run('UPDATE messages SET deleted_at=? WHERE id=?', Date.now(), removed.id);
  const files = await captureTranscript(f.ctx, channel as unknown as Context['guild']['systemChannel'] & {}, 99, 'test');
  const html = Buffer.from(files[0].base64, 'base64').toString('utf8'); assert.equal((html.match(/<article>/g) ?? []).length, 206);
  assert.match(html, /Deleted after observation/); assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
  const attack = { ...removed, attachments: [{ id: '1', url: 'javascript:alert(1)', name: '<img onerror=alert(1)>', size: 1, contentType: null }] } as MessageSnapshot;
  const attackHtml = transcriptDocument('test', 'metadata', [attack]); assert.doesNotMatch(attackHtml, /href="javascript:|<img/); assert.match(attackHtml, /Content-Security-Policy/); f.ctx.db.close();
});

test('ticket close retries safely after transcript failure and delete waits for confirmed delivery', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.ctx.tickets.open(f.interaction(), 'application'); const ticket = f.ctx.tickets.get(1);
  f.setHistoryFailure(true); await assert.rejects(f.ctx.tickets.close(1, STAFF, 'Review completed'));
  assert.equal(f.ctx.tickets.get(1).state, 'closing'); assert.ok(f.channels.has(ticket.channel_id!));
  f.setHistoryFailure(false); f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.tick(); assert.equal(f.ctx.tickets.get(1).state, 'closed');
  await assert.rejects(f.ctx.tickets.button(f.interaction(STAFF, ticket.channel_id!), 'delete-confirm', '1'), /still being delivered/);
  for (let index = 0; index < 8; index++) await f.ctx.logs.flush(Date.now() + 10000);
  const keys = JSON.parse(f.ctx.tickets.get(1).transcript_key!) as string[]; assert.ok(keys.every(key => f.ctx.logs.delivered(key)));
  f.ctx.db.run('UPDATE log_outbox SET sent_at=?', Date.now() - 8 * 86400000); f.ctx.db.run('UPDATE log_batches SET sent_at=?', Date.now() - 8 * 86400000);
  maintain(f.ctx); assert.ok(keys.every(key => f.ctx.logs.delivered(key)), 'delivery receipts survive log payload retention');
  await f.ctx.tickets.button(f.interaction(STAFF, ticket.channel_id!), 'delete-confirm', '1'); assert.equal(f.ctx.tickets.get(1).state, 'deleted');
  assert.ok(f.deletes.includes(ticket.channel_id!)); f.ctx.db.close();
});

test('giveaways expose one public entry button and require fresh role membership', async () => {
  const f = fixture(); const now = Date.now(); const role = f.ctx.config.giveaways.defaultRoleId;
  f.ctx.db.run(`INSERT INTO giveaways(id,guild_id,channel_id,message_id,host_id,title,prize,description,role_id,winners,created_at,ends_at,duration_ms,state)
    VALUES('role-giveaway',?,?,?,?,'Prize','Robux','Good luck!',?,1,?,?,60000,'active')`, GUILD, f.ctx.config.channels.usernames, '1550000000000123456', ALICE, role, now, now + 60000);
  const button = giveawayButtons('role-giveaway', 0, true)[0].toJSON().components;
  assert.equal(button.length, 1); assert.match('label' in button[0] ? button[0].label! : '', /Enter Giveaway/);
  const interaction = f.interaction(BOB, f.ctx.config.channels.usernames, '1550000000000123456');
  await assert.rejects(f.ctx.giveaways.entry(interaction, 'role-giveaway', false));
  f.members.get(BOB)!.roles.cache.set(role, { id: role } as never); await f.ctx.giveaways.entry(interaction, 'role-giveaway', false);
  f.members.get(BOB)!.roles.cache.clear(); await assert.rejects(f.ctx.giveaways.entry(interaction, 'role-giveaway', false));
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM giveaway_entries')!.n, 1); f.ctx.db.close();
});

test('legacy database migration preserves activity totals while adding log and ticket structures', () => {
  const path = mkdtempSync(join(tmpdir(), 'goat-migration-')); const file = join(path, 'goat.sqlite');
  const db = new Store(file); const snapshot = { id: '1550000000000000999', guildId: GUILD, channelId: ALICE, authorId: ALICE,
    username: 'Stormy', displayName: 'Stormy', avatarUrl: avatar(), content: 'Observed', embeds: [], attachments: [], stickers: [], createdAt: Date.now(), editedAt: Date.now(), bot: false };
  db.recordMessage(snapshot, 'live'); db.run('ALTER TABLE log_outbox DROP COLUMN batch_id'); db.close();
  const migrated = new Store(file); assert.equal(migrated.count(GUILD, ALICE), 1);
  assert.ok(migrated.all<{ name: string }>('PRAGMA table_info(log_outbox)').some(column => column.name === 'batch_id'));
  assert.equal(migrated.meta('schema_version'), '2'); migrated.close(); rmSync(path, { recursive: true, force: true });
});
