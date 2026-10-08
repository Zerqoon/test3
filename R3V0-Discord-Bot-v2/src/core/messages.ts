import type { APIMessage, Message, PartialMessage } from 'discord.js';
import type { MessageSnapshot } from './types.js';

export function snapshotMessage(message: Message): MessageSnapshot {
  if (!message.guildId) throw new Error('Only guild messages can be indexed.');
  return {
    id: message.id, guildId: message.guildId, channelId: message.channelId, authorId: message.author.id,
    username: message.author.username, displayName: message.member?.displayName ?? message.author.displayName,
    avatarUrl: message.member?.displayAvatarURL({ extension: 'png', size: 256 }) ?? message.author.displayAvatarURL({ extension: 'png', size: 256 }),
    content: message.content, embeds: message.embeds.map(e => e.toJSON()),
    attachments: [...message.attachments.values()].map(a => ({ id: a.id, url: a.url, name: a.name, size: a.size, contentType: a.contentType })),
    stickers: [...message.stickers.values()].map(s => ({ id: s.id, name: s.name, url: s.url })),
    createdAt: message.createdTimestamp, editedAt: message.editedTimestamp ?? message.createdTimestamp,
    bot: message.author.bot || message.webhookId !== null
  };
}
export async function completeMessage(message: Message | PartialMessage): Promise<Message | undefined> {
  if (!message.partial) return message as Message;
  try { return await message.fetch(); } catch { return undefined; }
}
/** An edit can arrive for a message evicted from the small Discord.js cache. */
export function updatedSnapshot(message: Message | PartialMessage, before?: MessageSnapshot): MessageSnapshot | undefined {
  if (!message.partial) return snapshotMessage(message as Message);
  if (!before || typeof message.content !== 'string') return undefined;
  return { ...before, content: message.content,
    embeds: message.embeds.map(embed => embed.toJSON()),
    attachments: [...message.attachments.values()].map(file => ({ id: file.id, url: file.url, name: file.name, size: file.size, contentType: file.contentType })),
    stickers: [...message.stickers.values()].map(sticker => ({ id: sticker.id, name: sticker.name, url: sticker.url })),
    editedAt: message.editedTimestamp ?? Date.now() };
}
export type RawMessageData = Partial<APIMessage> & { id: string; channel_id: string; guild_id?: string;
  member?: { nick?: string | null }; };
/** Gateway updates omit unchanged fields; never erase saved attachments or text. */
export function rawSnapshot(data: RawMessageData, before?: MessageSnapshot): MessageSnapshot | undefined {
  const authorId = data.author?.id ?? before?.authorId;
  const guildId = data.guild_id ?? before?.guildId;
  if (!authorId || !guildId || (!before && typeof data.content !== 'string')) return;
  const createdAt = data.timestamp ? Date.parse(data.timestamp) : before?.createdAt ?? Number((BigInt(data.id) >> 22n) + 1420070400000n);
  const editedAt = data.edited_timestamp ? Date.parse(data.edited_timestamp) : before?.editedAt ?? createdAt;
  if (!Number.isFinite(createdAt) || !Number.isFinite(editedAt)) return;
  return {
    id: data.id, guildId, channelId: data.channel_id, authorId,
    username: data.author?.username ?? before?.username ?? authorId,
    displayName: data.member?.nick ?? before?.displayName ?? data.author?.global_name ?? data.author?.username ?? authorId,
    avatarUrl: before?.avatarUrl ?? (data.author?.avatar ? `https://cdn.discordapp.com/avatars/${authorId}/${data.author.avatar}.png?size=256` : 'https://cdn.discordapp.com/embed/avatars/0.png'),
    content: data.content ?? before?.content ?? '',
    embeds: data.embeds ?? before?.embeds ?? [],
    attachments: data.attachments?.map(file => ({ id: file.id, url: file.url, name: file.filename, size: file.size, contentType: file.content_type ?? null })) ?? before?.attachments ?? [],
    stickers: data.sticker_items?.map(sticker => ({ id: sticker.id, name: sticker.name,
      url: `https://cdn.discordapp.com/stickers/${sticker.id}.${sticker.format_type === 4 ? 'gif' : 'png'}` })) ?? before?.stickers ?? [],
    createdAt, editedAt, bot: !!data.webhook_id || (data.author?.bot ?? before?.bot ?? false)
  };
}
/** Only bot identity is needed to suppress log loops; its content is never counted. */
export function botMarker(s: MessageSnapshot): MessageSnapshot {
  return { ...s, content: '', embeds: [], attachments: [], stickers: [] };
}
export function gifMedia(s: MessageSnapshot): { links: string[]; preview?: string } {
  const links = new Set<string>();
  let preview: string | undefined;
  for (const match of s.content.matchAll(/https?:\/\/[^\s<>]+/gi)) {
    try {
      const u = new URL(match[0]);
      if (/(^|\.)(tenor\.com|giphy\.com|gph\.is)$/.test(u.hostname.replace(/\.$/, '')) || /\.gifv?$/i.test(u.pathname)) links.add(u.href);
      if (/\.gif$/i.test(u.pathname)) preview ??= u.href;
    } catch { /* Invalid text is not a media URL. */ }
  }
  for (const a of s.attachments) {
    if (/^image\/gif(?:;|$)/i.test(a.contentType ?? '') || /\.gif$/i.test(a.name)) { links.add(a.url); preview ??= a.url; }
  }
  for (const e of s.embeds) {
    let gifProvider = false;
    try { gifProvider = /(^|\.)(tenor\.com|giphy\.com|gph\.is)$/.test(new URL(e.url ?? '').hostname.replace(/\.$/, '')); }
    catch { /* Missing or invalid provider URL. */ }
    if (e.type === 'gifv' || gifProvider || /\.gif(?:\?|$)/i.test(e.image?.url ?? '')) {
      if (e.url) links.add(e.url);
      if (e.video?.url) links.add(e.video.url);
      preview ??= e.image?.url ?? e.thumbnail?.url;
    }
  }
  return { links: [...links], preview };
}
export function evidence(s: MessageSnapshot): string {
  return [`GOAT MESSAGE EVIDENCE`, `Message ID: ${s.id}`, `Author: ${s.displayName} (@${s.username}) — ${s.authorId}`,
    `Guild: ${s.guildId}`, `Channel: ${s.channelId}`, `Created: ${new Date(s.createdAt).toISOString()}`,
    `Last observed edit: ${new Date(s.editedAt).toISOString()}`, '', 'MESSAGE:', s.content || '[No text]', '',
    'ATTACHMENTS:', JSON.stringify(s.attachments, null, 2), '', 'EMBEDS:', JSON.stringify(s.embeds, null, 2),
    '', 'STICKERS:', JSON.stringify(s.stickers, null, 2)].join('\n');
}
