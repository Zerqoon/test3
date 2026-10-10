import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbedBuilder, MessageFlags, type APIEmbed, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { Store } from '../src/core/store.js';
import { routeInteraction } from '../src/commands/router.js';
import { embedCharacters } from '../src/services/logs.js';
import { supportAvailability } from '../src/services/support-hours.js';
import { TICKET_PANEL_TITLE, TicketService, ticketPanel } from '../src/services/tickets.js';
import { fixture, ALICE, BOB, STAFF } from './harness.js';

function command(f: ReturnType<typeof fixture>, count: number, userId = STAFF) {
  return Object.assign(f.interaction(userId), { commandName: 'open-ticket', options: { getInteger: () => count },
    isAutocomplete: () => false, isChatInputCommand: () => true, isRepliable: () => true }) as unknown as ChatInputCommandInteraction;
}
function response(i: ChatInputCommandInteraction) {
  return (i as unknown as { replies: { embeds: { toJSON(): APIEmbed }[] }[] }).replies[0].embeds[0].toJSON();
}
function panel(f: ReturnType<typeof fixture>) {
  return f.channels.get(f.ctx.config.tickets.panelChannelId)!.messageCache.get(f.ctx.db.meta('ticket_panel_message_id')!)!;
}
function buttons(message: Message) {
  return message.components.flatMap(row => 'components' in row ? row.components.map(c => 'customId' in c ? c.customId : '') : []);
}

test('open-ticket count:0 marks 20/20, confirms full privately and leaves Support available', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const id = panel(f).id;
  const i = command(f, 0); await routeInteraction(f.ctx, i);
  const status = f.ctx.tickets.intake.status();
  assert.equal(status.occupied, 20); assert.equal(status.reserved, 0); assert.equal(status.available, 0);
  assert.equal(status.enabled, true); assert.equal(status.accepting, false);
  assert.equal(response(i).title, 'Clan Full · 20/20'); assert.match(response(i).description!, /button is removed/);
  assert.doesNotMatch(response(i).description!, /button displays/);
  assert.deepEqual((i as unknown as { acknowledgements: unknown[] }).acknowledgements, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(panel(f).id, id); assert.match(panel(f).embeds[0].fields[0].value, /Clan Full · 20\/20/);
  assert.deepEqual(buttons(panel(f)), ['goat:ticket:open:support']);
  const log = f.ctx.db.get<{ payload: string }>("SELECT payload FROM log_outbox WHERE dedupe_key LIKE 'clan-intake:%' ORDER BY id DESC")!;
  assert.equal(JSON.parse(log.payload).embeds[0].title, 'Clan Full · 20/20');
  await assert.rejects(f.ctx.tickets.open(f.interaction(BOB), 'application'), /clan is full/);
  assert.equal((await f.openTicket('support', BOB)).kind, 'support'); assert.equal(f.ctx.tickets.intake.status().used, 20);
  f.ctx.db.close();
});

test('Setting zero preserves pending applications and votes; decisions keep the capacity accurate', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel();
  const first = await f.openTicket('application'); const second = await f.openTicket('application', BOB);
  await f.startVote(first.id); const vote = f.ctx.tickets.votes.get(first.id)!;
  await f.ctx.tickets.setIntake(0, STAFF);
  assert.equal(f.ctx.tickets.intake.status().occupied, 18); assert.equal(f.ctx.tickets.intake.status().reserved, 2);
  assert.equal(f.ctx.tickets.intake.status().used, 20); assert.equal(f.ctx.tickets.get(first.id).state, 'open');
  assert.equal(f.ctx.tickets.get(second.id).state, 'open'); assert.deepEqual(f.ctx.tickets.votes.get(first.id), vote);
  await f.ctx.tickets.votes.decide(first.id, 'accepted', STAFF, 'Welcome');
  assert.equal(f.ctx.tickets.intake.status().occupied, 19); assert.equal(f.ctx.tickets.intake.status().reserved, 1);
  assert.equal(f.ctx.tickets.intake.status().available, 0);
  await f.ctx.tickets.votes.decide(second.id, 'rejected', STAFF, 'Requirements not met'); await f.ctx.tickets.tick();
  assert.equal(f.ctx.tickets.intake.status().occupied, 19); assert.equal(f.ctx.tickets.intake.status().reserved, 0);
  assert.equal(f.ctx.tickets.intake.status().available, 1); assert.equal(buttons(panel(f))[0], 'goat:ticket:open:application');
  f.ctx.db.close();
});

test('A form opened before count:0 cannot create an application after the clan is marked full', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const form = await f.form('application');
  await f.ctx.tickets.setIntake(0, STAFF);
  await assert.rejects(f.ctx.tickets.openModal(form.modal, form.requestId), /clan is full/);
  assert.equal(f.ctx.db.get('SELECT 1 FROM tickets'), undefined); assert.equal(f.ctx.tickets.intake.status().reserved, 0);
  assert.equal(f.ctx.db.get<{ ticket_id: number | null }>('SELECT ticket_id FROM ticket_requests WHERE id=?', form.requestId)!.ticket_id, null);
  f.ctx.db.close();
});

test('Zero after a manual pause and then five free places update the original panel', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const id = panel(f).id;
  await f.ctx.tickets.setIntake(null, STAFF); await f.ctx.tickets.setIntake(0, STAFF);
  assert.equal(f.ctx.tickets.intake.status().enabled, true); assert.match(panel(f).embeds[0].fields[0].value, /Clan Full/);
  await routeInteraction(f.ctx, command(f, 5));
  assert.equal(f.ctx.tickets.intake.status().available, 5); assert.equal(f.ctx.tickets.intake.status().occupied, 15);
  assert.equal(panel(f).id, id); assert.equal(f.sent.length, 1);
  assert.deepEqual(buttons(panel(f)), ['goat:ticket:open:application', 'goat:ticket:open:support']);
  assert.match(panel(f).embeds[0].fields[0].value, /5 free places/); f.ctx.db.close();
});

test('Full status survives closing and reopening SQLite and retains the same Discord panel', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'goat-full-count-')); const f = fixture(); f.ctx.db.close();
  const file = join(directory, 'goat.sqlite'); f.ctx.db = new Store(file);
  try {
    f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.ensurePanel(); await f.ctx.tickets.setIntake(0, STAFF);
    const id = panel(f).id; const before = f.ctx.tickets.intake.status(); f.ctx.db.close();
    f.ctx.db = new Store(file); f.ctx.tickets = new TicketService(f.ctx); await f.ctx.tickets.ensurePanel();
    assert.deepEqual(f.ctx.tickets.intake.status(), before); assert.equal(panel(f).id, id); assert.equal(f.sent.length, 1);
    assert.deepEqual(buttons(panel(f)), ['goat:ticket:open:support']);
  } finally { f.ctx.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('A full clan keeps no buttons after hours and restores only Support at the next opening', async () => {
  const f = fixture(); let now = Date.parse('2026-10-10T22:00:00+02:00');
  f.ctx.config.tickets.supportHours.enabled = true; f.ctx.tickets = new TicketService(f.ctx, () => now);
  await f.ctx.tickets.setIntake(0, STAFF); const id = panel(f).id; assert.deepEqual(buttons(panel(f)), []);
  assert.match(panel(f).embeds[0].fields[0].value, /Clan Full/); assert.match(panel(f).embeds[0].fields[1].value, /Support Closed/);
  now = Date.parse('2026-10-11T15:00:00+02:00'); await f.ctx.tickets.tick();
  assert.deepEqual(buttons(panel(f)), ['goat:ticket:open:support']); assert.equal(panel(f).id, id);
  assert.equal(f.ctx.tickets.intake.status().available, 0); f.ctx.db.close();
});

test('Upgrade recovers the old buttonless panel and replaces its design without a duplicate post', async () => {
  const f = fixture(); f.ctx.config.tickets.supportHours.enabled = true;
  const now = () => Date.parse('2026-10-10T22:00:00+02:00'); f.ctx.tickets = new TicketService(f.ctx, now);
  await f.ctx.tickets.setIntake(0, STAFF); const old = panel(f);
  await old.edit({ embeds: [new EmbedBuilder(old.embeds[0].toJSON()).setTitle('Applications & Support')], components: [] });
  f.ctx.db.setMeta('ticket_panel_version', '2.6.0'); f.ctx.db.run("DELETE FROM meta WHERE key='ticket_panel_message_id'");
  f.ctx.tickets = new TicketService(f.ctx, now); await f.ctx.tickets.ensurePanel();
  assert.equal(panel(f).id, old.id); assert.equal(panel(f).embeds[0].title, TICKET_PANEL_TITLE);
  assert.deepEqual(buttons(panel(f)), []); assert.equal(f.sent.length, 1); f.ctx.db.close();
});

test('An ordinary member cannot mark the clan full with count:0', async () => {
  const f = fixture(); await f.ctx.tickets.ensurePanel(); const before = f.ctx.tickets.intake.status();
  const i = command(f, 0, ALICE); await routeInteraction(f.ctx, i);
  assert.match(response(i).title!, /Unavailable/); assert.deepEqual(f.ctx.tickets.intake.status(), before);
  assert.deepEqual((i as unknown as { acknowledgements: unknown[] }).acknowledgements, [{ flags: MessageFlags.Ephemeral }]);
  f.ctx.db.close();
});

test('Ticket embeds serialize within Discord limits for open, paused and full states', () => {
  const statuses = [{ accepting: true, displayUsed: 15, available: 5 }, { accepting: false, displayUsed: 19, available: 1 }, { accepting: false, displayUsed: 20, available: 0 }];
  for (const enabled of [true, false]) for (const time of ['14:59:59', '15:00:00', '22:00:00']) for (const status of statuses) {
    const support = supportAvailability({ enabled, startHour: 15, endHour: 22 }, 'Europe/Warsaw', Date.parse(`2026-10-10T${time}+02:00`));
    const embed = ticketPanel(status, support).embeds[0].toJSON();
    assert.ok(embedCharacters([embed]) <= 6000); assert.ok(embed.description!.length <= 4096);
    for (const field of embed.fields!) { assert.ok(field.name.length <= 256); assert.ok(field.value.length <= 1024); }
  }
});
