import test from 'node:test';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLogEvent, ChannelType, PermissionsBitField, PermissionFlagsBits,
  type APIEmbed, type GuildAuditLogsEntry, type Message,
  type ModalSubmitInteraction } from 'discord.js';
import { config } from '../src/core/config.js';
import { Store } from '../src/core/store.js';
import type { Context } from '../src/core/types.js';
import { snapshotMessage } from '../src/core/messages.js';
import { LogService, embedCharacters } from '../src/services/logs.js';
import { formatAuditChanges } from '../src/services/audit-format.js';
import { MemberService, usernameReminderText } from '../src/services/members.js';
import { TicketService, ticketOverwrites, ticketPanel, applicationRequirements, normalizeRobloxUsername } from '../src/services/tickets.js';
import { captureTranscript, transcriptDocument } from '../src/services/transcripts.js';
import { giveawayButtons } from '../src/services/giveaways.js';
import { majorityDecision, type TicketReview } from '../src/services/ticket-votes.js';
import { installEvents } from '../src/events/install.js';
import { VERSION } from '../src/core/version.js';
import { maintain } from '../src/services/maintenance.js';
import { routeInteraction } from '../src/commands/router.js';
import { commandDefinitions } from '../src/commands/definitions.js';
import { EmbedService, customEmbedPayload } from '../src/services/custom-embeds.js';

import { fixture, GUILD, ALICE, BOB, BOT, STAFF, avatar, json } from './harness.js';

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
  assert.equal(f.sent.filter(record => record.channelId === f.ctx.config.tickets.logChannelId).length, 1); f.ctx.db.close();
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
  assert.equal(panel.embeds[0].toJSON().thumbnail?.url, 'attachment://goat-banner.png');
  const requirements = applicationRequirements().toJSON(); assert.equal(requirements.image?.url, 'attachment://application-mastery-example.png');
  for (const phrase of ['Mastery', 'Gamepasses', 'Inventory', 'Stats', '@username']) assert.ok(requirements.description?.includes(phrase));
  for (const id of [...config.access.staffRoleIds, ...config.access.ownerUserIds]) assert.ok(!JSON.stringify(panel).includes(id));
});

test('double ticket clicks create one private channel, retain the supplied image, and panel restart creates no duplicate', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel();
  const request = await f.form('application');
  await Promise.all([f.ctx.tickets.openModal(request.modal, request.requestId), f.ctx.tickets.openModal(request.modal, request.requestId)]);
  const ticket = f.ctx.db.get<{ id: number; channel_id: string }>('SELECT * FROM tickets')!;
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM tickets')!.n, 1);
  const intro = f.sent.find(record => record.channelId === ticket.channel_id)!; assert.equal(intro.payload.embeds?.length, 1); assert.equal(intro.payload.files?.length, 1);
  assert.deepEqual(intro.payload.allowedMentions?.users, [ALICE]); const sends = f.sent.length;
  f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.ensurePanel(); assert.equal(f.sent.length, sends);
  assert.ok(f.channels.get(ticket.channel_id)!.overwrites.some(row => row.id === GUILD && row.deny === PermissionFlagsBits.ViewChannel)); f.ctx.db.close();
});

test('fresh staff checks reject role loss, retain owner fallback, and restrict invited users from claiming tickets', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.openTicket('support');
  const ticket = f.ctx.tickets.get(1); assert.equal(f.sent.find(record => record.channelId === ticket.channel_id)?.payload.embeds?.length, 1);
  await assert.rejects(f.ctx.tickets.button(f.interaction(BOB, ticket.channel_id!), 'claim', '1'), /restricted/);
  f.members.get(STAFF)!.roles.cache.clear(); await assert.rejects(f.ctx.tickets.button(f.interaction(STAFF, ticket.channel_id!), 'claim', '1'), /restricted/);
  await f.ctx.tickets.button(f.interaction(f.ctx.config.access.ownerUserIds[0], ticket.channel_id!), 'claim', '1');
  assert.equal(f.ctx.tickets.get(1).claimed_by, f.ctx.config.access.ownerUserIds[0]);
  await f.ctx.tickets.button(f.interaction(ALICE, ticket.channel_id!), 'close', '1'); f.ctx.db.close();
});

test('failed participant permission updates are repaired from durable desired state', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.openTicket('support'); const ticket = f.ctx.tickets.get(1);
  f.setPermissionFailure(true); await assert.rejects(f.ctx.tickets.participant(ticket.channel_id!, BOB, STAFF, false));
  assert.equal(f.ctx.tickets.get(1).permissions_dirty, 1); f.setPermissionFailure(false);
  await f.ctx.tickets.tick(); assert.equal(f.ctx.tickets.get(1).permissions_dirty, 0);
  assert.ok(f.channels.get(ticket.channel_id!)!.overwrites.some(row => row.id === BOB));
  await f.ctx.tickets.participant(ticket.channel_id!, BOB, STAFF, true); assert.ok(!f.channels.get(ticket.channel_id!)!.overwrites.some(row => row.id === BOB)); f.ctx.db.close();
});

test('plain text conversations paginate all messages and preserve observed deletions and exact user content', async () => {
  const f = fixture(); const channel = f.channels.get(f.ctx.config.channels.usernames)!;
  for (let index = 1; index <= 205; index++) { const message = f.original(channel.id, index); channel.messageCache.set(message.id, message); }
  const removed = snapshotMessage(f.original(channel.id, 206, '<script>alert(1)</script>'));
  f.ctx.db.recordMessage(removed, 'live'); f.ctx.db.run('UPDATE messages SET deleted_at=? WHERE id=?', Date.now(), removed.id);
  const files = await captureTranscript(f.ctx, channel as unknown as Context['guild']['systemChannel'] & {}, 99, 'test');
  const text = Buffer.from(files[0].base64, 'base64').toString('utf8'); assert.equal((text.match(/User ID:/g) ?? []).length, 206);
  assert.ok(files.every(file => file.name.endsWith('.txt'))); assert.match(text, /Deleted after observation/);
  assert.match(text, /<script>alert\(1\)<\/script>/); assert.doesNotMatch(text, /<!doctype html>/);
  const document = transcriptDocument('GOAT Ticket', 'metadata', [removed]); assert.match(document, /@user_/); f.ctx.db.close();
});

test('ticket close retries safely after transcript failure and delete waits for confirmed delivery', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.openTicket('application'); const ticket = f.ctx.tickets.get(1);
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
  assert.equal(migrated.meta('schema_version'), '6'); migrated.close(); rmSync(path, { recursive: true, force: true });
});

test('Roblox form requires a real username shape and cannot create a channel before submission', async () => {
  for (const input of [' ab ', 'display name', '@_Stormy', 'Stormy_', 'a__b', 'a'.repeat(21), '<@123>']) assert.throws(() => normalizeRobloxUsername(input));
  assert.equal(normalizeRobloxUsername(' @Stormy_123 '), 'Stormy_123');
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const form = await f.form('application');
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM tickets')!.n, 0);
  assert.ok(![...f.channels.values()].some(channel => channel.name.startsWith('clan-')));
  const impostor = Object.assign(f.interaction(BOB), { fields: { getTextInputValue: () => 'ValidName' } }) as unknown as ModalSubmitInteraction;
  await assert.rejects(f.ctx.tickets.openModal(impostor, form.requestId), /expired/);
  await f.ctx.tickets.openModal(form.modal, form.requestId); assert.equal(f.ctx.tickets.get(1).roblox_username, 'Stormy_123');
  assert.equal(f.ctx.tickets.get(1).owner_name, 'Stormy'); f.ctx.db.close();
});

test('tickets enforce one active ticket across categories, reject rapid forms and retain cooldown after restart', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const request = await f.form('support');
  await assert.rejects(f.ctx.tickets.open(f.interaction(), 'application'), /few seconds/);
  await f.ctx.tickets.openModal(request.modal, request.requestId);
  await f.ctx.tickets.open(f.interaction(), 'application'); assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM tickets')!.n, 1);
  await f.ctx.tickets.close(1, STAFF, 'Complete'); f.ctx.tickets = new TicketService(f.ctx);
  await assert.rejects(f.ctx.tickets.open(f.interaction(), 'support'), /Wait/);
  assert.equal(f.ctx.tickets.get(1).state, 'closed'); f.ctx.db.close();
});

test('expired forms, invalid usernames and departed applicants cannot create tickets', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const request = await f.form('application', ALICE, 'Fake Display Name');
  await assert.rejects(f.ctx.tickets.openModal(request.modal, request.requestId), /@username/);
  f.ctx.db.run('UPDATE ticket_requests SET expires_at=0'); await assert.rejects(f.ctx.tickets.openModal(request.modal, request.requestId), /expired/);
  const second = await f.form('support', BOB); f.members.delete(BOB); await assert.rejects(f.ctx.tickets.openModal(second.modal, second.requestId), /Unknown member/);
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM tickets')!.n, 0); f.ctx.db.close();
});

test('hourly and server-wide ticket limits are checked before channel creation', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); f.ctx.config.tickets.maxOpenTickets = 1;
  await f.openTicket('support'); await assert.rejects(f.ctx.tickets.open(f.interaction(BOB), 'support'), /queue is full/);
  await f.ctx.tickets.close(1, STAFF, 'Complete'); f.ctx.config.tickets.cooldownSeconds = 0; f.ctx.config.tickets.maxTicketsPerHour = 1;
  await assert.rejects(f.ctx.tickets.open(f.interaction(), 'application'), /hourly/); f.ctx.db.close();
});

test('application ballots are published on the requested channel with the applicant nickname; support has no ballot', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.openTicket('application'); await f.startVote(); await f.ctx.tickets.votes.tick();
  const review = f.ctx.tickets.votes.get(1)!; assert.equal(review.channel_id, '1557433699572777000'); assert.ok(review.message_id);
  const message = f.sent.find(record => record.channelId === review.channel_id)!; const embed = json(message.payload.embeds![0]) as APIEmbed;
  assert.match(embed.title!, /Stormy/); assert.match(embed.description!, /@Stormy_123/);
  const row = json(message.payload.components![0]) as { components: { label: string }[] };
  assert.deepEqual(row.components.map(button => button.label), ['Vote Yes', 'Vote No']);
  assert.ok(!JSON.stringify(message.payload).includes(f.ctx.config.access.staffRoleIds[0]));
  await f.openTicket('support', BOB, 'OtherPlayer'); assert.equal(f.ctx.tickets.votes.get(2), undefined); f.ctx.db.close();
});

test('votes persist once per member, can be changed, and never close early on the first click', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.openTicket('application'); await f.startVote(); await f.ctx.tickets.votes.tick();
  await assert.rejects(f.ctx.tickets.votes.vote(f.voteInteraction(ALICE), 1, 'yes'), /own application/);
  await assert.rejects(f.ctx.tickets.votes.vote(f.voteInteraction(BOT), 1, 'yes'), /Bots/);
  await f.ctx.tickets.votes.vote(f.voteInteraction(BOB), 1, 'yes'); await f.ctx.tickets.votes.vote(f.voteInteraction(BOB), 1, 'yes');
  assert.equal(f.ctx.tickets.votes.get(1)!.yes_count, 1); assert.equal(f.ctx.tickets.get(1).state, 'open');
  await f.ctx.tickets.votes.vote(f.voteInteraction(BOB), 1, 'no');
  assert.equal(f.ctx.tickets.votes.get(1)!.yes_count, 0); assert.equal(f.ctx.tickets.votes.get(1)!.no_count, 1);
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM ticket_votes')!.n, 1);
  f.ctx.tickets = new TicketService(f.ctx); assert.equal(f.ctx.tickets.votes.get(1)!.no_count, 1);
  await f.ctx.tickets.votes.tick(); assert.equal(f.ctx.tickets.get(1).state, 'open'); f.ctx.db.close();
});

async function expiredBallot(f: ReturnType<typeof fixture>, choices: ('yes' | 'no')[]) {
  await f.ctx.tickets.ensurePanel(); await f.openTicket('application'); await f.startVote(); await f.ctx.tickets.votes.tick();
  const people = [BOB, STAFF, f.ctx.config.access.ownerUserIds[0]];
  for (let i = 0; i < choices.length; i++) await f.ctx.tickets.votes.vote(f.voteInteraction(people[i]), 1, choices[i]);
  f.ctx.db.run('UPDATE ticket_reviews SET ends_at=?,last_update=0', Date.now() - 1);
}

test('strict Yes majority after the deadline accepts, closes and sends one branded DM across restart', async () => {
  const f = fixture(); await expiredBallot(f, ['yes', 'yes', 'no']); await f.ctx.tickets.votes.tick();
  const review = f.ctx.tickets.votes.get(1)!; assert.equal(review.state, 'accepted'); assert.equal(review.decision, 'accepted');
  assert.equal(f.ctx.tickets.get(1).state, 'closed'); assert.equal(review.dm_status, 'sent'); assert.equal(f.dms.length, 1);
  assert.equal(f.dms[0].userId, ALICE); assert.match((json(f.dms[0].payload.embeds![0]) as APIEmbed).title!, /Accepted/);
  f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.tick(); await f.ctx.tickets.votes.tick(); assert.equal(f.dms.length, 1);
  const log = f.ctx.db.get<{ payload: string }>("SELECT payload FROM log_outbox WHERE dedupe_key LIKE 'ticket-transcript:%'")!;
  const payload = JSON.parse(log.payload) as { embeds: APIEmbed[]; files: { name: string }[] };
  assert.match(payload.embeds[0].title!, /Accepted/); assert.ok(payload.files.every(file => file.name.endsWith('.txt'))); f.ctx.db.close();
});

test('strict No majority rejects and DMs the applicant; decided tickets cannot be reopened by their owner', async () => {
  const f = fixture(); await expiredBallot(f, ['no', 'yes', 'no']); await f.ctx.tickets.votes.tick();
  assert.equal(f.ctx.tickets.votes.get(1)!.state, 'rejected'); assert.match((json(f.dms[0].payload.embeds![0]) as APIEmbed).title!, /Rejected/);
  await assert.rejects(f.ctx.tickets.button(f.interaction(ALICE, f.ctx.tickets.get(1).channel_id!), 'reopen', '1'), /restricted/); f.ctx.db.close();
});

test('ties and no turnout await manual review without closing or sending a decision DM', async () => {
  for (const choices of [['yes', 'no'], []] as ('yes' | 'no')[][]) {
    const f = fixture(); await expiredBallot(f, choices); await f.ctx.tickets.votes.tick();
    assert.equal(f.ctx.tickets.votes.get(1)!.state, 'review'); assert.equal(f.ctx.tickets.get(1).state, 'open'); assert.equal(f.dms.length, 0);
    await assert.rejects(f.ctx.tickets.votes.vote(f.voteInteraction(BOB), 1, 'no'), /ended/); f.ctx.db.close();
  }
  assert.equal(majorityDecision(2, 2), null); assert.equal(majorityDecision(2, 1), 'accepted');
});

test('voting has no role requirement and final counting retains votes after someone leaves', async () => {
  const f = fixture(); f.ctx.config.tickets.voting.voterRoleIds = [f.ctx.config.nickname.roleId];
  await expiredBallot(f, ['yes', 'yes', 'no']);
  f.members.delete(BOB); f.members.delete(STAFF);
  await f.ctx.tickets.votes.tick();
  assert.equal(f.ctx.tickets.votes.get(1)!.yes_count, 2); assert.equal(f.ctx.tickets.votes.get(1)!.state, 'accepted');
  assert.equal(f.dms.length, 1); f.ctx.db.close();
});

test('manual approval requires fresh staff access for buttons and submitted modals, including owner fallback', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.openTicket('application'); const channelId = f.ctx.tickets.get(1).channel_id!;
  await assert.rejects(f.ctx.tickets.button(f.interaction(ALICE, channelId), 'approve', '1'), /replaced/i);
  await assert.rejects(f.ctx.tickets.votes.decisionModal(f.interaction(ALICE, channelId), 1, 'accepted'), /restricted/i);
  await f.ctx.tickets.votes.decisionModal(f.interaction(STAFF, channelId), 1, 'accepted'); f.members.get(STAFF)!.roles.cache.clear();
  const submission = Object.assign(f.interaction(STAFF, channelId), { fields: { getTextInputValue: () => 'Requirements met.' } }) as unknown as ModalSubmitInteraction;
  await assert.rejects(f.ctx.tickets.votes.submitDecision(submission, 1, 'accepted'), /restricted/i);
  const ownerSubmission = Object.assign(f.interaction(f.ctx.config.access.ownerUserIds[0], channelId), { fields: { getTextInputValue: () => 'Requirements met.' } }) as unknown as ModalSubmitInteraction;
  await f.ctx.tickets.votes.submitDecision(ownerSubmission, 1, 'accepted'); assert.equal(f.ctx.tickets.get(1).state, 'closed'); assert.equal(f.dms.length, 1);
  assert.equal(f.ctx.tickets.votes.get(1)!.decided_by, f.ctx.config.access.ownerUserIds[0]); f.ctx.db.close();
});

test('decision, closure and DM recover after a history failure without repeating the decision', async () => {
  const f = fixture(); await expiredBallot(f, ['yes', 'yes', 'no']); f.setHistoryFailure(true); await f.ctx.tickets.votes.tick();
  assert.equal(f.ctx.tickets.votes.get(1)!.state, 'deciding'); assert.equal(f.ctx.tickets.get(1).state, 'closing'); assert.equal(f.dms.length, 0);
  f.setHistoryFailure(false); f.ctx.tickets = new TicketService(f.ctx);
  f.ctx.db.run('UPDATE ticket_reviews SET retry_at=0'); await f.ctx.tickets.tick();
  assert.equal(f.ctx.tickets.get(1).state, 'closed'); assert.equal(f.ctx.tickets.votes.get(1)!.state, 'accepted'); assert.equal(f.dms.length, 1); f.ctx.db.close();
});

test('closed DMs are recorded quietly and transient DM failures retry without preventing ticket closure', async () => {
  for (const code of [50007, 0]) {
    const f = fixture(); await expiredBallot(f, ['no', 'no', 'yes']); f.setDmError(code); await f.ctx.tickets.votes.tick();
    assert.equal(f.ctx.tickets.get(1).state, 'closed'); assert.equal(f.ctx.tickets.votes.get(1)!.dm_status, code === 50007 ? 'unavailable' : 'pending');
    f.setDmError(); f.ctx.db.run('UPDATE ticket_reviews SET retry_at=0'); await f.ctx.tickets.votes.tick();
    assert.equal(f.dms.length, code === 50007 ? 0 : 1); assert.equal(f.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM log_outbox WHERE dedupe_key LIKE 'ticket-transcript:%'")!.n, 1); f.ctx.db.close();
  }
});

test('missing vote panels are restored once and forged message buttons cannot vote', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.openTicket('application'); await f.startVote(); await f.ctx.tickets.votes.tick();
  const review = f.ctx.tickets.votes.get(1)!; await assert.rejects(f.ctx.tickets.votes.vote(f.interaction(BOB, review.channel_id, '1550000000009999999'), 1, 'yes'), /current/);
  f.channels.get(review.channel_id)!.messageCache.delete(review.message_id!); f.ctx.db.run('UPDATE ticket_reviews SET dirty=1,last_update=0');
  f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.votes.tick(); const updated = f.ctx.tickets.votes.get(1)!;
  assert.notEqual(updated.message_id, review.message_id); assert.equal(f.channels.get(review.channel_id)!.messageCache.size, 1); f.ctx.db.close();
});

test('manual ticket closure cancels community votes and cannot be overridden by a late ballot', async () => {
  const f = fixture(); await expiredBallot(f, ['yes', 'yes']); await f.ctx.tickets.close(1, ALICE, 'Withdrawn');
  await f.ctx.tickets.votes.tick(); assert.equal(f.ctx.tickets.votes.get(1)!.state, 'cancelled'); assert.equal(f.dms.length, 0);
  assert.equal(f.ctx.tickets.votes.get(1)!.decision, null); f.ctx.db.close();
});

test('ticket logs include actual conversation text in one readable summary with complete TXT evidence', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('support');
  const message = f.original(ticket.channel_id!, 99, 'I cannot see the clan channel.'); f.channels.get(ticket.channel_id!)!.messageCache.set(message.id, message);
  await f.ctx.tickets.close(ticket.id, STAFF, 'Access restored.');
  const rows = f.ctx.db.all<{ payload: string }>("SELECT payload FROM log_outbox WHERE dedupe_key LIKE 'ticket-transcript:%'"); assert.equal(rows.length, 1);
  const payload = JSON.parse(rows[0].payload) as { channelId: string; embeds: APIEmbed[]; files: { name: string; base64: string }[] };
  assert.equal(payload.channelId, '1557439533979803678'); assert.match(payload.embeds[0].description!, /I cannot see the clan channel/);
  assert.match(Buffer.from(payload.files[0].base64, 'base64').toString('utf8'), /I cannot see the clan channel/);
  assert.ok(payload.files.every(file => file.name.endsWith('.txt'))); assert.ok(embedCharacters(payload.embeds) < 5800); f.ctx.db.close();
});

test('GIF, edit and deleted ticket messages route exclusively to Message Logs; link previews do not add edit logs', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('support');
  f.ctx.history = { ingest: (message: Message) => f.ctx.db.recordMessage(snapshotMessage(message), 'live') } as unknown as Context['history'];
  f.ctx.audit.deletionAttribution = async () => 'Unknown'; installEvents(f.ctx);
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 15)); };
  const message = f.original(ticket.channel_id!, 88, 'https://tenor.com/view/goat-gif-12345');
  (f.ctx.client as unknown as EventEmitter).emit('messageCreate', message); await settle();
  const edited = { ...message, content: 'Changed to https://tenor.com/view/goat-gif-12345', editedTimestamp: Date.now() } as Message;
  (f.ctx.client as unknown as EventEmitter).emit('messageUpdate', message, edited); await settle();
  const enriched = { ...edited, embeds: [{ toJSON: () => ({ type: 'gifv', image: { url: 'https://media.tenor.com/example.gif' } }) }] } as unknown as Message;
  (f.ctx.client as unknown as EventEmitter).emit('messageUpdate', edited, enriched); await settle(); (f.ctx.client as unknown as EventEmitter).emit('messageDelete', enriched); await settle();
  const rows = f.ctx.db.all<{ payload: string; dedupe_key: string }>("SELECT payload,dedupe_key FROM log_outbox WHERE dedupe_key LIKE 'gif:%' OR dedupe_key LIKE 'edit:%' OR dedupe_key LIKE 'delete:%'");
  assert.equal(rows.length, 3); for (const row of rows) assert.equal(JSON.parse(row.payload).channelId, '1557439487813091358');
  assert.equal(rows.filter(row => row.dedupe_key.startsWith('edit:')).length, 1); f.ctx.db.close();
});

test('upgrade migrates ticket username and review structures without resetting the new-member cutoff', () => {
  const path = mkdtempSync(join(tmpdir(), 'goat-v21-')); const file = join(path, 'goat.sqlite'); const original = new Store(file);
  original.setMeta('username_reminder_started_at', '123'); original.run('ALTER TABLE tickets DROP COLUMN roblox_username'); original.run('ALTER TABLE tickets DROP COLUMN owner_name'); original.close();
  const migrated = new Store(file); const columns = migrated.all<{ name: string }>('PRAGMA table_info(tickets)');
  assert.ok(columns.some(column => column.name === 'roblox_username')); assert.equal(migrated.meta('username_reminder_started_at'), '123');
  assert.equal(migrated.meta('schema_version'), '6'); assert.equal(VERSION, '2.3.0');
  const review = migrated.get<TicketReview>('SELECT * FROM ticket_reviews'); assert.equal(review, undefined); migrated.close(); rmSync(path, { recursive: true, force: true });
});

test('existing two-embed application messages are upgraded in place and retain durable privacy repair', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('application');
  const message = f.channels.get(ticket.channel_id!)!.messageCache.get(ticket.opening_message_id!)!;
  await message.edit({ embeds: [{ title: 'Old banner' }, { title: 'Old checklist' }] });
  f.ctx.db.setMeta('ticket_embed_version', '2.0.0'); f.ctx.tickets = new TicketService(f.ctx);
  f.setPermissionFailure(true); await f.ctx.tickets.syncPermissions(); assert.equal(f.ctx.tickets.get(1).embed_dirty, 1);
  f.setPermissionFailure(false); f.ctx.db.run('UPDATE tickets SET retry_at=0'); await f.ctx.tickets.tick();
  assert.equal(message.embeds.length, 1); assert.match(message.embeds[0].description!, /Mastery/);
  assert.equal(f.ctx.tickets.get(1).embed_dirty, 0); assert.equal(f.ctx.tickets.get(1).opening_message_id, message.id); f.ctx.db.close();
});

test('a deleted ticket channel is reconciled on restart and its outstanding voting is cancelled', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('application'); await f.startVote();
  f.channels.delete(ticket.channel_id!); f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.syncPermissions();
  assert.equal(f.ctx.tickets.get(1).state, 'deleted'); assert.equal(f.ctx.tickets.votes.get(1)!.state, 'cancelled'); assert.equal(f.dms.length, 0); f.ctx.db.close();
});

test('join and leave logs carry account and server dates on Member Logs; role administration stays separate', async () => {
  const f = fixture(); Object.assign(f.ctx.guild, { memberCount: 27 });
  const member = Object.assign(f.members.get(BOB)!, { guild: f.ctx.guild }); installEvents(f.ctx);
  const bus = f.ctx.client as unknown as EventEmitter;
  bus.emit('guildMemberAdd', member); bus.emit('guildMemberRemove', member);
  bus.emit('guildAuditLogEntryCreate', { id: '1550000000009999888', action: AuditLogEvent.MemberRoleUpdate, targetId: BOB,
    executorId: STAFF, createdTimestamp: Date.now(), reason: 'Clan promotion', changes: [{ key: '$add', new: [{ id: f.ctx.config.nickname.roleId }] }], target: null, extra: null }, f.ctx.guild);
  await new Promise(resolve => setTimeout(resolve, 15));
  const rows = f.ctx.db.all<{ payload: string; dedupe_key: string | null }>('SELECT payload,dedupe_key FROM log_outbox');
  const memberships = rows.map(row => JSON.parse(row.payload) as { channelId?: string; embeds: APIEmbed[] }).filter(row => row.channelId === '1557439665378959491');
  assert.equal(memberships.length, 2);
  for (const entry of memberships) { assert.match(entry.embeds[0].description!, new RegExp(BOB)); assert.ok(entry.embeds[0].fields?.some(field => field.name === 'Account Created')); }
  assert.ok(memberships[0].embeds[0].fields?.some(field => field.name === 'Joined Server'));
  assert.ok(memberships[1].embeds[0].fields?.some(field => field.name === 'Left Server'));
  for (let index = 0; index < 4; index++) await f.ctx.logs.flush();
  const admin = f.sent.find(record => record.channelId === '1557440463974436956'); assert.ok(admin);
  assert.match((json(admin.payload.embeds![0]) as APIEmbed).title!, /Roles Updated/); f.ctx.db.close();
});

test('opening a ticket never starts or publishes a ballot; Roblox username leads the embed', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('application');
  await f.ctx.tickets.votes.tick();
  assert.equal(f.ctx.tickets.votes.get(ticket.id), undefined);
  assert.equal(f.sent.filter(record => record.channelId === f.ctx.config.tickets.voting.channelId).length, 0);
  const initial = f.sent.find(record => record.channelId === ticket.channel_id)!.payload;
  assert.match((json(initial.embeds![0]) as APIEmbed).description!, /^## @Stormy_123\n/);
  assert.equal(initial.components!.length, 1);
  const row = json(initial.components![0]) as { components: { label: string }[] };
  assert.deepEqual(row.components.map(button => button.label), ['Claim', 'Close', 'Start Vote']);
  f.ctx.db.close();
});

test('Start Vote requires fresh staff access and starts exactly 180 seconds after the click', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('application');
  f.ctx.db.run('UPDATE tickets SET created_at=? WHERE id=?', Date.now() - 3600000, ticket.id);
  await assert.rejects(f.startVote(1, ALICE), /restricted/);
  f.members.get(STAFF)!.roles.cache.clear(); await assert.rejects(f.startVote(), /restricted/);
  const now = Date.now(); await f.startVote(1, f.ctx.config.access.ownerUserIds[0]);
  const review = f.ctx.tickets.votes.get(1)!;
  assert.ok(review.started_at! >= now); assert.equal(review.ends_at - review.started_at!, 180000);
  await assert.rejects(f.startVote(1, f.ctx.config.access.ownerUserIds[0]), /already started/);
  f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.votes.tick();
  assert.equal(f.ctx.tickets.votes.get(1)!.ends_at, review.ends_at);
  assert.equal(f.ctx.tickets.get(1).state, 'open'); f.ctx.db.close();
});

test('three Yes or three No immediately lock the result and complete one closure and DM', async () => {
  for (const choice of ['yes', 'no'] as const) {
    const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.openTicket('application'); await f.startVote();
    await f.ctx.tickets.votes.tick();
    for (const person of [BOB, STAFF]) await f.ctx.tickets.votes.vote(f.voteInteraction(person), 1, choice);
    assert.equal(f.ctx.tickets.votes.get(1)!.decision, null);
    const third = f.voteInteraction(f.ctx.config.access.ownerUserIds[0]);
    await f.ctx.tickets.votes.vote(third, 1, choice);
    const decision = choice === 'yes' ? 'accepted' : 'rejected';
    assert.equal(f.ctx.tickets.votes.get(1)!.decision, decision);
    assert.ok(Date.now() < f.ctx.tickets.votes.get(1)!.ends_at);
    assert.match(JSON.stringify((third as unknown as { replies: unknown[] }).replies), new RegExp(decision));
    await assert.rejects(f.ctx.tickets.votes.vote(f.voteInteraction(BOB), 1, choice === 'yes' ? 'no' : 'yes'), /ended/);
    await f.ctx.tickets.votes.tick();
    assert.equal(f.ctx.tickets.get(1).state, 'closed'); assert.equal(f.dms.length, 1);
    await f.ctx.tickets.votes.tick(); assert.equal(f.dms.length, 1); f.ctx.db.close();
  }
});

test('one vote is sufficient for a majority at the deadline with no quorum', async () => {
  for (const choice of ['yes', 'no'] as const) {
    const f = fixture(); await expiredBallot(f, [choice]); await f.ctx.tickets.votes.tick();
    assert.equal(f.ctx.tickets.votes.get(1)!.decision, choice === 'yes' ? 'accepted' : 'rejected');
    assert.equal(f.ctx.tickets.get(1).state, 'closed'); assert.equal(f.dms.length, 1); f.ctx.db.close();
  }
});

test('upgrading old automatic ballots waits for Start Vote and retains old votes and first-join cutoff', () => {
  const directory = mkdtempSync(join(tmpdir(), 'goat-v22-')); const file = join(directory, 'goat.sqlite');
  const original = new Store(file); original.setMeta('username_reminder_started_at', '123');
  original.run("INSERT INTO tickets(guild_id,owner_id,kind,state,created_at) VALUES(?,?,'application','open',?)", GUILD, ALICE, 123);
  original.run('INSERT INTO ticket_reviews(ticket_id,channel_id,ends_at,minimum_votes) VALUES(1,?,?,3)', config.tickets.voting.channelId, Date.now() - 1);
  original.run("INSERT INTO ticket_votes VALUES(1,?,'yes',123)", BOB);
  original.run('ALTER TABLE ticket_reviews DROP COLUMN started_at'); original.close();
  const migrated = new Store(file);
  assert.equal(migrated.get<TicketReview>('SELECT * FROM ticket_reviews')!.state, 'waiting');
  assert.equal(migrated.get<{ n: number }>('SELECT COUNT(*) n FROM ticket_votes')!.n, 1);
  assert.equal(migrated.meta('username_reminder_started_at'), '123');
  assert.equal(migrated.meta('schema_version'), '6'); migrated.close(); rmSync(directory, { recursive: true, force: true });
});

test('slow delivery in one log channel does not prevent logs reaching another channel', async () => {
  const f = fixture(); const slow = f.channels.get(f.ctx.config.channels.logs)!;
  const send = slow.send; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  slow.send = async payload => { await gate; return send(payload); };
  f.ctx.logs.enqueue({ embeds: [{ title: 'Slow administration route' }] });
  const sending = f.ctx.logs.flush(); await new Promise(resolve => setImmediate(resolve));
  f.ctx.logs.enqueue({ channelId: f.ctx.config.channels.messageLogs, embeds: [{ title: 'Fast edit log' }] });
  await f.ctx.logs.flush();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].channelId, f.ctx.config.channels.messageLogs);
  release(); await sending; assert.equal(f.ctx.logs.pending(), 0); f.ctx.db.close();
});

test('partial edits and uncached deletes log stored evidence without fetching the edited or deleted message', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('support');
  const message = f.original(ticket.channel_id!, 900, 'Before edit'); f.ctx.db.recordMessage(snapshotMessage(message), 'live');
  let fetches = 0, audits = 0;
  f.ctx.audit.deletionAttribution = async () => { audits++; throw new Error('Audit unavailable'); };
  installEvents(f.ctx);
  const partial = { ...message, partial: true, author: null, member: null, content: 'After edit', editedTimestamp: Date.now(),
    fetch: async () => { fetches++; throw new Error('Already deleted on Discord'); } } as unknown as Message;
  (f.ctx.client as unknown as EventEmitter).emit('messageUpdate', { ...partial, content: null }, partial);
  await new Promise(resolve => setImmediate(resolve));
  (f.ctx.client as unknown as EventEmitter).emit('messageDelete', { ...partial, content: null });
  await new Promise(resolve => setImmediate(resolve));
  const rows = f.ctx.db.all<{ payload: string; dedupe_key: string }>("SELECT payload,dedupe_key FROM log_outbox WHERE dedupe_key LIKE 'edit:%' OR dedupe_key LIKE 'delete:%'");
  assert.equal(rows.length, 2); assert.equal(fetches, 0); assert.equal(audits, 0);
  const edit = JSON.parse(rows.find(row => row.dedupe_key.startsWith('edit:'))!.payload) as { embeds: APIEmbed[] };
  assert.equal(edit.embeds[0].fields!.find(field => field.name === 'Before')!.value, 'Before edit');
  assert.equal(edit.embeds[0].fields!.find(field => field.name === 'After')!.value, 'After edit');
  const deleted = JSON.parse(rows.find(row => row.dedupe_key.startsWith('delete:'))!.payload) as { embeds: APIEmbed[] };
  assert.match(deleted.embeds[0].description!, /After edit/); assert.equal(f.ctx.db.count(GUILD, ALICE), 1); f.ctx.db.close();
});

test('public activity, both leaderboard spellings and help respond visibly with no member REST lookup', async () => {
  const f = fixture(); let lookups = 0;
  f.ctx.history = { running: false, summary: () => ({ indexed: 0, complete: 0, pending: 0, errors: 0 }) } as unknown as Context['history'];
  f.ctx.guild.members.fetch = (async () => { lookups++; throw new Error('REST is slow'); }) as typeof f.ctx.guild.members.fetch;
  for (const name of ['messages', 'leaderboard', 'leadboard', 'help']) {
    const interaction = Object.assign(f.interaction(), { commandName: name, isAutocomplete: () => false,
      isChatInputCommand: () => true, isRepliable: () => true,
      options: { getUser: () => null, getString: () => null, getInteger: () => null } });
    await routeInteraction(f.ctx, interaction);
    const result = interaction as unknown as { acknowledgements: { flags?: number }[]; replies: { embeds: { toJSON(): APIEmbed }[] }[] };
    assert.equal(result.acknowledgements.length, 1); assert.equal(result.acknowledgements[0].flags, undefined);
    assert.ok(!result.replies[0].embeds[0].toJSON().title!.includes('Unavailable'));
  }
  assert.equal(lookups, 0);
  for (const definition of commandDefinitions) assert.equal(definition.toJSON().default_member_permissions, null);
  assert.equal(commandDefinitions.length, 36); f.ctx.db.close();
});

test('privileged slash commands acknowledge before fresh authorization and deny ordinary members', async () => {
  const f = fixture(); const interaction = Object.assign(f.interaction(), { commandName: 'ticket-panel',
    isAutocomplete: () => false, isChatInputCommand: () => true, isRepliable: () => true });
  const fetch = f.ctx.guild.members.fetch;
  f.ctx.guild.members.fetch = (async (...args: unknown[]) => {
    assert.ok(interaction.deferred); return fetch(...args as Parameters<typeof fetch>);
  }) as typeof fetch;
  await routeInteraction(f.ctx, interaction);
  const result = interaction as unknown as { acknowledgements: { flags: number }[]; replies: { embeds: { toJSON(): APIEmbed }[] }[] };
  assert.equal(result.acknowledgements[0].flags, 64);
  assert.match(result.replies[0].embeds[0].toJSON().description!, /restricted/);
  assert.equal(f.ctx.db.meta('ticket_panel_message_id'), undefined); f.ctx.db.close();
});

test('an observed edit still emits a metadata log when neither snapshot nor Discord fetch is available', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('support'); installEvents(f.ctx);
  const message = { ...f.original(ticket.channel_id!, 901), partial: true, author: null, member: null, content: null,
    editedTimestamp: Date.now(), fetch: async () => { throw Object.assign(new Error('Unknown message'), { code: 10008 }); } } as unknown as Message;
  (f.ctx.client as unknown as EventEmitter).emit('messageUpdate', message, message);
  await new Promise(resolve => setImmediate(resolve));
  const row = f.ctx.db.get<{ payload: string }>("SELECT payload FROM log_outbox WHERE dedupe_key LIKE 'edit:%'")!;
  const payload = JSON.parse(row.payload) as { channelId: string; embeds: APIEmbed[] };
  assert.equal(payload.channelId, f.ctx.config.channels.messageLogs); assert.match(payload.embeds[0].title!, /Edited/);
  assert.match(payload.embeds[0].description!, /could not be retrieved/); f.ctx.db.close();
});

test('deletion attribution uses an already observed unique audit candidate without delaying evidence', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('support');
  const message = f.original(ticket.channel_id!, 902, 'Preserved deleted text'); f.ctx.db.recordMessage(snapshotMessage(message), 'live');
  f.ctx.audit.ingest({ id: '1550000000001234599', action: AuditLogEvent.MessageDelete, targetId: ALICE, executorId: STAFF,
    createdTimestamp: Date.now(), extra: { channelId: ticket.channel_id }, changes: [] } as unknown as GuildAuditLogsEntry);
  f.ctx.audit.deletionAttribution = async () => { throw new Error('Blocking audit lookup must not run'); }; installEvents(f.ctx);
  (f.ctx.client as unknown as EventEmitter).emit('messageDelete', message); await new Promise(resolve => setImmediate(resolve));
  const row = f.ctx.db.get<{ payload: string }>("SELECT payload FROM log_outbox WHERE dedupe_key LIKE 'delete:%'")!;
  const embed = (JSON.parse(row.payload) as { embeds: APIEmbed[] }).embeds[0];
  assert.equal(embed.description, 'Preserved deleted text');
  assert.match(embed.fields!.find(field => field.name === 'Deletion Attribution')!.value, new RegExp(`Audit candidate: <@${STAFF}>`));
  f.ctx.db.close();
});

test('custom embed payload preserves outside text and only enables the selected role and user pings', () => {
  const payload = customEmbedPayload({ title: 'Clan News', description: 'Message in the embed', outside: '@everyone Outside text',
    image: 'https://cdn.discordapp.com/example.png', color: '#F97316' }, config.nickname.roleId, BOB);
  assert.match(payload.content!, new RegExp(`<@&${config.nickname.roleId}> <@${BOB}>`));
  assert.match(payload.content!, /@everyone Outside text/);
  assert.deepEqual(payload.allowedMentions?.parse, []);
  assert.deepEqual(payload.allowedMentions?.roles, [config.nickname.roleId]); assert.deepEqual(payload.allowedMentions?.users, [BOB]);
  const embed = payload.embeds![0] as APIEmbed;
  assert.equal(embed.title, 'GOAT • Clan News'); assert.equal(embed.description, 'Message in the embed');
  assert.equal(embed.color, 0xF97316); assert.equal(embed.image?.url, 'https://cdn.discordapp.com/example.png'); assert.match(embed.footer!.text, /GOAT/);
  assert.equal(embed.timestamp, undefined);
});

test('custom embeds reject invalid colors, non-HTTPS images and empty or oversized messages', () => {
  const input = { title: 'News', description: 'Hello', outside: '', image: '', color: '' };
  assert.throws(() => customEmbedPayload({ ...input, color: 'purple!' }), /color/);
  assert.throws(() => customEmbedPayload({ ...input, image: 'http://example.com/picture.png' }), /HTTPS/);
  assert.throws(() => customEmbedPayload({ ...input, description: '  ' }), /message/);
  assert.throws(() => customEmbedPayload({ ...input, outside: 'x'.repeat(1901) }), /long/);
});

async function embedForm(f: ReturnType<typeof fixture>, userId = STAFF) {
  const interaction = Object.assign(f.interaction(userId), { options: { getChannel: () => ({ id: f.ctx.config.channels.usernames }),
    getRole: () => ({ id: f.ctx.config.nickname.roleId }), getUser: () => ({ id: BOB }) } });
  await f.ctx.embeds.create(interaction as unknown as import('discord.js').ChatInputCommandInteraction);
  const form = (interaction as unknown as { replies: { toJSON(): { custom_id: string; components: unknown[] } }[] }).replies[0].toJSON();
  const values: Record<string, string> = { title: 'Hello GOAT', description: 'Clan update', outside: 'Please read', image: '', color: '#22D3EE' };
  const modal = Object.assign(f.interaction(userId), { fields: { getTextInputValue: (id: string) => values[id] } }) as unknown as ModalSubmitInteraction;
  return { id: form.custom_id.split(':')[3], form, modal };
}

test('/embed has five native labelled inputs and repeated modal submissions publish exactly one message', async () => {
  const f = fixture(); const request = await embedForm(f);
  assert.equal(request.form.components.length, 5);
  await f.ctx.embeds.submit(request.modal, request.id); await f.ctx.embeds.submit(request.modal, request.id);
  const published = f.sent.filter(record => record.channelId === f.ctx.config.channels.usernames);
  assert.equal(published.length, 1); assert.ok(String(published[0].payload.nonce).length <= 25);
  assert.equal(published[0].payload.enforceNonce, true);
  assert.equal(f.ctx.db.get<{ state: string }>('SELECT state FROM custom_embeds WHERE id=?', request.id)!.state, 'published'); f.ctx.db.close();
});

test('embed submission checks fresh access, rejects a stolen form and recovers queued delivery after restart', async () => {
  const f = fixture(); const request = await embedForm(f);
  f.members.get(STAFF)!.roles.cache.clear(); await assert.rejects(f.ctx.embeds.submit(request.modal, request.id), /restricted/);
  f.members.get(STAFF)!.roles.cache.set(f.ctx.config.access.staffRoleIds[0], { id: f.ctx.config.access.staffRoleIds[0] } as never);
  const impostor = Object.assign(f.interaction(f.ctx.config.access.ownerUserIds[0]), { fields: { getTextInputValue: () => 'stolen' } }) as unknown as ModalSubmitInteraction;
  await assert.rejects(f.ctx.embeds.submit(impostor, request.id), /unavailable/);
  f.setSendFailure(true); await f.ctx.embeds.submit(request.modal, request.id);
  assert.equal(f.ctx.db.get<{ state: string }>('SELECT state FROM custom_embeds WHERE id=?', request.id)!.state, 'publishing');
  f.setSendFailure(false); f.ctx.embeds = new EmbedService(f.ctx); f.ctx.db.run('UPDATE custom_embeds SET retry_at=0'); await f.ctx.embeds.tick();
  assert.equal(f.sent.length, 1); await f.ctx.embeds.tick(); assert.equal(f.sent.length, 1); f.ctx.db.close();
});

test('clan application requests four screenshots and a fifth answer about 24/7 AFK availability', () => {
  const instructions = applicationRequirements().toJSON().description!;
  assert.match(instructions, /four screenshots/); assert.match(instructions, /5 · Can you be AFK 24\/7\?/);
  assert.match(instructions, /answer Yes or No/);
});
