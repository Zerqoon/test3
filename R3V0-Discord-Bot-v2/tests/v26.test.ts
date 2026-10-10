import test from 'node:test';
import assert from 'node:assert/strict';
import { Events, MessageType, PermissionFlagsBits, PermissionsBitField, type ChatInputCommandInteraction, type GuildMember, type Message } from 'discord.js';
import { config, configSchema } from '../src/core/config.js';
import { VERSION } from '../src/core/version.js';
import { commandDefinitions } from '../src/commands/definitions.js';
import { routeInteraction } from '../src/commands/router.js';
import { installEvents } from '../src/events/install.js';
import { supportAvailability } from '../src/services/support-hours.js';
import { TicketService, ticketPanel } from '../src/services/tickets.js';
import { BoostService, boostEmbed } from '../src/services/boosts.js';
import { RULES_TITLE, RulesService, rulesEmbeds } from '../src/services/rules.js';
import { embedCharacters } from '../src/services/logs.js';
import { fixture, ALICE, BOB, STAFF, BOT, GUILD } from './harness.js';

const hours = { enabled: true, startHour: 15, endHour: 22 };
const local = (time: string, date = '2026-10-10', offset = '+02:00') => Date.parse(`${date}T${time}${offset}`);
function scheduled(time = '14:59:59') {
  const f = fixture(); let now = local(time);
  f.ctx.config.tickets.supportHours.enabled = true;
  f.ctx.tickets = new TicketService(f.ctx, () => now);
  return { ...f, setTime: (time: string) => { now = local(time); } };
}
function buttons(message: Message) {
  return message.components.flatMap(row => 'components' in row ? row.components.map(c => 'customId' in c ? c.customId : '') : []);
}
function boostMessage(f: ReturnType<typeof fixture>, id = 9000, type = MessageType.GuildBoost, userId = ALICE) {
  return { ...f.original(f.ctx.config.boosts.channelId, id), author: f.members.get(userId)!.user, type,
    createdTimestamp: Date.now(), webhookId: null } as Message;
}
function boosted(f: ReturnType<typeof fixture>, userId = ALICE) {
  const before = f.members.get(userId)!;
  const after = { ...before, premiumSinceTimestamp: Date.now() } as GuildMember;
  return { before, after };
}
function pendingBoosts(f: ReturnType<typeof fixture>) {
  return f.ctx.db.all<{ payload: string }>("SELECT payload FROM log_outbox WHERE dedupe_key LIKE 'boost-thanks:%'");
}
function slash(f: ReturnType<typeof fixture>, name: string, userId = STAFF, options: Record<string, unknown> = {}) {
  return Object.assign(f.interaction(userId), { commandName: name,
    isChatInputCommand: () => true, isAutocomplete: () => false, isButton: () => false, isModalSubmit: () => false, isRepliable: () => true,
    options: { getUser: (name: string) => name === 'user' ? f.members.get(ALICE)!.user : null,
      getString: (name: string) => options[name] ?? null, getInteger: (name: string) => options[name] ?? null,
      getBoolean: (name: string) => options[name] ?? null, getSubcommand: () => options.subcommand }
  }) as unknown as ChatInputCommandInteraction;
}

test('2.6 config upgrades add requested channels, default hours and guarded commands', () => {
  const legacy = structuredClone(config) as Record<string, unknown>;
  delete legacy.boosts; delete legacy.rules; delete (legacy.tickets as Record<string, unknown>).supportHours;
  const upgraded = configSchema.parse(legacy);
  assert.deepEqual(upgraded.tickets.supportHours, hours);
  assert.equal(upgraded.boosts.channelId, '1558251766770962453'); assert.equal(upgraded.rules.channelId, '1557875144855396353');
  assert.equal(VERSION, '2.6.1'); assert.equal(commandDefinitions.length, 44);
  for (const name of ['support-open', 'rules-refresh', 'boost-preview']) {
    const cmd = commandDefinitions.find(c => c.name === name)!.toJSON(); assert.equal(cmd.default_member_permissions, null);
  }
  const invalid = structuredClone(config); invalid.tickets.supportHours.endHour = 15;
  assert.equal(configSchema.safeParse(invalid).success, false);
});

test('Support starts exactly at 3 PM and stops exactly at 10 PM in Warsaw', () => {
  for (const [time, open] of [['00:00:00', false], ['14:59:59', false], ['15:00:00', true], ['21:59:59', true], ['22:00:00', false]] as const) {
    const s = supportAvailability(hours, 'Europe/Warsaw', local(time)); assert.equal(s.open, open, time); assert.equal(s.hours, '3 PM–10 PM');
  }
  assert.equal(supportAvailability(hours, 'Europe/Warsaw', local('14:59:59')).nextOpenAt, local('15:00:00'));
  assert.equal(supportAvailability(hours, 'Europe/Warsaw', local('22:00:00')).nextOpenAt, local('15:00:00', '2026-10-11'));
});

test('Support uses DST calendar days and works across both clock-change weekends', () => {
  for (const [date, offset, utc] of [['2026-03-29', '+02:00', '13:00:00Z'], ['2026-10-25', '+01:00', '14:00:00Z']] as const) {
    const before = supportAvailability(hours, 'Europe/Warsaw', local('14:59:59', date, offset));
    assert.equal(before.nextOpenAt, Date.parse(`${date}T${utc}`));
    assert.equal(supportAvailability(hours, 'Europe/Warsaw', local('15:00:00', date, offset)).open, true);
  }
  const spring = supportAvailability(hours, 'Europe/Warsaw', local('22:00:00', '2026-03-28', '+01:00'));
  assert.equal(spring.nextOpenAt, local('15:00:00', '2026-03-29', '+02:00'));
  const autumn = supportAvailability(hours, 'Europe/Warsaw', local('22:00:00', '2026-10-24', '+02:00'));
  assert.equal(autumn.nextOpenAt, local('15:00:00', '2026-10-25', '+01:00'));
});

test('Unavailable choices disappear, and paused recruitment never invents 20/20 occupancy', () => {
  const closed = supportAvailability(hours, 'Europe/Warsaw', local('22:00:00'));
  const paused = ticketPanel({ accepting: false, available: 16, displayUsed: 4 }, closed);
  assert.equal(paused.components.length, 0); assert.match(paused.embeds[0].data.fields![0].value, /Recruitment Closed/);
  assert.doesNotMatch(paused.embeds[0].data.fields![0].value, /20\/20/);
  const full = ticketPanel({ accepting: false, available: 0, displayUsed: 20 }, closed);
  assert.equal(full.components.length, 0); assert.match(full.embeds[0].data.fields![0].value, /Clan Full · 20\/20/);
});

test('The same panel automatically gains and loses Support at the boundaries without repeated edits', async () => {
  const f = scheduled(); await f.ctx.tickets.ensurePanel(); await f.ctx.tickets.setIntake(null, STAFF);
  const id = f.ctx.db.meta('ticket_panel_message_id')!; const panel = f.channels.get(config.tickets.panelChannelId)!.messageCache.get(id)!;
  assert.deepEqual(buttons(panel), []);
  let edits = 0; const edit = panel.edit.bind(panel); panel.edit = (async payload => { edits++; return edit(payload); }) as Message['edit'];
  f.setTime('15:00:00'); await f.ctx.tickets.tick(); assert.deepEqual(buttons(panel), ['goat:ticket:open:support']);
  await f.ctx.tickets.tick(); assert.equal(edits, 1);
  f.setTime('22:00:00'); await f.ctx.tickets.tick(); assert.deepEqual(buttons(panel), []); assert.equal(edits, 2);
  assert.equal(f.ctx.db.meta('ticket_panel_message_id'), id); assert.equal(f.sent.length, 1); f.ctx.db.close();
});

test('Support stale clicks and forms cannot bypass hours while clan intake remains independent', async () => {
  const f = scheduled('21:59:59'); await f.ctx.tickets.ensurePanel(); const form = await f.form('support');
  f.setTime('22:00:00');
  await assert.rejects(f.ctx.tickets.openModal(form.modal, form.requestId), /Support is currently closed/);
  await assert.rejects(f.ctx.tickets.open(f.interaction(BOB), 'support'), /3 PM–10 PM/);
  assert.equal(f.ctx.db.get('SELECT 1 FROM tickets'), undefined);
  assert.equal((await f.openTicket('application', BOB)).state, 'open'); f.ctx.db.close();
});

test('Existing Support stays open after hours; closing removes every ticket control', async () => {
  const f = scheduled('16:00:00'); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('support');
  f.setTime('22:00:00'); await f.ctx.tickets.tick(); assert.equal(f.ctx.tickets.get(ticket.id).state, 'open');
  await f.ctx.tickets.open(f.interaction(ALICE), 'support'); assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM tickets')!.n, 1);
  await f.ctx.tickets.close(ticket.id, ALICE, 'Resolved');
  const opening = f.channels.get(ticket.channel_id!)!.messageCache.get(ticket.opening_message_id!)!;
  assert.deepEqual(buttons(opening), []); assert.match(opening.embeds[0].title!, /Ticket Closed/); f.ctx.db.close();
});

test('Restart recovers a panel with zero buttons even when its stored message ID is lost', async () => {
  const f = scheduled('22:00:00'); await f.ctx.tickets.ensurePanel(); await f.ctx.tickets.setIntake(null, STAFF);
  const id = f.ctx.db.meta('ticket_panel_message_id'); f.ctx.db.run("DELETE FROM meta WHERE key='ticket_panel_message_id'");
  f.ctx.tickets = new TicketService(f.ctx, () => local('22:00:00')); await f.ctx.tickets.ensurePanel();
  assert.equal(f.ctx.db.meta('ticket_panel_message_id'), id); assert.equal(f.sent.length, 1); f.ctx.db.close();
});

test('Staff can open private Support outside hours and during a clan pause with an audit reason', async () => {
  const f = scheduled('02:00:00'); await f.ctx.tickets.setIntake(null, STAFF);
  const result = await f.ctx.tickets.openSupportFor(ALICE, STAFF, 'Follow up on yesterday’s report', '@Stormy_123');
  assert.equal(result.created, true); assert.equal(result.ticket.kind, 'support'); assert.equal(result.ticket.roblox_username, 'Stormy_123');
  assert.equal(f.ctx.tickets.intake.status().reserved, 0);
  const channel = f.channels.get(result.ticket.channel_id!)!;
  assert.ok(new PermissionsBitField(channel.overwrites.find(row => row.id === GUILD)!.deny).has(PermissionFlagsBits.ViewChannel));
  assert.ok(new PermissionsBitField(channel.overwrites.find(row => row.id === ALICE)!.allow).has(PermissionFlagsBits.ViewChannel));
  const opening = channel.messageCache.get(result.ticket.opening_message_id!)!;
  assert.match(opening.embeds[0].fields.find(field => field.name === 'Opened by Staff')!.value, /Follow up/);
  assert.ok(f.ctx.db.get('SELECT 1 FROM ticket_support_overrides WHERE ticket_id=? AND actor_id=?', result.ticket.id, STAFF)); f.ctx.db.close();
});

test('Support exception checks fresh staff access, bots and usernames before creating a ticket', async () => {
  const f = scheduled('02:00:00');
  await assert.rejects(f.ctx.tickets.openSupportFor(BOB, ALICE, 'Help'), /restricted/);
  await assert.rejects(f.ctx.tickets.openSupportFor(BOT, STAFF, 'Help'), /Bots cannot/);
  await assert.rejects(f.ctx.tickets.openSupportFor(ALICE, STAFF, ' '), /reason/);
  await assert.rejects(f.ctx.tickets.openSupportFor(ALICE, STAFF, 'Help', 'Bad name'), /username/);
  assert.equal(f.ctx.db.get('SELECT 1 FROM tickets'), undefined);
  assert.equal((await f.ctx.tickets.openSupportFor(ALICE, config.access.ownerUserIds[0], 'Owner exception')).ticket.state, 'open'); f.ctx.db.close();
});

test('Concurrent staff exceptions and an already-open form still create one ticket per member', async () => {
  const f = scheduled('16:00:00'); await f.ctx.tickets.ensurePanel(); const form = await f.form('support');
  const results = await Promise.all([f.ctx.tickets.openSupportFor(ALICE, STAFF, 'Help'), f.ctx.tickets.openSupportFor(ALICE, STAFF, 'Help again'), f.ctx.tickets.openModal(form.modal, form.requestId)]);
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM tickets')!.n, 1);
  assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM ticket_support_overrides')!.n, Number(results[0].created) + Number(results[1].created)); f.ctx.db.close();
});

test('Staff bypass the member cooldown but retain the server queue cap and existing-ticket protection', async () => {
  const f = scheduled('16:00:00'); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('support');
  await f.ctx.tickets.close(ticket.id, ALICE, 'Later'); f.setTime('02:00:00');
  const reopened = await f.ctx.tickets.openSupportFor(ALICE, STAFF, 'Follow up'); assert.equal(reopened.created, true);
  const duplicate = await f.ctx.tickets.openSupportFor(ALICE, STAFF, 'Follow up twice'); assert.equal(duplicate.created, false);
  f.ctx.config.tickets.maxOpenTickets = 1;
  await assert.rejects(f.ctx.tickets.openSupportFor(BOB, STAFF, 'Help'), /queue is full/); f.ctx.db.close();
});

test('Support exception creation resumes after a send failure and preserves its staff reason', async () => {
  const f = scheduled('02:00:00'); f.setSendFailure(true);
  await assert.rejects(f.ctx.tickets.openSupportFor(ALICE, STAFF, 'Resume me'), /interruption/);
  assert.equal(f.ctx.tickets.get(1).state, 'creating');
  f.setSendFailure(false); f.ctx.tickets = new TicketService(f.ctx, () => local('02:00:00')); await f.ctx.tickets.tick();
  assert.equal(f.ctx.tickets.get(1).state, 'open'); assert.equal(f.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM ticket_support_overrides')!.n, 1); f.ctx.db.close();
});

test('Staff-only reopening works outside hours and stale owner buttons remain restricted', async () => {
  const f = scheduled('16:00:00'); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('support');
  await f.ctx.tickets.close(ticket.id, ALICE, 'Resolved'); f.setTime('02:00:00');
  await assert.rejects(f.ctx.tickets.button(f.interaction(ALICE, ticket.channel_id!), 'reopen', String(ticket.id)), /restricted/);
  await f.ctx.tickets.reopen(ticket.id, STAFF); assert.equal(f.ctx.tickets.get(ticket.id).state, 'open'); f.ctx.db.close();
});

test('Command deletion waits for delivered transcript evidence and uses no confirmation button', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const ticket = await f.openTicket('support');
  await f.ctx.tickets.close(ticket.id, ALICE, 'Resolved'); let acknowledged = false;
  await assert.rejects(f.ctx.tickets.deleteClosed(ticket.id, STAFF, async () => { acknowledged = true; }), /still being delivered/);
  assert.equal(acknowledged, false); assert.equal(f.deletes.length, 0);
  await f.ctx.logs.flush(); await f.ctx.logs.flush();
  await f.ctx.tickets.deleteClosed(ticket.id, STAFF, async () => { acknowledged = true; });
  assert.equal(acknowledged, true); assert.equal(f.ctx.tickets.get(ticket.id).state, 'deleted'); f.ctx.db.close();
});

test('New slash commands defer privately before authorization and ordinary members cannot invoke them', async () => {
  const f = fixture();
  for (const name of ['support-open', 'rules-refresh', 'boost-preview']) {
    const i = slash(f, name, ALICE, { reason: 'Help' }); await routeInteraction(f.ctx, i);
    assert.equal(i.deferred, true);
    assert.match(JSON.stringify((i as unknown as { replies: unknown[] }).replies), /restricted/);
  }
  assert.equal(f.ctx.db.get('SELECT 1 FROM tickets'), undefined);
  const force = slash(f, 'support-open', STAFF, { reason: 'Help' }); await routeInteraction(f.ctx, force);
  assert.equal(f.ctx.tickets.get(1).kind, 'support');
  const preview = slash(f, 'boost-preview', STAFF); await routeInteraction(f.ctx, preview);
  assert.match(JSON.stringify((preview as unknown as { replies: unknown[] }).replies), /Thank You for the Boost/);
  f.ctx.db.close();
});

test('Every boost system-message type produces one deduplicated individual thank-you', async () => {
  const f = fixture();
  for (const [index, type] of [MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3].entries()) {
    const message = boostMessage(f, 9000 + index, type); f.ctx.boosts.message(message); f.ctx.boosts.message(message);
  }
  assert.equal(pendingBoosts(f).length, 4);
  for (let index = 0; index < 4; index++) await f.ctx.logs.flush();
  const sent = f.sent.filter(item => item.channelId === config.boosts.channelId); assert.equal(sent.length, 4);
  for (const message of sent) assert.equal(message.payload.embeds!.length, 1); f.ctx.db.close();
});

test('Member first-boost fallback waits for the system message and survives a restart', () => {
  const f = fixture(); const { before, after } = boosted(f);
  f.ctx.boosts.transition(before, after); f.ctx.boosts.transition(before, after); assert.equal(pendingBoosts(f).length, 0);
  f.ctx.boosts = new BoostService(f.ctx); f.ctx.boosts.tick(Date.now() + 21000); f.ctx.boosts.tick(Date.now() + 22000);
  assert.equal(pendingBoosts(f).length, 1); f.ctx.db.close();
});

test('Member-first and message-first event ordering never double-thanks the same initial boost', () => {
  for (const order of ['member-first', 'message-first']) {
    const f = fixture(); const { before, after } = boosted(f); const message = boostMessage(f);
    if (order === 'member-first') { f.ctx.boosts.transition(before, after); f.ctx.boosts.message(message); }
    else { f.ctx.boosts.message(message); f.ctx.boosts.transition(before, after); }
    f.ctx.boosts.transition(before, after); f.ctx.boosts.message(message); f.ctx.boosts.tick(Date.now() + 21000);
    assert.equal(pendingBoosts(f).length, 1, order);
    f.ctx.boosts.message(boostMessage(f, 9001)); assert.equal(pendingBoosts(f).length, 2, 'A further actual boost remains a separate event'); f.ctx.db.close();
  }
});

test('Existing boosters, removals, bots, foreign guilds and ordinary messages produce no thank-you', () => {
  const f = fixture(); const { before, after } = boosted(f);
  f.ctx.boosts.transition(after, after); f.ctx.boosts.transition(after, before);
  f.ctx.boosts.transition(before, { ...after, premiumSinceTimestamp: f.ctx.startedAt - 86400000 } as GuildMember);
  f.ctx.boosts.message(boostMessage(f, 9000, MessageType.Default));
  f.ctx.boosts.message(boostMessage(f, 9001, MessageType.GuildBoost, BOT));
  f.ctx.boosts.message({ ...boostMessage(f, 9002), guildId: '1550000000000009999' } as Message);
  f.ctx.boosts.tick(Date.now() + 21000); assert.equal(pendingBoosts(f).length, 0); f.ctx.db.close();
});

test('Failed boost delivery retries through the persistent outbox without a second event', async () => {
  const f = fixture(); const message = boostMessage(f); f.ctx.boosts.message(message);
  f.setSendFailure(true); await f.ctx.logs.flush(); assert.equal(f.sent.length, 0);
  f.setSendFailure(false); f.ctx.boosts = new BoostService(f.ctx); f.ctx.boosts.message(message);
  await f.ctx.logs.flush(Date.now() + 60000); assert.equal(f.sent.filter(item => item.channelId === config.boosts.channelId).length, 1);
  assert.equal(pendingBoosts(f).length, 1); f.ctx.db.close();
});

test('Rules and boost embeds respect Discord limits and include all requested policies and links', () => {
  const rules = rulesEmbeds().map(e => e.toJSON()); assert.ok(embedCharacters(rules) < 6000);
  const text = JSON.stringify(rules);
  for (const phrase of ['Respectful', 'NSFW', 'Cross-Trading', 'Platform Rules', 'Phishing', 'Scams', 'discord.com/terms', 'discord.com/guidelines', 'Roblox-Terms-of-Use', '3 PM–10 PM']) assert.ok(text.includes(phrase), phrase);
  for (const embed of [...rules, boostEmbed({ id: ALICE, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' }).toJSON()]) {
    assert.ok(embed.title!.length <= 256); assert.ok((embed.fields?.length ?? 0) <= 25);
    for (const field of embed.fields ?? []) { assert.ok(field.name.length <= 256); assert.ok(field.value.length <= 1024); }
  }
  assert.equal(rulesEmbeds({ hours: '24/7', timezone: 'Europe/Warsaw' })[2].data.fields![2].value.includes('available 24/7'), true);
});

test('Rules publish once, refresh the same message and recover after a restart', async () => {
  const f = fixture(); const url = await f.ctx.rules.ensure(); const id = f.ctx.db.meta('rules_message_id')!;
  assert.match(url, new RegExp(id)); assert.equal(f.sent.length, 1);
  f.ctx.rules = new RulesService(f.ctx); await f.ctx.rules.ensure(); await f.ctx.rules.ensure(true);
  assert.equal(f.sent.length, 1); assert.equal(f.ctx.db.meta('rules_message_id'), id);
  const message = f.channels.get(config.rules.channelId)!.messageCache.get(id)!;
  assert.equal(message.embeds[0].title, RULES_TITLE); assert.equal(message.embeds.length, 3); assert.equal(message.components.length, 0); f.ctx.db.close();
});

test('Deleted rules are recreated with a new nonce and an unrelated human rules post is never modified', async () => {
  const f = fixture(); const channel = f.channels.get(config.rules.channelId)!;
  const human = { ...f.original(channel.id, 10), embeds: [{ title: RULES_TITLE }] } as Message;
  channel.messageCache.set(human.id, human);
  await f.ctx.rules.ensure(); const id = f.ctx.db.meta('rules_message_id')!;
  channel.messageCache.delete(id); f.ctx.rules.messageDeleted(id); await f.ctx.rules.tick();
  assert.equal(f.sent.length, 2); assert.notEqual(f.sent[0].payload.nonce, f.sent[1].payload.nonce);
  assert.equal(channel.messageCache.get(human.id), human); assert.notEqual(f.ctx.db.meta('rules_message_id'), id); f.ctx.db.close();
});

test('Rules publication recovers from failed sends without losing its recovery nonce', async () => {
  const f = fixture(); f.setSendFailure(true); await assert.rejects(f.ctx.rules.ensure(), /interruption/);
  const nonce = f.ctx.db.meta('rules_send_nonce'); assert.ok(nonce);
  f.setSendFailure(false); await f.ctx.rules.ensure(); assert.equal(f.sent[0].payload.nonce, nonce);
  assert.equal(f.ctx.db.meta('rules_send_nonce'), ''); assert.equal(f.sent.length, 1); f.ctx.db.close();
});

test('Gateway routing invokes boost detection independently of normal member role changes', async () => {
  const f = fixture(); installEvents(f.ctx); const { before, after } = boosted(f);
  f.ctx.client.emit(Events.GuildMemberUpdate, before, after);
  await new Promise(resolve => setImmediate(resolve)); f.ctx.boosts.tick(Date.now() + 21000);
  assert.equal(pendingBoosts(f).length, 1); f.ctx.db.close();
});
