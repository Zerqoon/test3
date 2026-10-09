import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ButtonStyle, Collection, EmbedType, MessageFlags, type APIEmbed, type Message } from 'discord.js';
import { config, configSchema } from '../src/core/config.js';
import { snapshotMessage } from '../src/core/messages.js';
import { VERSION } from '../src/core/version.js';
import { Store } from '../src/core/store.js';
import { commandDefinitions } from '../src/commands/definitions.js';
import { routeInteraction } from '../src/commands/router.js';
import { ClanIntakeService } from '../src/services/clan-intake.js';
import { TicketService, ticketPanel } from '../src/services/tickets.js';
import { linkViolation } from '../src/services/link-filter.js';
import { fixture, ALICE, BOB, GUILD, STAFF } from './harness.js';

const blockedRole = '1557809384166391918';
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
const intake = (f: ReturnType<typeof fixture>) => f.ctx.tickets.intake.status();
function panelButtons(f: ReturnType<typeof fixture>) { return ticketPanel(intake(f)).components[0].toJSON().components; }
function present(f: ReturnType<typeof fixture>, content: string, channelId = config.tickets.panelChannelId, index = 5000) {
  const message = Object.assign(f.original(channelId, index, content), { createdTimestamp: Date.now() - 1000 });
  f.channels.get(channelId)!.messageCache.set(message.id, message); return message;
}
function command(f: ReturnType<typeof fixture>, name: string, userId = STAFF, count?: number) {
  return Object.assign(f.interaction(userId), { commandName: name, options: { getInteger: () => count },
    isAutocomplete: () => false, isChatInputCommand: () => true, isRepliable: () => true });
}
function replies(i: ReturnType<typeof command>) {
  return (i as unknown as { replies: { embeds: { toJSON(): APIEmbed }[] }[] }).replies;
}

test('2.5 upgrades old configs with both blacklist restrictions and registers bounded visible commands', () => {
  const legacy = structuredClone(config) as Record<string, unknown>;
  const ticketConfig = legacy.tickets as Record<string, unknown>; delete ticketConfig.clanBlacklistRoleIds;
  const linkConfig = legacy.linkFilter as Record<string, unknown>; delete linkConfig.gifBlockedRoleIds;
  const upgraded = configSchema.parse(legacy);
  assert.deepEqual(upgraded.tickets.clanBlacklistRoleIds, [blockedRole]);
  assert.deepEqual(upgraded.linkFilter.gifBlockedRoleIds, [blockedRole]); assert.equal(VERSION, '2.6.0');
  assert.equal(commandDefinitions.length, 44);
  for (const name of ['clan-off', 'open-ticket', 'clan-status']) assert.equal(commandDefinitions.find(c => c.name === name)!.toJSON().default_member_permissions, null);
  const option = commandDefinitions.find(c => c.name === 'open-ticket')!.toJSON().options![0];
  assert.ok('min_value' in option && option.min_value === 1); assert.ok('max_value' in option && option.max_value === 20);
});

test('clan-off persists pause, removes the application button and keeps accurate occupancy', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const existing = await f.openTicket('application');
  const panelId = f.ctx.db.meta('ticket_panel_message_id');
  assert.equal(await f.ctx.tickets.setIntake(null, STAFF), true);
  const [support] = panelButtons(f);
  assert.ok('label' in support && support.label === 'Support');
  assert.equal(support.style, ButtonStyle.Primary); assert.equal(support.disabled, undefined);
  assert.equal(panelButtons(f).length, 1); assert.equal(intake(f).displayUsed, 1);
  assert.match(ticketPanel(intake(f)).embeds[0].toJSON().fields![0].value, /Recruitment Closed/);
  assert.equal(f.ctx.tickets.get(existing.id).state, 'open');
  assert.equal(f.ctx.db.meta('ticket_panel_message_id'), panelId);
  await assert.rejects(f.ctx.tickets.open(f.interaction(BOB), 'application'), /currently closed/);
  assert.equal((await f.openTicket('support', BOB)).state, 'open');
  f.ctx.tickets = new TicketService(f.ctx); assert.equal(intake(f).enabled, false); assert.equal(intake(f).reserved, 1);
  f.ctx.db.close();
});

test('open-ticket count denotes free places, validates 1–20 and cannot erase active reservations', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.openTicket('application');
  await f.ctx.tickets.setIntake(5, STAFF);
  assert.equal(intake(f).available, 5); assert.equal(intake(f).displayUsed, 15); assert.equal(intake(f).occupied, 14); assert.equal(intake(f).reserved, 1);
  const clan = panelButtons(f)[0]; assert.ok('label' in clan && clan.label === 'Clan Application · 15/20');
  const before = intake(f);
  for (const n of [0, 21, 1.5, NaN]) assert.throws(() => f.ctx.tickets.intake.open(n, STAFF), /1 and 20/);
  assert.throws(() => f.ctx.tickets.intake.open(20, STAFF), /reserved applications/);
  assert.deepEqual(intake(f), before); f.ctx.db.close();
});

test('simultaneous submissions atomically reserve at most twenty places and roll back the losing form', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel();
  const forms = [];
  for (let index = 0; index < 21; index++) {
    const userId = String(1550000000000300000n + BigInt(index)); f.addMember(userId);
    forms.push(await f.form('application', userId, `Player_${index + 1}`));
  }
  const results = await Promise.allSettled(forms.map(form => f.ctx.tickets.openModal(form.modal, form.requestId)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 20);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(intake(f).reserved, 20); assert.equal(intake(f).available, 0);
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM tickets')!.n, 20);
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM ticket_requests WHERE ticket_id IS NULL')!.n, 1);
  await f.ctx.tickets.tick(); assert.equal(panelButtons(f).length, 1);
  const support = panelButtons(f)[0]; assert.ok('label' in support && support.label === 'Support');
  f.ctx.db.close();
});

test('a stale form cannot create a clan ticket after clan-off, while Support still opens', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const form = await f.form('application');
  await f.ctx.tickets.setIntake(null, STAFF);
  await assert.rejects(f.ctx.tickets.openModal(form.modal, form.requestId), /currently closed/);
  assert.equal(intake(f).reserved, 0); assert.equal(f.ctx.db.get('SELECT 1 FROM tickets'), undefined);
  assert.equal((await f.openTicket('support', BOB)).kind, 'support'); f.ctx.db.close();
});

test('a stale form cannot claim a final place already reserved by another applicant', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.ctx.tickets.setIntake(1, STAFF);
  const first = await f.form('application'); const second = await f.form('application', BOB);
  await f.ctx.tickets.openModal(first.modal, first.requestId);
  await assert.rejects(f.ctx.tickets.openModal(second.modal, second.requestId), /clan is full/);
  assert.equal(intake(f).used, 20); assert.equal(intake(f).reserved, 1); f.ctx.db.close();
});

test('fresh blacklist roles deny the Clan form, including staff, but do not deny Support', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); f.addMember(ALICE, [blockedRole]);
  await assert.rejects(f.ctx.tickets.open(f.interaction(), 'application'), /cannot create a clan application/);
  f.addMember(STAFF, [blockedRole, config.access.staffRoleIds[0]]);
  await assert.rejects(f.ctx.tickets.open(f.interaction(STAFF), 'application'), /cannot create a clan application/);
  assert.equal((await f.openTicket('support')).state, 'open'); assert.equal(intake(f).reserved, 0);
  f.ctx.db.close();
});

test('blacklist granted after opening the form is rechecked on submit without reserving a place', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const form = await f.form('application'); f.addMember(ALICE, [blockedRole]);
  await assert.rejects(f.ctx.tickets.openModal(form.modal, form.requestId), /cannot create a clan application/);
  assert.equal(intake(f).reserved, 0); assert.equal(f.ctx.db.get('SELECT 1 FROM tickets'), undefined); f.ctx.db.close();
});

test('withdrawing and reopening an undecided application releases and reserves exactly one place', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.ctx.tickets.setIntake(1, STAFF);
  const ticket = await f.openTicket('application'); assert.equal(intake(f).available, 0);
  await f.ctx.tickets.close(ticket.id, ALICE, 'Withdrawn'); assert.equal(intake(f).available, 1);
  await f.ctx.tickets.button(f.interaction(STAFF, ticket.channel_id!), 'reopen', String(ticket.id));
  assert.equal(intake(f).available, 0); assert.equal(intake(f).reserved, 1);
  await f.ctx.tickets.close(ticket.id, ALICE, 'Withdrawn again'); assert.equal(intake(f).reserved, 0);
  await f.ctx.tickets.setIntake(null, STAFF);
  await assert.rejects(f.ctx.tickets.button(f.interaction(STAFF, ticket.channel_id!), 'reopen', String(ticket.id)), /currently closed/);
  assert.equal(f.ctx.tickets.get(ticket.id).state, 'closed'); assert.equal(intake(f).reserved, 0); f.ctx.db.close();
});

test('an application cannot reopen when its owner receives the blacklist role', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('application');
  await f.ctx.tickets.close(ticket.id, ALICE, 'Later'); f.addMember(ALICE, [blockedRole]);
  await assert.rejects(f.ctx.tickets.button(f.interaction(STAFF, ticket.channel_id!), 'reopen', String(ticket.id)), /cannot create/);
  assert.equal(intake(f).reserved, 0); assert.equal(f.ctx.tickets.get(ticket.id).state, 'closed'); f.ctx.db.close();
});

test('manual rejection frees a place even while recruitment is paused and preserves its pause', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('application');
  await f.ctx.tickets.setIntake(null, STAFF); await f.ctx.tickets.votes.decide(ticket.id, 'rejected', STAFF, 'Missing requirements');
  assert.equal(intake(f).enabled, false); assert.equal(intake(f).reserved, 0); assert.equal(intake(f).occupied, 0);
  assert.equal(f.ctx.tickets.get(ticket.id).state, 'closed'); assert.equal(f.dms.length, 1); f.ctx.db.close();
});

test('acceptance consumes its reservation once across retries, DM failures and channel removal', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.ctx.tickets.setIntake(1, STAFF);
  const ticket = await f.openTicket('application'); f.setDmError(50007);
  await f.ctx.tickets.votes.decide(ticket.id, 'accepted', STAFF, 'Welcome');
  assert.equal(intake(f).occupied, 20); assert.equal(intake(f).reserved, 0); assert.equal(intake(f).available, 0);
  f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.votes.tick();
  f.ctx.tickets.channelDeleted(ticket.channel_id!); f.ctx.tickets.channelDeleted(ticket.channel_id!);
  assert.equal(intake(f).occupied, 20); assert.equal(f.ctx.tickets.votes.get(ticket.id)!.dm_status, 'unavailable');
  await assert.rejects(f.ctx.tickets.votes.decide(ticket.id, 'accepted', STAFF, 'Again'), /Only an open/); f.ctx.db.close();
});

test('three Yes votes save the verdict and the occupied place atomically before slow closure', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('application'); await f.startVote(ticket.id);
  const third = '1550000000000300011'; f.addMember(third);
  for (const voter of [BOB, STAFF, third]) await f.ctx.tickets.votes.vote(f.voteInteraction(voter, ticket.id), ticket.id, 'yes');
  assert.equal(f.ctx.tickets.votes.get(ticket.id)!.decision, 'accepted'); assert.equal(intake(f).occupied, 1); assert.equal(intake(f).reserved, 0);
  await f.ctx.tickets.votes.tick(); assert.equal(f.ctx.tickets.get(ticket.id).state, 'closed'); assert.equal(intake(f).occupied, 1); f.ctx.db.close();
});

test('three No votes release the reservation before closure and reopening recruitment can offer the freed place', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); await f.ctx.tickets.setIntake(1, STAFF);
  const ticket = await f.openTicket('application'); await f.startVote(ticket.id); const third = '1550000000000300011'; f.addMember(third);
  for (const voter of [BOB, STAFF, third]) await f.ctx.tickets.votes.vote(f.voteInteraction(voter, ticket.id), ticket.id, 'no');
  assert.equal(intake(f).available, 1); assert.equal(intake(f).occupied, 19); assert.equal(intake(f).reserved, 0);
  await f.ctx.tickets.votes.tick(); await f.ctx.tickets.ensurePanel(); assert.equal(panelButtons(f)[0].disabled, undefined); f.ctx.db.close();
});

test('channel removal and owner departure release undecided and pending reservations', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('application');
  f.ctx.tickets.channelDeleted(ticket.channel_id!); assert.equal(intake(f).reserved, 0);
  const request = await f.form('application', BOB); f.setSendFailure(true);
  await assert.rejects(f.ctx.tickets.openModal(request.modal, request.requestId));
  assert.equal(intake(f).reserved, 1);
  const pending = f.ctx.db.get<{ id: number; channel_id: string | null }>("SELECT * FROM tickets WHERE owner_id=?", BOB)!;
  // Simulate an interruption before Discord created the channel.
  f.ctx.db.run('UPDATE tickets SET channel_id=NULL WHERE id=?', pending.id); f.members.delete(BOB); f.setSendFailure(false);
  await f.ctx.tickets.tick(); assert.equal(intake(f).reserved, 0); assert.equal(f.ctx.tickets.get(pending.id).state, 'cancelled'); f.ctx.db.close();
});

test('saved recruitment settings survive a failed panel edit and update the same panel on recovery', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const id = f.ctx.db.meta('ticket_panel_message_id');
  const message = f.channels.get(config.tickets.panelChannelId)!.messageCache.get(id!)!; const edit = message.edit;
  message.edit = async () => { throw new Error('No channel access'); };
  assert.equal(await f.ctx.tickets.setIntake(null, STAFF), false); assert.equal(intake(f).enabled, false);
  assert.notEqual(f.ctx.db.meta('ticket_panel_intake_revision'), String(intake(f).revision));
  message.edit = edit; f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.ensurePanel();
  assert.equal(f.ctx.db.meta('ticket_panel_message_id'), id); assert.equal(f.ctx.db.meta('ticket_panel_intake_revision'), String(intake(f).revision));
  assert.equal(f.sent.filter(item => item.channelId === config.tickets.panelChannelId).length, 1); f.ctx.db.close();
});

test('panel edits cannot mark a newer recruitment revision as rendered during an in-flight edit', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const id = f.ctx.db.meta('ticket_panel_message_id');
  const message = f.channels.get(config.tickets.panelChannelId)!.messageCache.get(id!)!; const edit = message.edit;
  let resume = () => {}; let started = () => {};
  const gate = new Promise<void>(resolve => { resume = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
  message.edit = async (...args) => { started(); await gate; return edit(...args); };
  f.ctx.tickets.intake.open(5, STAFF); const first = f.ctx.tickets.ensurePanel(); await entered;
  f.ctx.tickets.intake.open(3, STAFF); resume(); await first;
  assert.notEqual(f.ctx.db.meta('ticket_panel_intake_revision'), String(intake(f).revision));
  message.edit = edit; await f.ctx.tickets.ensurePanel(); assert.equal(f.ctx.db.meta('ticket_panel_intake_revision'), String(intake(f).revision)); f.ctx.db.close();
});

test('slow transcript capture cannot hold up the independent recruitment panel worker', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('support');
  const channel = f.channels.get(ticket.channel_id!)!; const fetch = channel.messages.fetch;
  let resume = () => {}; let started = () => {};
  const gate = new Promise<void>(resolve => { resume = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
  channel.messages.fetch = async arg => { if (typeof arg !== 'string') { started(); await gate; } return fetch(arg); };
  const closing = f.ctx.tickets.close(ticket.id, ALICE, 'Resolved'); await entered;
  const worker = f.ctx.tickets.tick(); await settle();
  f.ctx.tickets.intake.open(5, STAFF); f.ctx.tickets.intakeChanged(); f.ctx.tickets.start();
  try {
    await new Promise(resolve => setTimeout(resolve, 1150));
    assert.equal(f.ctx.tickets.get(ticket.id).state, 'closing');
    assert.equal(f.ctx.db.meta('ticket_panel_intake_revision'), String(intake(f).revision));
    assert.equal(intake(f).available, 5);
  } finally {
    f.ctx.tickets.stop(); resume(); await closing; await worker; await settle(); f.ctx.db.close();
  }
});

test('upgrade seeds existing undecided clan applications without duplicating seats or changing decisions', () => {
  const f = fixture(); f.ctx.db.run('DELETE FROM clan_intake');
  for (const [kind, state, owner] of [['application', 'open', ALICE], ['support', 'open', BOB], ['application', 'closed', STAFF]] as const) {
    f.ctx.db.run('INSERT INTO tickets(guild_id,owner_id,kind,state,created_at) VALUES(?,?,?,?,?)', GUILD, owner, kind, state, Date.now());
  }
  let service = new ClanIntakeService(f.ctx); assert.equal(service.status().reserved, 1);
  service = new ClanIntakeService(f.ctx); assert.equal(service.status().reserved, 1); assert.equal(service.status().available, 19);
  assert.equal(f.ctx.db.meta('schema_version'), '9'); f.ctx.db.close();
});

test('schema 7 upgrades on disk preserve activity, reservations, accepted places and pause across process restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'goat-v25-')); const path = join(directory, 'goat.sqlite');
  const f = fixture(); let db = new Store(path); db.recordMessage(snapshotMessage(present(f, 'Preserved activity')), 'live');
  const acceptedId = Number(db.run("INSERT INTO tickets(guild_id,owner_id,kind,state,created_at) VALUES(?,?,'application','open',?)", GUILD, ALICE, Date.now()).lastInsertRowid);
  db.run("INSERT INTO tickets(guild_id,owner_id,kind,state,created_at) VALUES(?,?,'application','open',?)", GUILD, BOB, Date.now());
  db.sqlite.exec('DROP TABLE clan_application_seats; DROP TABLE clan_intake;'); db.setMeta('schema_version', '7'); db.close();
  db = new Store(path); f.ctx.db.close(); f.ctx.db = db; f.ctx.tickets = new TicketService(f.ctx);
  assert.equal(intake(f).reserved, 2); db.transaction(() => f.ctx.tickets.intake.settle(acceptedId, true)); f.ctx.tickets.intake.close(STAFF); db.close();
  f.ctx.db = new Store(path); f.ctx.tickets = new TicketService(f.ctx);
  assert.equal(intake(f).occupied, 1); assert.equal(intake(f).reserved, 1); assert.equal(intake(f).enabled, false);
  assert.equal(f.ctx.db.count(GUILD, ALICE), 1); assert.equal(f.ctx.db.meta('schema_version'), '9'); f.ctx.db.close();
  rmSync(directory, { recursive: true, force: true });
});

test('legacy applications exceeding twenty remain intact and cannot accept a twenty-first member', async () => {
  const f = fixture(); f.ctx.db.run('DELETE FROM clan_intake');
  const ids: number[] = [];
  for (let index = 0; index < 21; index++) ids.push(Number(f.ctx.db.run('INSERT INTO tickets(guild_id,owner_id,kind,state,created_at) VALUES(?,?,\'application\',\'open\',?)', GUILD, String(1550000000000300000n + BigInt(index)), Date.now()).lastInsertRowid));
  f.ctx.tickets = new TicketService(f.ctx); assert.equal(intake(f).reserved, 21); assert.equal(intake(f).available, 0);
  for (const id of ids.slice(0, 20)) f.ctx.db.transaction(() => f.ctx.tickets.intake.settle(id, true));
  assert.equal(intake(f).occupied, 20);
  assert.throws(() => f.ctx.db.transaction(() => f.ctx.tickets.intake.settle(ids[20], true)), /20 occupied places/);
  await assert.rejects(f.ctx.tickets.votes.decide(ids[20], 'accepted', STAFF, 'Welcome'), /20 occupied places/);
  assert.equal(f.ctx.tickets.get(ids[20]).state, 'open'); assert.equal(intake(f).reserved, 1); f.ctx.db.close();
});

test('recruitment commands defer before authorization and preserve owner access without exposing access identities', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel();
  const denied = command(f, 'clan-off', ALICE); await routeInteraction(f.ctx, denied);
  assert.equal(intake(f).enabled, true); assert.match(replies(denied)[0].embeds[0].toJSON().title!, /Unavailable/); assert.equal(denied.deferred, true);
  const paused = command(f, 'clan-off', config.access.ownerUserIds[0]); await routeInteraction(f.ctx, paused); assert.equal(intake(f).enabled, false);
  const opened = command(f, 'open-ticket', STAFF, 5); await routeInteraction(f.ctx, opened); assert.equal(intake(f).available, 5);
  const status = command(f, 'clan-status'); await routeInteraction(f.ctx, status); assert.match(replies(status)[0].embeds[0].toJSON().title!, /Clan Recruitment/);
  for (const accessId of config.access.staffRoleIds.concat(config.access.ownerUserIds)) assert.ok(!JSON.stringify(ticketPanel(intake(f))).includes(accessId)); f.ctx.db.close();
});

test('Recruitment Status is private, rejects obsolete panels and needs no member lookup', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); f.ctx.guild.members.fetch = (() => { throw new Error('No REST for public status'); }) as typeof f.ctx.guild.members.fetch;
  const i = f.interaction(); await f.ctx.tickets.button(i, 'intake-status', 'current');
  const response = (i as unknown as { replies: { flags: number; embeds: { toJSON(): APIEmbed }[] }[] }).replies[0];
  assert.equal(response.flags, MessageFlags.Ephemeral); assert.match(response.embeds[0].toJSON().description!, /20 free places/);
  await assert.rejects(f.ctx.tickets.button(f.interaction(ALICE, config.tickets.panelChannelId, 'old'), 'intake-status', 'current'), /current ticket panel/); f.ctx.db.close();
});

for (const url of ['https://tenor.com/view/goat', 'https://giphy.com/gifs/goat', 'https://klipy.com/clips/goat', 'https://evil.example/a.gif']) {
  test(`GIF blacklist overrides approved providers, exception channels and staff: ${url}`, async () => {
    const f = fixture({ filter: true }); const member = f.addMember(ALICE, [blockedRole, config.access.staffRoleIds[0]]);
    const message = Object.assign(present(f, url, config.linkFilter.unrestrictedGifChannelIds[0]), { member });
    assert.equal(linkViolation(snapshotMessage(message), { ...config.linkFilter, staff: true, gifsAllowed: true, gifsBlocked: true })?.kind, 'gif-blocked');
    assert.equal(f.ctx.linkFilter.prepare(snapshotMessage(message)), true); await settle(); assert.ok(f.deletes.includes(message.id));
    const feedback = f.sent.find(item => item.channelId === message.channelId)!;
    assert.match(feedback.payload.content!, /GIFs are disabled for your account/); assert.ok(!feedback.payload.content!.includes(blockedRole));
    const expiry = f.ctx.db.get<{ delete_at: number }>('SELECT delete_at FROM temporary_messages')!;
    await f.ctx.temporary.tick(expiry.delete_at); assert.equal(f.ctx.db.get<{ state: string }>('SELECT state FROM filter_notices')!.state, 'sent'); f.ctx.db.close();
  });
}

test('blacklist blocks native GIF uploads and GIFV previews with no .gif URL, while plain text and allowed videos remain usable', async () => {
  const f = fixture({ filter: true }); f.addMember(ALICE, [blockedRole]);
  const gif = present(f, '', config.linkFilter.unrestrictedGifChannelIds[0]);
  gif.attachments = new Collection([['1', { id: '1', name: 'animation', contentType: 'image/gif', size: 50, url: 'https://cdn.discordapp.com/attachments/1/2/animation' }]]) as unknown as Message['attachments'];
  f.ctx.linkFilter.prepare(snapshotMessage(gif)); await settle(); assert.ok(f.deletes.includes(gif.id));
  const preview = present(f, 'https://example.net/animation', config.linkFilter.unrestrictedGifChannelIds[0], 5001);
  preview.embeds = [{ toJSON: () => ({ type: EmbedType.GIFV, url: preview.content, video: { url: 'https://example.net/clip.mp4' } }) }] as never;
  f.ctx.linkFilter.prepare(snapshotMessage(preview)); await settle(); assert.ok(f.deletes.includes(preview.id));
  for (const content of ['hello', 'https://youtube.com/watch?v=abc', 'https://roblox.com/users/1/profile']) {
    const s = snapshotMessage(present(f, content, config.tickets.panelChannelId, 5002)); assert.equal(f.ctx.linkFilter.prepare(s), false);
  }
  f.ctx.db.close();
});

test('GIF exception roles cannot override the blacklist and the blacklist cannot be installed as an exception', async () => {
  const f = fixture({ filter: true }); const exception = '1550000000000300020'; f.addMember(ALICE, [blockedRole, exception]);
  const role = await f.ctx.guild.roles.fetch(exception); f.ctx.linkFilter.setGifRole(role!, true, STAFF);
  const blocked = await f.ctx.guild.roles.fetch(blockedRole); assert.throws(() => f.ctx.linkFilter.setGifRole(blocked!, true, STAFF), /GIF restriction/);
  f.ctx.db.run('INSERT INTO link_filter_roles VALUES(?,?,?,?,?)', GUILD, blockedRole, 1, STAFF, Date.now());
  assert.ok(!f.ctx.linkFilter.gifRoles().includes(blockedRole));
  const message = present(f, 'https://tenor.com/view/goat'); f.ctx.linkFilter.prepare(snapshotMessage(message)); await settle();
  assert.ok(f.deletes.includes(message.id)); f.ctx.db.close();
});

test('fresh role lookup enforces new GIF restrictions and releases GIFs when the restriction was removed', async () => {
  const f = fixture({ filter: true }); const message = present(f, 'https://klipy.com/gifs/goat');
  f.addMember(ALICE, [blockedRole]); f.ctx.linkFilter.prepare(snapshotMessage(message)); await settle(); assert.ok(f.deletes.includes(message.id));
  const next = present(f, 'https://klipy.com/gifs/goat', config.tickets.panelChannelId, 5001);
  f.addMember(ALICE); assert.equal(f.ctx.linkFilter.prepare(snapshotMessage(next)), true); await settle(); assert.ok(!f.deletes.includes(next.id));
  assert.equal(f.ctx.db.get<{ state: string }>('SELECT state FROM link_filter_jobs WHERE message_id=?', next.id)!.state, 'allowed'); f.ctx.db.close();
});

test('GIF eligibility probing adds no member lookup for plain owner messages or non-GIF owner links', () => {
  const f = fixture({ filter: true }); f.ctx.guild.members.fetch = (() => { throw new Error('No extra REST for ordinary owner posts'); }) as typeof f.ctx.guild.members.fetch;
  for (const content of ['hello', 'https://evil.example/plain', 'discord.gg/other']) {
    const s = snapshotMessage(present(f, content)); s.authorId = config.access.ownerUserIds[0];
    assert.equal(f.ctx.linkFilter.prepare(s), false);
  }
  assert.equal(f.ctx.linkFilter.pending(), 0); f.ctx.db.close();
});
