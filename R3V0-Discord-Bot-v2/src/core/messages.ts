import type { Message, PartialMessage } from 'discord.js';
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
export function gifMedia(s: MessageSnapshot): { links: string[]; preview?: string } {
  const links = new Set<string>();
  let preview: string | undefined;
  for (const match of s.content.matchAll(/https?:\/\/[^\s<>]+/gi)) {
    try {
      const u = new URL(match[0]);
      if (/(^|\.)(tenor\.com|giphy\.com|gph\.is)$/.test(u.hostname) || /\.gif$/i.test(u.pathname)) links.add(u.href);
      if (/\.gif$/i.test(u.pathname)) preview ??= u.href;
    } catch { /* Invalid text is not a media URL. */ }
  }
  for (const a of s.attachments) {
    if (a.contentType === 'image/gif' || /\.gif$/i.test(a.name)) { links.add(a.url); preview ??= a.url; }
  }
  for (const e of s.embeds) {
    const provider = `${e.provider?.name ?? ''} ${e.url ?? ''}`;
    if (e.type === 'gifv' || /tenor|giphy/i.test(provider) || /\.gif(?:\?|$)/i.test(e.image?.url ?? '')) {
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
