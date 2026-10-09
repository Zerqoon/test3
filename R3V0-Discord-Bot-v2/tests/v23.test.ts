import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Collection, EmbedType, type APIEmbed, type Message, type MessageCreateOptions, type Role } from 'discord.js';
import { fixture, GUILD, ALICE, BOT, STAFF, json } from './harness.js';
import { snapshotMessage, rawSnapshot } from '../src/core/messages.js';
import type { MessageSnapshot } from '../src/core/types.js';
import { installEvents } from '../src/events/install.js';
import { linkViolation, messageLinks, LinkFilterService } from '../src/services/link-filter.js';
import { routeInteraction } from '../src/commands/router.js';

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const emit = (f: ReturnType<typeof fixture>, event: string, ...args: unknown[]) => (f.ctx.client as unknown as EventEmitter).emit(event, ...args);
const raw = (f: ReturnType<typeof fixture>, t: string, d: unknown) => emit(f, 'raw', { t, d });
const rules = { allowedDomains: ['giphy.com', 'gph.is', 'tenor.com', 'klipy.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'roblox.com'], blockInvites: true, staff: false, gifsAllowed: false };
function snapshot(content: string): MessageSnapshot {
  return { id: '1550000000001000200', guildId: GUILD, channelId: '1550000000001000201', authorId: ALICE,
    username: 'Stormy', displayName: 'Stormy', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    content, embeds: [], attachments: [], stickers: [], createdAt: Date.now() - 1000, editedAt: Date.now() - 1000, bot: false };
}
function present(f: ReturnType<typeof fixture>, content: string, index = 950, author = ALICE) {
  const channelId = f.ctx.config.tickets.panelChannelId;
  const message = { ...f.original(channelId, index, content), author: f.members.get(author)!.user, member: f.members.get(author) } as Message;
  f.channels.get(channelId)!.messageCache.set(message.id, message); return message;
}
function payloads(f: ReturnType<typeof fixture>, prefix: string) {
  return f.ctx.db.all<{ payload: string; dedupe_key: string }>('SELECT payload,dedupe_key FROM log_outbox WHERE dedupe_key LIKE ?', `${prefix}:%`)
    .map(row => JSON.parse(row.payload) as { channelId: string; embeds: APIEmbed[]; files?: { name: string; base64: string }[] });
}

for (const [url, kind] of [
  ['https://www.youtube.com/watch?v=abc', undefined], ['youtu.be/abc', undefined],
  ['https://vm.tiktok.com/test', undefined], ['https://www.roblox.com/users/123/profile', undefined],
  ['[Watch](https://example.com/secret)', 'link'], ['youtube.com.evil.example/test', 'link'],
  ['https://evil-youtube.com', 'link'], ['https://youtube.com@evil.example/a', 'link'],
  ['https://yоutube.com/watch?v=abc', 'link'], ['https://127.0.0.1/test', 'link'],
  ['ftp://youtube.com/video', 'link'], ['discord.gg/GOAT', 'invite'],
  ['[YouTube](https://canary.discord.com/invite/GOAT)', 'invite'],
  ['DISCORDAPP.COM/%69nvite/GOAT', 'invite'], ['discord.\u200Bgg/GOAT', 'invite'],
  ['https://tenor.com/view/goat', undefined], ['https://tenor.com./view/goat', undefined], ['https://giphy.com/gifs/goat', undefined],
  ['https://cdn.discordapp.com/attachments/1/2/goat.gif', 'gif']
] as const) test(`link policy: ${url}`, () => {
  assert.equal(linkViolation(snapshot(url), rules)?.kind, kind);
});

test('masked URLs and bare domains are detected without mistaking email or a normal username for links', () => {
  assert.equal(messageLinks('Hello Stormy_123, write user@gmail.com').length, 0);
  assert.equal(messageLinks('<https://youtube.com/watch?v=abc> [clip](https://evil.example/abc)').length, 2);
});

test('GIF roles may post any direct GIF but cannot bypass invites or unrelated link destinations', () => {
  const options = { ...rules, gifsAllowed: true };
  assert.equal(linkViolation(snapshot('https://example.net/goat.gif'), options), undefined);
  assert.equal(linkViolation(snapshot('https://cdn.discordapp.com/attachments/1/2/goat.gif'), options), undefined);
  assert.equal(linkViolation(snapshot('https://tenor.com/view/goat discord.gg/other'), options)?.kind, 'invite');
  assert.equal(linkViolation(snapshot('https://example.net/goat.gif https://example.net/login'), options)?.kind, 'link');
  const s = snapshot(''); s.attachments.push({ id: '1', url: 'https://cdn.discordapp.com/attachments/1/2/blob', name: 'goat.GIF', size: 90, contentType: 'image/gif' });
  assert.equal(linkViolation(s, rules)?.kind, 'gif'); assert.equal(linkViolation(s, options), undefined);
  assert.equal(linkViolation(snapshot('discord.gg/other https://evil.example/a.gif'), { ...rules, staff: true }), undefined);
});

test('approved video previews may use Discord CDN resources and normal image attachments remain allowed', () => {
  const s = snapshot('https://youtube.com/watch?v=abc');
  s.embeds = [{ url: 'https://youtube.com/watch?v=abc', thumbnail: { url: 'https://images-ext-1.discordapp.net/external/image.png' } }];
  s.attachments = [{ id: '1', url: 'https://cdn.discordapp.com/attachments/1/2/goat.png', name: 'goat.png', contentType: 'image/png', size: 400 }];
  assert.equal(linkViolation(s, rules), undefined);
  s.embeds.push({ url: 'https://evil.example/hidden' }); assert.equal(linkViolation(s, rules)?.kind, 'link');
});

test('a URL containing the word Tenor and a spoofed provider name do not grant an unrelated link exception', () => {
  const s = snapshot('https://tenor-fake.example/login'); s.embeds = [{ url: s.content, provider: { name: 'Tenor' } }];
  assert.equal(linkViolation(s, { ...rules, gifsAllowed: true })?.kind, 'link');
});

test('approved GIF roles can send Discord GIF attachments and GIFV media identified by the native embed', () => {
  const s = snapshot('https://example.net/animated'); s.embeds = [{ type: EmbedType.GIFV, url: 'https://example.net/animated', video: { url: 'https://example.net/animated.mp4' } }];
  assert.equal(linkViolation(s, rules)?.kind, 'gif'); assert.equal(linkViolation(s, { ...rules, gifsAllowed: true }), undefined);
  s.content = ''; s.embeds = []; s.attachments = [{ id: '1', url: 'https://cdn.discordapp.com/attachments/1/2/image', name: 'image', size: 40, contentType: 'IMAGE/GIF; charset=binary' }];
  assert.equal(linkViolation(s, rules)?.kind, 'gif'); assert.equal(linkViolation(s, { ...rules, gifsAllowed: true }), undefined);
});

test('raw uncached edit and deletion preserve full evidence and route to the requested channel', async () => {
  const f = fixture(); installEvents(f.ctx);
  const before = snapshot('Previous text'); before.attachments = [{ id: '1', name: 'screen.png', url: 'https://cdn.discordapp.com/screen.png', contentType: 'image/png', size: 300 }];
  f.ctx.db.recordMessage(before, 'live');
  raw(f, 'MESSAGE_UPDATE', { id: before.id, guild_id: GUILD, channel_id: before.channelId, content: 'Updated text', edited_timestamp: new Date().toISOString() });
  await settle(); raw(f, 'MESSAGE_DELETE', { id: before.id, guild_id: GUILD, channel_id: before.channelId }); await settle();
  assert.equal(payloads(f, 'edit').length, 1); assert.equal(payloads(f, 'delete').length, 1);
  assert.equal(payloads(f, 'edit')[0].embeds[0].fields!.find(field => field.name === 'Before')!.value, 'Previous text');
  assert.equal(payloads(f, 'delete')[0].embeds[0].description, 'Updated text');
  assert.deepEqual(f.ctx.db.snapshot(before.id)!.attachments, before.attachments);
  assert.equal(f.ctx.db.count(GUILD, ALICE), 1);
  await f.ctx.logs.flush(); assert.ok(f.sent.every(item => item.channelId === '1557439487813091358')); f.ctx.db.close();
});

test('raw plus Discord.js high-level update and delete produce one log per event', async () => {
  const f = fixture(); installEvents(f.ctx); const before = present(f, 'Before');
  f.ctx.db.recordMessage(snapshotMessage(before), 'live');
  const after = { ...before, content: 'After', editedTimestamp: Date.now() } as Message;
  raw(f, 'MESSAGE_UPDATE', { id: before.id, guild_id: GUILD, channel_id: before.channelId, content: after.content, edited_timestamp: new Date(after.editedTimestamp!).toISOString() });
  emit(f, 'messageUpdate', before, after); await settle();
  raw(f, 'MESSAGE_DELETE', { id: before.id, guild_id: GUILD, channel_id: before.channelId }); emit(f, 'messageDelete', after); await settle();
  assert.equal(payloads(f, 'edit').length, 1); assert.equal(payloads(f, 'delete').length, 1); f.ctx.db.close();
});

test('raw capture precedes SDK cache mutation even when no durable before snapshot exists yet', async () => {
  const f = fixture(); installEvents(f.ctx); const cached = present(f, 'Before SDK mutation', 951);
  raw(f, 'MESSAGE_UPDATE', { id: cached.id, guild_id: GUILD, channel_id: cached.channelId, content: 'After SDK mutation', edited_timestamp: new Date().toISOString() });
  Object.assign(cached, { content: 'After SDK mutation', editedTimestamp: Date.now() });
  emit(f, 'messageUpdate', { ...cached, content: 'Before SDK mutation' }, cached); await settle();
  const logs = payloads(f, 'edit'); assert.equal(logs.length, 1);
  assert.equal(logs[0].embeds[0].fields!.find(field => field.name === 'Before')!.value, 'Before SDK mutation');
  assert.equal(logs[0].embeds[0].fields!.find(field => field.name === 'After')!.value, 'After SDK mutation'); f.ctx.db.close();
});

test('human edits and deletes in the message log channel are logged; bot logs cannot cause loops', async () => {
  const f = fixture(); installEvents(f.ctx);
  const message = f.original(f.ctx.config.channels.messageLogs, 952, 'Human test'); emit(f, 'messageCreate', message); await settle();
  const edited = { ...message, content: 'Human edited', editedTimestamp: Date.now() } as Message;
  emit(f, 'messageUpdate', message, edited); await settle(); emit(f, 'messageDelete', edited); await settle();
  assert.equal(payloads(f, 'edit').length, 1); assert.equal(payloads(f, 'delete').length, 1);
  const bot = { ...f.original(message.channelId, 953, 'Bot log body'), author: f.members.get(BOT)!.user, member: f.members.get(BOT) } as Message;
  emit(f, 'messageCreate', bot); await settle();
  assert.equal(f.ctx.db.snapshot(bot.id)!.bot, true); assert.equal(f.ctx.db.snapshot(bot.id)!.content, '');
  raw(f, 'MESSAGE_DELETE', { id: bot.id, channel_id: bot.channelId, guild_id: GUILD }); await settle();
  assert.equal(payloads(f, 'delete').length, 1); assert.equal(f.ctx.db.count(GUILD, BOT), 0); f.ctx.db.close();
});

test('raw preview enrichment is saved without false edit spam and stale edits cannot overwrite newer text', async () => {
  const f = fixture(); installEvents(f.ctx); const s = snapshot('Latest text'); s.editedAt = Date.now(); f.ctx.db.recordMessage(s, 'live');
  raw(f, 'MESSAGE_UPDATE', { id: s.id, guild_id: GUILD, channel_id: s.channelId, embeds: [{ type: 'gifv', url: 'https://tenor.com/view/goat', image: { url: 'https://media.tenor.com/goat.gif' } }] });
  await settle(); assert.equal(f.ctx.db.snapshot(s.id)!.embeds.length, 1); assert.equal(payloads(f, 'edit').length, 0);
  raw(f, 'MESSAGE_UPDATE', { id: s.id, guild_id: GUILD, channel_id: s.channelId, content: 'Old text', edited_timestamp: new Date(s.editedAt - 1000).toISOString() });
  await settle(); assert.equal(f.ctx.db.snapshot(s.id)!.content, 'Latest text');
  raw(f, 'MESSAGE_DELETE', { id: s.id, guild_id: GUILD, channel_id: s.channelId }); await settle();
  const evidence = Buffer.from(payloads(f, 'delete')[0].files![0].base64, 'base64').toString('utf8'); assert.match(evidence, /media.tenor.com/); f.ctx.db.close();
});

test('raw bulk deletion works with an uncached channel and retains known human text in a single TXT log', async () => {
  const f = fixture(); installEvents(f.ctx); const s = snapshot('Human bulk evidence'); f.ctx.db.recordMessage(s, 'live');
  const bot = { ...s, id: '1550000000001000202', authorId: BOT, bot: true, content: '' }; f.ctx.db.recordMessage(bot, 'live');
  raw(f, 'MESSAGE_DELETE_BULK', { guild_id: GUILD, channel_id: s.channelId, ids: [s.id, bot.id, '1550000000001000203'] }); await settle();
  const logs = payloads(f, 'bulk'); assert.equal(logs.length, 1); assert.equal(logs[0].channelId, '1557439487813091358');
  const evidence = Buffer.from(logs[0].files![0].base64, 'base64').toString('utf8'); assert.match(evidence, /Human bulk evidence/);
  assert.match(evidence, /content unavailable/); assert.doesNotMatch(evidence, new RegExp(bot.id)); f.ctx.db.close();
});

test('raw edits from another guild are ignored and missing before content is explicitly labelled', async () => {
  const f = fixture(); installEvents(f.ctx); const s = snapshot('');
  raw(f, 'MESSAGE_UPDATE', { id: s.id, guild_id: '1550000000001000999', channel_id: s.channelId, content: 'Other server', edited_timestamp: new Date().toISOString() });
  raw(f, 'MESSAGE_UPDATE', { id: s.id, guild_id: GUILD, channel_id: s.channelId, content: 'Uncached new text', edited_timestamp: new Date().toISOString() });
  await settle(); const logs = payloads(f, 'edit'); assert.equal(logs.length, 1);
  assert.match(logs[0].embeds[0].fields!.find(field => field.name === 'Before')!.value, /Not observed/);
  assert.equal(logs[0].embeds[0].fields!.find(field => field.name === 'After')!.value, 'Uncached new text'); f.ctx.db.close();
});

test('an uncached raw edit fetches the author for filtering without delaying the initial edit log', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx); const message = present(f, 'discord.gg/other', 959);
  const channel = f.channels.get(message.channelId)!; channel.messageCache.delete(message.id);
  channel.messages.fetch = (async () => message) as typeof channel.messages.fetch;
  raw(f, 'MESSAGE_UPDATE', { id: message.id, guild_id: GUILD, channel_id: message.channelId, content: message.content, edited_timestamp: new Date().toISOString() });
  assert.equal(payloads(f, 'edit').length, 1); await settle();
  assert.ok(f.deletes.includes(message.id)); assert.equal(payloads(f, 'filter').length, 1); f.ctx.db.close();
});

test('a late edit cannot replace already observed deleted evidence or create another edit log', async () => {
  const f = fixture(); installEvents(f.ctx); const s = snapshot('Original deleted evidence'); f.ctx.db.recordMessage(s, 'live');
  raw(f, 'MESSAGE_DELETE', { id: s.id, guild_id: GUILD, channel_id: s.channelId });
  raw(f, 'MESSAGE_UPDATE', { id: s.id, guild_id: GUILD, channel_id: s.channelId, content: 'Late changed evidence', edited_timestamp: new Date().toISOString() });
  await settle(); assert.equal(f.ctx.db.snapshot(s.id)!.content, 'Original deleted evidence'); assert.equal(payloads(f, 'edit').length, 0); f.ctx.db.close();
});

test('invite filtering deletes before username archiving and emits one readable removal log', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx);
  const message = f.original(f.ctx.config.channels.usernames, 960, 'Join https://discord.gg/other');
  f.channels.get(message.channelId)!.messageCache.set(message.id, message);
  emit(f, 'messageCreate', message); await settle();
  assert.ok(f.deletes.includes(message.id)); assert.equal(f.ctx.db.get('SELECT 1 FROM username_archives WHERE source_id=?', message.id), undefined);
  assert.equal(f.ctx.db.get<{ state: string }>('SELECT state FROM link_filter_jobs WHERE message_id=?', message.id)!.state, 'deleted');
  raw(f, 'MESSAGE_DELETE', { id: message.id, guild_id: GUILD, channel_id: message.channelId }); emit(f, 'messageDelete', message); await settle();
  assert.equal(payloads(f, 'filter').length, 1); assert.equal(payloads(f, 'delete').length, 0); assert.equal(f.ctx.db.count(GUILD, ALICE), 1);
  assert.match(payloads(f, 'filter')[0].embeds[0].fields!.find(field => field.name === 'Reason')!.value, /invite/); f.ctx.db.close();
});

test('editing a previously safe message into an invite triggers filtering through raw Gateway data', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx); const message = present(f, 'Safe text');
  emit(f, 'messageCreate', message); await settle();
  const edited = { ...message, content: '[YouTube](https://discord.com/invite/other)', editedTimestamp: Date.now() } as Message;
  f.channels.get(message.channelId)!.messageCache.set(message.id, edited);
  raw(f, 'MESSAGE_UPDATE', { id: message.id, guild_id: GUILD, channel_id: message.channelId, content: edited.content, edited_timestamp: new Date(edited.editedTimestamp!).toISOString() });
  await settle(); assert.ok(f.deletes.includes(message.id)); assert.equal(payloads(f, 'edit').length, 1); assert.equal(payloads(f, 'filter').length, 1); f.ctx.db.close();
});

test('staff and configured owner can send invites and Discord GIFs and accepted GIFs remain logged', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx);
  for (const [index, id] of [[970, STAFF], [971, f.ctx.config.access.ownerUserIds[0]]] as const) {
    const message = present(f, 'https://discord.gg/other https://cdn.discordapp.com/attachments/1/2/goat.gif', index, id);
    emit(f, 'messageCreate', message); await settle(); assert.ok(!f.deletes.includes(message.id));
  }
  assert.equal(payloads(f, 'gif').length, 2); assert.equal(payloads(f, 'filter').length, 0); f.ctx.db.close();
});

test('fresh role checks remove a cached former staff member exemption', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx); const message = present(f, 'discord.gg/other', 972, STAFF);
  const fetch = f.ctx.guild.members.fetch;
  f.ctx.guild.members.fetch = (async (...args: unknown[]) => {
    assert.equal((args[0] as { force: boolean }).force, true);
    const member = await fetch({ user: (args[0] as { user: string }).user, force: true }); member.roles.cache.clear(); return member;
  }) as typeof fetch;
  emit(f, 'messageCreate', message); await settle(); assert.ok(f.deletes.includes(message.id)); f.ctx.db.close();
});

test('GIF exceptions persist across service restarts and do not grant an invite or normal-link exception', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx); const roleId = f.ctx.config.nickname.roleId;
  f.ctx.linkFilter.setGifRole({ id: roleId, managed: false } as Role, true, STAFF);
  f.ctx.linkFilter = new LinkFilterService(f.ctx); assert.deepEqual(f.ctx.linkFilter.gifRoles(), [roleId]);
  f.members.get(ALICE)!.roles.cache.set(roleId, { id: roleId } as Role);
  const permitted = present(f, 'https://example.net/goat.gif', 973); emit(f, 'messageCreate', permitted); await settle();
  assert.ok(!f.deletes.includes(permitted.id)); assert.equal(payloads(f, 'gif').length, 1);
  for (const [index, text] of [[974, 'https://tenor.com/view/goat discord.gg/other'], [975, 'https://example.net/login']] as const) {
    const message = present(f, text, index); emit(f, 'messageCreate', message); await settle(); assert.ok(f.deletes.includes(message.id));
  }
  f.ctx.config.linkFilter.gifAllowedRoleIds = [roleId]; f.ctx.linkFilter.setGifRole({ id: roleId, managed: false } as Role, false, STAFF);
  assert.deepEqual(new LinkFilterService(f.ctx).gifRoles(), []); f.ctx.db.close();
});

test('GIF attachments are removed for ordinary members while approved TikTok links need no member lookup', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx); const gif = present(f, '', 976);
  Object.assign(gif, { attachments: new Collection([['1550000000001000400', { id: '1550000000001000400', name: 'GOAT.GIF', url: 'https://cdn.discordapp.com/goat.gif', size: 40, contentType: 'image/gif' }]]) });
  emit(f, 'messageCreate', gif); await settle(); assert.ok(f.deletes.includes(gif.id));
  const video = present(f, 'https://vm.tiktok.com/GOAT', 977);
  let fetched = 0; f.ctx.guild.members.fetch = (async () => { fetched++; throw new Error('Should not fetch'); }) as typeof f.ctx.guild.members.fetch;
  emit(f, 'messageCreate', video); await settle(); assert.equal(fetched, 0); assert.ok(!f.deletes.includes(video.id)); f.ctx.db.close();
});

test('failed deletion is retained and completes once after a restart and restored access', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx); const message = present(f, 'https://evil.example/a', 978);
  const channel = f.channels.get(message.channelId)!; const remove = channel.messages.delete;
  channel.messages.delete = async () => { throw Object.assign(new Error('Missing Manage Messages'), { code: 50013 }); };
  emit(f, 'messageCreate', message); await settle(); assert.equal(f.ctx.linkFilter.pending(), 1); assert.equal(payloads(f, 'filter').length, 0);
  f.ctx.linkFilter = new LinkFilterService(f.ctx); channel.messages.delete = remove;
  await f.ctx.linkFilter.tick(Date.now() + 4000); await settle(); assert.equal(f.ctx.linkFilter.pending(), 0);
  assert.equal(f.deletes.filter(id => id === message.id).length, 1); assert.equal(payloads(f, 'filter').length, 1); f.ctx.db.close();
});

test('a safe edit during a fresh role check cancels the saved removal', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx); const message = present(f, 'discord.gg/other', 979);
  const fetch = f.ctx.guild.members.fetch;
  f.ctx.guild.members.fetch = (async (...args: unknown[]) => {
    const safe = { ...message, content: 'Safe now', editedTimestamp: Date.now() + 10 } as Message;
    f.ctx.db.recordMessage(snapshotMessage(safe), 'live'); f.channels.get(message.channelId)!.messageCache.set(message.id, safe);
    return fetch(...args as Parameters<typeof fetch>);
  }) as typeof fetch;
  emit(f, 'messageCreate', message); await settle(); assert.ok(!f.deletes.includes(message.id)); assert.equal(f.ctx.linkFilter.pending(), 0); f.ctx.db.close();
});

test('a failed fresh member lookup preserves the message and retries instead of assuming an exemption', async () => {
  const f = fixture({ filter: true }); installEvents(f.ctx); const message = present(f, 'discord.gg/other', 980, STAFF);
  f.ctx.guild.members.fetch = (async () => { throw new Error('REST unavailable'); }) as typeof f.ctx.guild.members.fetch;
  emit(f, 'messageCreate', message); await settle(); assert.ok(!f.deletes.includes(message.id)); assert.equal(f.ctx.linkFilter.pending(), 1); f.ctx.db.close();
});

test('an interrupted removal reconciles absence without falsely claiming a new deletion', async () => {
  const f = fixture({ filter: true }); const message = present(f, 'discord.gg/other', 981); const s = snapshotMessage(message);
  f.ctx.db.recordMessage(s, 'live'); f.channels.get(message.channelId)!.messageCache.delete(message.id);
  f.ctx.db.run("INSERT INTO link_filter_jobs(message_id,guild_id,channel_id,snapshot,reason,state,created_at) VALUES(?,?,?,?,?,'removing',?)", s.id, GUILD, s.channelId, JSON.stringify(s), 'Discord invite links are restricted.', Date.now());
  await f.ctx.linkFilter.tick(); assert.equal(payloads(f, 'filter').length, 1);
  assert.match(payloads(f, 'filter')[0].embeds[0].fields!.find(field => field.name === 'Action')!.value, /Confirmed absent/);
  assert.equal(f.deletes.length, 0); await f.ctx.linkFilter.tick(); assert.equal(payloads(f, 'filter').length, 1); f.ctx.db.close();
});

test('a bad log payload is isolated while later valid logs in the same channel still arrive', async () => {
  const f = fixture(); const channel = f.channels.get(f.ctx.config.channels.messageLogs)!; const send = channel.send;
  channel.send = async (p: MessageCreateOptions) => {
    if (p.embeds?.some(embed => (json(embed) as APIEmbed).title === 'Broken')) throw Object.assign(new Error('Invalid Form Body'), { code: 50035 });
    return send(p);
  };
  for (const title of ['Before', 'Broken', 'After']) f.ctx.logs.enqueue({ channelId: channel.id, embeds: [{ title }] }, title);
  for (let i = 0; i < 6; i++) await f.ctx.logs.flush();
  assert.deepEqual(f.sent.flatMap(row => row.payload.embeds!.map(embed => (json(embed) as APIEmbed).title)), ['Before', 'After']);
  assert.equal(f.ctx.db.get<{ status: string }>("SELECT status FROM log_outbox WHERE dedupe_key='Broken'")!.status, 'blocked');
  assert.equal(f.ctx.logs.pending(), 1); assert.match(f.ctx.logs.health(), /Invalid Form Body/); f.ctx.db.close();
});

test('private diagnostics verify the destination and direct delivery tests bypass an old queued failure', async () => {
  const f = fixture(); const channelId = f.ctx.config.channels.messageLogs;
  f.ctx.logs.enqueue({ channelId, embeds: [{ title: 'Saved log' }] }, 'saved'); f.setSendFailure(true); await f.ctx.logs.flush(); f.setSendFailure(false);
  const url = await f.ctx.logs.testMessageLogs(STAFF); assert.match(url, new RegExp(channelId));
  assert.equal(f.ctx.logs.pending(), 1); assert.equal(f.sent[0].channelId, channelId);
  const diagnostic = (await f.ctx.logs.messageStatus()).toJSON(); assert.equal(diagnostic.fields!.find(field => field.name === 'Version')!.value, '2.6.0');
  assert.match(diagnostic.fields!.find(field => field.name === 'Channel Access')!.value, /verified/);
  assert.equal(f.ctx.logs.retryMessageLogs(), 1); await f.ctx.logs.flush(); assert.equal(f.ctx.logs.pending(), 0); f.ctx.db.close();
});

test('diagnostics name missing channel permissions and refuse a misleading delivery success', async () => {
  const f = fixture(); const channel = f.channels.get(f.ctx.config.channels.messageLogs)!;
  channel.permissionsFor = (() => ({ has: (permission: string) => permission !== 'EmbedLinks' })) as typeof channel.permissionsFor;
  const embed = (await f.ctx.logs.messageStatus()).toJSON(); assert.match(embed.fields!.find(field => field.name === 'Channel Access')!.value, /EmbedLinks/);
  await assert.rejects(() => f.ctx.logs.testMessageLogs(STAFF), /EmbedLinks/); assert.equal(f.sent.length, 0); f.ctx.db.close();
});

test('the native GIF role command remains private and only configured staff can change exceptions', async () => {
  const f = fixture({ filter: true }); const roleId = f.ctx.config.nickname.roleId;
  for (const user of [ALICE, STAFF]) {
    const i = Object.assign(f.interaction(user), { commandName: 'link-filter', isAutocomplete: () => false, isChatInputCommand: () => true, isRepliable: () => true,
      options: { getSubcommand: () => 'allow-role', getRole: () => ({ id: roleId }) } });
    await routeInteraction(f.ctx, i);
    const result = i as unknown as { acknowledgements: { flags: number }[] };
    assert.equal(result.acknowledgements[0].flags, 64);
    assert.deepEqual(f.ctx.linkFilter.gifRoles(), user === STAFF ? [roleId] : []);
  }
  f.ctx.db.close();
});

test('partial raw data preserves unchanged fields and identifies webhook messages even with bot=false', () => {
  const before = snapshot('Keep me'); before.embeds = [{ description: 'Keep this too' }];
  const after = rawSnapshot({ id: before.id, channel_id: before.channelId, edited_timestamp: new Date().toISOString() }, before)!;
  assert.equal(after.content, before.content); assert.deepEqual(after.embeds, before.embeds);
  const webhook = rawSnapshot({ id: before.id, channel_id: before.channelId, guild_id: GUILD, content: 'Webhook', webhook_id: '1550000000001000400',
    author: { id: BOT, username: 'Hook', global_name: null, discriminator: '0000', avatar: null, bot: false } });
  assert.equal(webhook!.bot, true);
});
