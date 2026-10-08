import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLogEvent, EmbedType, MessageFlags, type APIEmbed, type GuildAuditLogsEntry, type Message } from 'discord.js';
import { fixture, ALICE, BOB, BOT, GUILD, STAFF, json } from './harness.js';
import { config, configSchema } from '../src/core/config.js';
import { gifMedia, snapshotMessage } from '../src/core/messages.js';
import { goatEmbed } from '../src/core/embeds.js';
import { linkViolation } from '../src/services/link-filter.js';
import { FilterNoticeService } from '../src/services/filter-notices.js';
import { RoleReminderService } from '../src/services/role-reminders.js';
import { TemporaryMessageService } from '../src/services/temporary-messages.js';
import { Store } from '../src/core/store.js';
import { routeInteraction } from '../src/commands/router.js';
import { commandDefinitions } from '../src/commands/definitions.js';
import { helpPanel } from '../src/commands/help.js';
import { installEvents } from '../src/events/install.js';
import { archiveSource } from '../src/services/usernames.js';
import { votePanel } from '../src/services/ticket-votes.js';
import { customEmbedPayload } from '../src/services/custom-embeds.js';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const policy = { ...config.linkFilter, staff: false, gifsAllowed: false };
const roleId = config.roleUsernameDm.roleId;
function present(f: ReturnType<typeof fixture>, content: string, channelId = config.tickets.panelChannelId, index = 2000) {
  const message = Object.assign(f.original(channelId, index, content), { createdTimestamp: Date.now() - 1000 });
  f.channels.get(channelId)!.messageCache.set(message.id, message); return message;
}
function grant(f: ReturnType<typeof fixture>, userId = ALICE) {
  const before = f.members.get(userId)!; const after = f.addMember(userId, [roleId]);
  f.ctx.roleReminders.transition(before, after); return after;
}
const state = (f: ReturnType<typeof fixture>, user = ALICE) => f.ctx.db.get<{ state: string }>('SELECT state FROM role_username_dms WHERE user_id=?', user)?.state;

test('older configurations receive Klipy, the requested GIF channel and ten-second feedback defaults', () => {
  const legacy = structuredClone(config) as Partial<typeof config>; delete legacy.linkFilter; delete legacy.roleUsernameDm;
  const restored = configSchema.parse(legacy);
  assert.ok(restored.linkFilter.allowedDomains.includes('klipy.com'));
  assert.deepEqual(restored.linkFilter.unrestrictedGifChannelIds, ['1557577086351179866']);
  assert.equal(restored.linkFilter.allowApprovedGifs, true); assert.equal(restored.linkFilter.notifications.deleteAfterSeconds, 10);
  assert.equal(restored.roleUsernameDm.roleId, '1552474081054564402');
});

for (const url of ['https://klipy.com/gifs/goat', 'https://static.klipy.com/ii/goat.gif', 'https://klipy.com./clips/goat', 'https://tenor.com/view/goat', 'https://gph.is/goat']) {
  test(`approved provider is public and included in GIF evidence: ${url}`, () => {
    const f = fixture(); const s = snapshotMessage(present(f, url));
    assert.equal(linkViolation(s, policy), undefined); assert.deepEqual(gifMedia(s).links, [url]); f.ctx.db.close();
  });
}

test('one approved GIF cannot smuggle an unknown GIF, uploaded animation or unrelated link', () => {
  const f = fixture(); const s = snapshotMessage(present(f, 'https://tenor.com/view/goat https://evil.example/test.gif'));
  assert.equal(linkViolation(s, policy)?.kind, 'gif'); s.content = 'https://klipy.com/gifs/goat';
  s.attachments = [{ id: '1', name: 'hidden', contentType: 'image/gif', size: 100, url: 'https://cdn.discordapp.com/attachments/1/2/hidden' }];
  assert.equal(linkViolation(s, policy)?.kind, 'gif'); s.attachments = [];
  s.embeds = [{ type: EmbedType.GIFV, url: 'https://evil.example/animation', video: { url: 'https://evil.example/a.mp4' } }];
  assert.equal(linkViolation(s, policy)?.kind, 'gif');
  s.embeds = []; s.content += ' https://evil.example/login'; assert.equal(linkViolation(s, policy)?.kind, 'link'); f.ctx.db.close();
});

test('trusted Klipy previews accept native CDN resources but reject spoofed providers and URL credentials', () => {
  const f = fixture(); const s = snapshotMessage(present(f, 'https://klipy.com/clips/goat'));
  s.embeds = [{ type: EmbedType.GIFV, url: s.content, video: { url: 'https://images-ext-1.discordapp.net/external/clip.mp4' } }];
  assert.equal(linkViolation(s, policy), undefined);
  s.content = 'https://klipy.com.evil.example/goat'; s.embeds[0].url = s.content; assert.equal(linkViolation(s, policy)?.kind, 'gif');
  s.content = 'https://attacker@klipy.com/goat'; s.embeds = []; assert.equal(linkViolation(s, policy)?.kind, 'link'); f.ctx.db.close();
});

test('the unrestricted GIF channel accepts unknown GIFV and uploads but still blocks invites and normal links', async () => {
  const f = fixture({ filter: true }); const channelId = '1557577086351179866';
  const message = present(f, 'https://example.net/animated', channelId);
  message.embeds.push({ toJSON: () => ({ type: EmbedType.GIFV, url: message.content, video: { url: 'https://example.net/a.mp4' } }) } as never);
  assert.equal(f.ctx.linkFilter.prepare(snapshotMessage(message)), true); await settle();
  const gif = present(f, 'https://cdn.discordapp.com/attachments/1/2/goat.gif', channelId, 2001);
  assert.equal(f.ctx.linkFilter.prepare(snapshotMessage(gif)), true); await settle();
  for (const [index, content] of [[2002, 'discord.gg/other'], [2003, 'https://evil.example/login']] as const) {
    const blocked = present(f, content, channelId, index); assert.equal(f.ctx.linkFilter.prepare(snapshotMessage(blocked)), true); await settle();
    assert.ok(f.deletes.includes(blocked.id));
  }
  assert.ok(!f.deletes.includes(message.id)); assert.ok(!f.deletes.includes(gif.id)); f.ctx.db.close();
});

test('legacy approved-GIF role gating remains configurable', () => {
  const f = fixture(); const s = snapshotMessage(present(f, 'https://klipy.com/gifs/goat'));
  assert.equal(linkViolation(s, { ...policy, allowApprovedGifs: false })?.kind, 'gif');
  assert.equal(linkViolation(s, { ...policy, allowApprovedGifs: false, gifsAllowed: true }), undefined); f.ctx.db.close();
});

test('a blocked GIF gets a member-only mention and a ten-second warning that cannot create delete-log loops', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx); const message = present(f, 'https://unknown.example/bad.gif');
  f.ctx.linkFilter.prepare(snapshotMessage(message)); await settle();
  const warning = f.sent.find(item => item.channelId === message.channelId)!;
  assert.match(warning.payload.content!, /Tenor, Giphy, KLIPY/); assert.match(warning.payload.content!, /YouTube, TikTok and Roblox/);
  assert.deepEqual(warning.payload.allowedMentions?.parse, []); assert.deepEqual(warning.payload.allowedMentions?.users, [ALICE]);
  const temporary = f.ctx.db.get<{ message_id: string; delete_at: number }>('SELECT * FROM temporary_messages')!;
  const saved = f.channels.get(message.channelId)!.messageCache.get(temporary.message_id)!;
  assert.equal(temporary.delete_at - saved.createdTimestamp, 10000);
  assert.equal(f.ctx.db.snapshot(saved.id)!.bot, true); assert.equal(f.ctx.db.count(GUILD, BOT), 0);
  await f.ctx.temporary.tick(temporary.delete_at - 1); assert.ok(!f.deletes.includes(saved.id));
  await f.ctx.temporary.tick(temporary.delete_at); assert.ok(f.deletes.includes(saved.id));
  (f.ctx.client as unknown as EventEmitter).emit('raw', { t: 'MESSAGE_DELETE', d: { id: saved.id, channel_id: saved.channelId, guild_id: GUILD } });
  await settle(); assert.equal(f.ctx.db.get('SELECT 1 FROM log_outbox WHERE dedupe_key LIKE ?', `delete:${saved.id}%`), undefined); f.ctx.db.close();
});

test('rapid blocked attempts coalesce to one warning without extending its deletion deadline', async () => {
  const f = fixture({ filter: true });
  for (let index = 2100; index < 2105; index++) {
    f.ctx.linkFilter.prepare(snapshotMessage(present(f, 'https://unknown.example/test.gif', config.tickets.panelChannelId, index))); await settle();
  }
  assert.equal(f.sent.length, 1); assert.equal(f.deletes.length, 5);
  assert.equal(f.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM filter_notices WHERE state='coalesced'")!.n, 4);
  const warning = f.ctx.db.get<{ delete_at: number; message_id: string }>('SELECT * FROM temporary_messages')!;
  await f.ctx.temporary.tick(warning.delete_at); assert.ok(f.deletes.includes(warning.message_id)); f.ctx.db.close();
});

test('notice publication retries durably and does not notify about old removal jobs', async () => {
  const f = fixture(); const s = snapshotMessage(present(f, 'bad.gif'));
  f.setSendFailure(true); f.ctx.filterNotices.enqueue(s, 'gif', Date.now()); await settle(); assert.equal(f.ctx.filterNotices.pending(), 1);
  f.ctx.filterNotices = new FilterNoticeService(f.ctx); f.setSendFailure(false);
  await f.ctx.filterNotices.tick(Date.now() + 3000); await settle(); assert.equal(f.sent.length, 1); assert.equal(f.ctx.filterNotices.pending(), 0);
  f.ctx.filterNotices.enqueue({ ...s, id: '1550000000001002400' }, 'gif', f.ctx.startedAt - 1); await settle();
  assert.equal(f.ctx.db.get('SELECT 1 FROM filter_notices WHERE message_id=?', '1550000000001002400'), undefined); f.ctx.db.close();
});

test('an uncertain notice publication recovers by nonce and deletes after restart without another ping', async () => {
  const f = fixture(); const s = snapshotMessage(present(f, 'bad.gif')); const record = f.ctx.db.recordMessage.bind(f.ctx.db);
  f.ctx.db.recordMessage = () => { throw new Error('Checkpoint interrupted'); };
  f.ctx.filterNotices.enqueue(s, 'gif', Date.now()); await settle(); assert.equal(f.sent.length, 1);
  f.ctx.db.recordMessage = record;
  const published = [...f.channels.get(s.channelId)!.messageCache.values()].find(message => message.author.id === BOT)!;
  Object.assign(published, { createdTimestamp: Date.now() - 11000 }); f.ctx.filterNotices = new FilterNoticeService(f.ctx);
  await f.ctx.filterNotices.tick(Date.now() + 70000); await settle();
  assert.equal(f.sent.length, 1); assert.ok(f.deletes.includes(published.id)); assert.equal(f.ctx.filterNotices.pending(), 0); f.ctx.db.close();
});

test('stale warnings expire rather than pinging after a long outage', async () => {
  const f = fixture(); f.ctx.stopping = true;
  f.ctx.filterNotices.enqueue(snapshotMessage(present(f, 'bad.gif')), 'gif', Date.now()); f.ctx.stopping = false;
  await f.ctx.filterNotices.tick(Date.now() + 70000);
  assert.equal(f.sent.length, 0); assert.equal(f.ctx.db.get<{ state: string }>('SELECT state FROM filter_notices')!.state, 'expired'); f.ctx.db.close();
});

test('temporary cleanup works during a slow full member rescan and survives service restart', async () => {
  const f = fixture(); f.ctx.config.autorole.enabled = false; f.ctx.config.usernameReminder.enabled = false;
  const message = await f.channels.get(config.channels.usernames)!.send({ content: 'Temporary' });
  f.ctx.temporary.schedule(message.id, message.channelId, Date.now() - 1);
  let release!: (members: typeof f.members) => void;
  f.ctx.guild.members.fetch = (() => new Promise(resolve => { release = resolve; })) as typeof f.ctx.guild.members.fetch;
  f.ctx.members.requestInitialSync(); const rescan = f.ctx.members.tick(); await settle();
  f.ctx.temporary = new TemporaryMessageService(f.ctx); await f.ctx.temporary.tick(); assert.ok(f.deletes.includes(message.id));
  release(f.members); await rescan; f.ctx.db.close();
});

test('initial preload and restart do not DM existing role holders', async () => {
  const f = fixture(); f.addMember(ALICE, [roleId]); f.ctx.members.initialize(f.members.values());
  await f.ctx.roleReminders.tick(); f.ctx.roleReminders = new RoleReminderService(f.ctx);
  f.ctx.members.initialize(f.members.values()); await f.ctx.roleReminders.tick();
  assert.equal(f.dms.length, 0); assert.equal(state(f), undefined); f.ctx.db.close();
});

test('a new role grant sends one username DM and channel button without remove/readd spam', async () => {
  const f = fixture(); f.ctx.members.initialize(f.members.values()); grant(f); await settle();
  assert.equal(f.dms.length, 1); assert.equal(f.dms[0].userId, ALICE); assert.equal(state(f), 'sent');
  const embed = json(f.dms[0].payload.embeds![0]) as APIEmbed;
  assert.equal(embed.title, 'Roblox Username Required'); assert.match(embed.description!, /1556640581613260810/);
  assert.match(embed.description!, /display name/); assert.equal(embed.footer, undefined);
  const row = json(f.dms[0].payload.components![0]) as { components: { url: string }[] };
  assert.equal(row.components[0].url, `https://discord.com/channels/${GUILD}/1556640581613260810`);
  const before = f.members.get(ALICE)!; const removed = f.addMember(ALICE); f.ctx.roleReminders.transition(before, removed); grant(f); await settle();
  f.ctx.roleReminders = new RoleReminderService(f.ctx); await f.ctx.roleReminders.tick(); assert.equal(f.dms.length, 1); f.ctx.db.close();
});

test('raw role capture sees grants before SDK mutation and duplicate updates never send a second DM', async () => {
  const f = fixture(); f.ctx.members.initialize(f.members.values()); installEvents(f.ctx);
  const packet = { t: 'GUILD_MEMBER_UPDATE', d: { guild_id: GUILD, user: { id: ALICE }, roles: [roleId] } };
  (f.ctx.client as unknown as EventEmitter).emit('raw', packet);
  f.members.get(ALICE)!.roles.cache.set(roleId, { id: roleId } as never); await settle();
  (f.ctx.client as unknown as EventEmitter).emit('raw', packet); await settle(); assert.equal(f.dms.length, 1); f.ctx.db.close();
});

test('unknown role snapshots create a baseline; new audit grants are definitive while pre-rollout audits are ignored', async () => {
  const f = fixture(); const member = f.members.get(ALICE)!; f.members.delete(ALICE);
  f.ctx.roleReminders.raw({ t: 'GUILD_MEMBER_UPDATE', d: { guild_id: GUILD, user: { id: ALICE }, roles: [roleId] } });
  assert.equal(state(f), undefined); f.members.set(ALICE, member); member.roles.cache.set(roleId, { id: roleId } as never);
  const entry = { action: AuditLogEvent.MemberRoleUpdate, targetId: ALICE, createdTimestamp: Date.now(), changes: [{ key: '$add', new: [{ id: roleId }] }] } as GuildAuditLogsEntry;
  f.ctx.roleReminders.audit({ ...entry, createdTimestamp: f.ctx.startedAt - 1 } as GuildAuditLogsEntry); await settle(); assert.equal(f.dms.length, 0);
  f.ctx.roleReminders.audit(entry); await settle(); f.ctx.roleReminders.audit(entry); await settle(); assert.equal(f.dms.length, 1); f.ctx.db.close();
});

test('a fresh audit grant can notify after baseline without a cached member update', async () => {
  const f = fixture(); f.ctx.members.initialize(f.members.values()); f.addMember(ALICE, [roleId]);
  f.ctx.roleReminders.audit({ action: AuditLogEvent.MemberRoleUpdate, targetId: ALICE, createdTimestamp: Date.now(), changes: [{ key: '$add', new: [{ id: roleId }] }] } as GuildAuditLogsEntry);
  await settle(); assert.equal(f.dms.length, 1); f.ctx.db.close();
});

test('transient role DM errors retry after restart; blocked DMs terminate without public spam', async () => {
  const f = fixture(); f.ctx.members.initialize(f.members.values()); f.setDmError(500); grant(f); await settle();
  assert.equal(state(f), 'pending'); f.ctx.roleReminders = new RoleReminderService(f.ctx); f.setDmError();
  await f.ctx.roleReminders.tick(Date.now() + 4000); await settle(); assert.equal(state(f), 'sent');
  f.setDmError(50007); grant(f, BOB); await settle(); assert.equal(state(f, BOB), 'closed');
  f.setDmError(); await f.ctx.roleReminders.tick(Date.now() + 40000); await settle();
  assert.equal(f.dms.length, 1); assert.equal(f.sent.length, 0); f.ctx.db.close();
});

test('role removal and departed members prevent delayed delivery', async () => {
  const f = fixture(); f.ctx.members.initialize(f.members.values()); f.ctx.stopping = true;
  const after = grant(f); const removed = f.addMember(ALICE); f.ctx.roleReminders.transition(after, removed);
  grant(f, BOB); f.members.delete(BOB); f.ctx.stopping = false; await f.ctx.roleReminders.tick();
  assert.equal(f.dms.length, 0); assert.equal(state(f), 'waiting'); assert.equal(state(f, BOB), 'waiting'); f.ctx.db.close();
});

test('background baseline refresh cannot overwrite a live grant', async () => {
  const f = fixture(); f.ctx.members.initialize(f.members.values()); f.ctx.stopping = true;
  const stale = f.members.get(ALICE)!; grant(f); f.ctx.roleReminders.baseline(stale);
  assert.equal(f.ctx.db.get<{ has_role: number }>('SELECT has_role FROM member_role_state WHERE user_id=?', ALICE)!.has_role, 1);
  f.ctx.stopping = false; await f.ctx.roleReminders.tick(); assert.equal(f.dms.length, 1); f.ctx.db.close();
});

test('new joins with the target role are eligible while bots and other roles are ignored', async () => {
  const f = fixture(); f.ctx.roleReminders.onJoin(f.addMember(ALICE, [roleId], false, Date.now()));
  f.ctx.roleReminders.onJoin(f.members.get(BOT)!); f.ctx.roleReminders.onJoin(f.addMember(BOB, [config.usernameReminder.roleId]));
  await settle(); assert.equal(f.dms.length, 1); assert.equal(state(f, BOB), undefined); f.ctx.db.close();
});

test('a role revoked during a slow user fetch cancels the pending DM even within one clock millisecond', async () => {
  const f = fixture(); f.ctx.members.initialize(f.members.values());
  let release!: () => void; const fetch = f.ctx.client.users.fetch.bind(f.ctx.client.users);
  f.ctx.client.users.fetch = (async (...args: unknown[]) => { await new Promise<void>(resolve => { release = resolve; }); return fetch(args[0] as string); }) as typeof fetch;
  const after = grant(f); await settle(); f.ctx.roleReminders.transition(after, f.addMember(ALICE));
  release(); await settle(); assert.equal(f.dms.length, 0); assert.equal(state(f), 'waiting'); f.ctx.db.close();
});

test('schema 7 migration preserves activity, role overrides and legacy deletion jobs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'goat-v24-')); const path = join(directory, 'goat.sqlite');
  let db = new Store(path); const f = fixture(); const s = snapshotMessage(present(f, 'Saved evidence')); db.recordMessage(s, 'live');
  db.run('INSERT INTO link_filter_roles VALUES(?,?,?,?,?)', GUILD, roleId, 1, STAFF, Date.now());
  db.run('INSERT INTO link_filter_jobs(message_id,guild_id,channel_id,snapshot,reason,created_at) VALUES(?,?,?,?,?,?)', s.id, GUILD, s.channelId, JSON.stringify(s), 'Saved', Date.now());
  db.run('ALTER TABLE link_filter_jobs DROP COLUMN kind'); db.setMeta('schema_version', '6'); db.close();
  db = new Store(path); assert.equal(db.meta('schema_version'), '8'); assert.equal(db.count(GUILD, ALICE), 1);
  assert.ok(db.get('SELECT 1 FROM link_filter_roles')); assert.equal(db.get<{ kind: string }>('SELECT kind FROM link_filter_jobs')!.kind, 'link');
  db.close(); f.ctx.db.close(); rmSync(directory, { recursive: true, force: true });
});

test('unbranded embeds still recover legacy username markers and accept full 256-character custom titles', () => {
  assert.equal(goatEmbed('News').toJSON().title, 'News'); assert.equal(goatEmbed('News').toJSON().footer, undefined);
  for (const prefix of ['', 'GOAT • ']) assert.equal(archiveSource({ embeds: [{ footer: { text: `${prefix}Username Archive • Source: ${ALICE}` } }] } as Message), ALICE);
  const embed = customEmbedPayload({ title: 'a'.repeat(256), description: 'Hello', outside: '', image: '', color: '' }).embeds![0] as APIEmbed;
  assert.equal(embed.title?.length, 256); assert.equal(embed.footer, undefined);
});

test('help category buttons provide private instructions without member REST or editing the shared message', async () => {
  const f = fixture(); f.ctx.guild.members.fetch = (() => { throw new Error('No member REST needed'); }) as typeof f.ctx.guild.members.fetch;
  const interaction = Object.assign(f.interaction(), { customId: 'goat:help:page:tickets', isAutocomplete: () => false, isChatInputCommand: () => false,
    isModalSubmit: () => false, isButton: () => true, isRepliable: () => true }); await routeInteraction(f.ctx, interaction);
  const replies = (interaction as unknown as { replies: { flags: number; embeds: { toJSON(): APIEmbed }[] }[] }).replies;
  assert.equal(replies[0].flags, MessageFlags.Ephemeral); assert.equal(replies[0].embeds[0].toJSON().title, 'Tickets');
  assert.match(replies[0].embeds[0].toJSON().description!, /start-vote/);
  for (const id of config.access.staffRoleIds.concat(config.access.ownerUserIds)) assert.ok(!JSON.stringify(helpPanel()).includes(id)); f.ctx.db.close();
});

test('grouped ticket commands acknowledge and enforce fresh access while preserving old aliases', async () => {
  const f = fixture(); const grouped = commandDefinitions.find(command => command.name === 'ticket')!.toJSON();
  assert.equal(grouped.options?.length, 9); assert.equal(grouped.default_member_permissions, null);
  const command = (userId: string) => Object.assign(f.interaction(userId), { commandName: 'ticket', options: { getSubcommand: () => 'panel' },
    isAutocomplete: () => false, isChatInputCommand: () => true, isRepliable: () => true });
  const ordinary = command(ALICE); await routeInteraction(f.ctx, ordinary); assert.equal(f.ctx.db.meta('ticket_panel_message_id'), undefined);
  const replies = (ordinary as unknown as { replies: { embeds: { toJSON(): APIEmbed }[] }[] }).replies;
  assert.equal(replies[0].embeds[0].toJSON().title, 'Action Unavailable');
  await routeInteraction(f.ctx, command(STAFF)); assert.ok(f.ctx.db.meta('ticket_panel_message_id'));
  assert.ok(commandDefinitions.some(item => item.name === 'ticket-panel')); f.ctx.db.close();
});

test('ticket panel updates in place and clearly presents username, AFK question and manual Start Vote', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const first = f.ctx.db.meta('ticket_panel_message_id');
  f.ctx.db.setMeta('ticket_panel_version', '2.3.0'); await f.ctx.tickets.ensurePanel();
  assert.equal(f.ctx.db.meta('ticket_panel_message_id'), first); assert.equal(f.sent.length, 1);
  const ticket = await f.openTicket('application'); const message = f.channels.get(ticket.channel_id!)!.messageCache.get(ticket.opening_message_id!)!;
  assert.equal(message.embeds[0].title, 'Clan Application #0001'); assert.match(message.embeds[0].description!, /## @Stormy_123/);
  assert.match(message.embeds[0].description!, /AFK 24\/7/); assert.ok(message.embeds[0].fields?.find(field => field.name === 'Member')?.value.includes(ALICE));
  const row = message.components[0];
  const buttons = 'components' in row ? row.components.map(button => 'customId' in button ? button.customId : null) : [];
  assert.ok(buttons.includes('goat:ticket:start-vote:1')); assert.ok(!buttons.some(value => value?.includes('approve') || value?.includes('reject')));
  await f.startVote(ticket.id); const review = f.ctx.tickets.votes.get(ticket.id)!; const panel = votePanel(ticket, review).embeds[0].toJSON();
  assert.equal(review.ends_at - review.started_at!, 180000); assert.equal(panel.fields?.find(field => field.name === 'Yes')?.value, '**0 / 3**');
  assert.ok(!panel.title?.startsWith('GOAT')); assert.ok(!panel.footer?.text.startsWith('GOAT')); f.ctx.db.close();
});
