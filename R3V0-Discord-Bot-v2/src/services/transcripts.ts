import type { GuildTextBasedChannel } from 'discord.js';
import type { Context, MessageSnapshot } from '../core/types.js';
import { snapshotMessage } from '../core/messages.js';
import { clip, safeText } from '../core/util.js';
import { textEvidence } from './logs.js';

export function transcriptDocument(title: string, metadata: string, snapshots: MessageSnapshot[], deletedIds: Set<string> = new Set()): string {
  const lines = [...snapshots].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(message => {
    const embeds = message.embeds.map(embed => [embed.title, embed.description,
      ...(embed.fields ?? []).map(field => `${field.name}: ${field.value}`)].filter(Boolean).join('\n')).join('\n\n');
    const files = message.attachments.map(file => `${file.name}: ${file.url}`).join('\n');
    const stickers = message.stickers.map(sticker => `${sticker.name}: ${sticker.url}`).join('\n');
    return `[${new Date(message.createdAt).toISOString()}] ${message.displayName} (@${message.username})${message.bot ? ' [BOT]' : ''}\n` +
      `User ID: ${message.authorId} | Message ID: ${message.id}${deletedIds.has(message.id) ? ' | Deleted after observation' : ''}\n` +
      `${message.content || '[No text]'}${embeds ? `\nEmbed:\n${embeds}` : ''}${files ? `\nAttachments:\n${files}` : ''}${stickers ? `\nStickers:\n${stickers}` : ''}`;
  });
  return `${title}\n${'='.repeat(48)}\n${metadata}\n\n${lines.join('\n\n' + '-'.repeat(48) + '\n\n') || 'No messages were available.'}\n\nGOAT • Attachment links may expire. Text and observed deletions are preserved.\n`;
}
export interface TicketConversation {
  files: { name: string; base64: string }[]; summary: string; messageCount: number; participantCount: number;
}
export async function captureConversation(ctx: Context, channel: GuildTextBasedChannel, ticketId: number, metadata: string): Promise<TicketConversation> {
  const snapshots = new Map<string, MessageSnapshot>(); const deleted = new Set<string>();
  for (const row of ctx.db.all<{ snapshot: string; deleted_at: number | null }>('SELECT snapshot,deleted_at FROM messages WHERE channel_id=? AND snapshot IS NOT NULL', channel.id)) {
    const snapshot = JSON.parse(row.snapshot) as MessageSnapshot; snapshots.set(snapshot.id, snapshot);
    if (row.deleted_at) deleted.add(snapshot.id);
  }
  let before: string | undefined;
  for (;;) {
    if (ctx.stopping) throw new Error('GOAT conversation capture paused for restart.');
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
    const list = [...page.values()].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1);
    for (const message of list) { const snapshot = snapshotMessage(message); ctx.db.recordMessage(snapshot, 'history'); snapshots.set(snapshot.id, snapshot); }
    if (!list.length) break;
    const next = list.at(-1)!.id;
    if (before === next) throw new Error('GOAT conversation pagination did not advance.');
    before = next;
  }
  const all = [...snapshots.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const humans = all.filter(message => !message.bot);
  const recent = humans.slice(-8).map(message => `**${safeText(message.displayName, 60)}**${deleted.has(message.id) ? ' • deleted' : ''}: ${safeText(message.content || (message.attachments.length ? `[${message.attachments.length} attachment(s): ${message.attachments.map(file => file.name).join(', ')}]` : '[No text]'), 220)}`).join('\n');
  const summary = `${humans.length > 8 ? '*Last 8 messages; the full conversation is attached as TXT.*\n' : ''}${recent || '*No member messages were posted.*'}`;
  const groups: MessageSnapshot[][] = []; let current: MessageSnapshot[] = [], bytes = 0;
  for (const snapshot of all) {
    const size = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
    if (current.length && bytes + size > 600000) { groups.push(current); current = []; bytes = 0; }
    current.push(snapshot); bytes += size;
  }
  groups.push(current);
  return { files: groups.map((group, index) => textEvidence(`goat-ticket-${ticketId}${groups.length > 1 ? `-part-${index + 1}` : ''}.txt`,
    transcriptDocument(`GOAT • Ticket #${ticketId}`, metadata, group, deleted))), summary: clip(summary, 2800),
    messageCount: humans.length, participantCount: new Set(humans.map(message => message.authorId)).size };
}
// Kept as the public capture helper for existing integrations; files are now plain text.
export async function captureTranscript(ctx: Context, channel: GuildTextBasedChannel, ticketId: number, metadata: string): Promise<{ name: string; base64: string }[]> {
  return (await captureConversation(ctx, channel, ticketId, metadata)).files;
}
